import type * as THREE from 'three'
import type { Collider, Rect } from './collision'
import type { RestPose, RestSpot } from './playerController'

type ThreeModule = typeof import('three')
type GLTFLoaderCtor = typeof import('three/examples/jsm/loaders/GLTFLoader.js').GLTFLoader

// 家具模型來自 KayKit Furniture Bits（CC0，授權檔在 public/models/furniture/LICENSE.txt）。
// 原始模型的桌子高 1 單位，縮成 0.6 後跟角色（約 1.6 m）比例相當
export const FURNITURE_SCALE = 0.6
const MODEL_DIR = '/models/furniture/'

export interface FurniturePiece {
  model: string
  x: number
  z: number
  // 掛在牆上、放在桌上的才需要
  y?: number
  // 模型正面朝 +Z
  rotation?: number
  // 繞 Z 軸側倒（例如把立著的書放平）
  roll?: number
  scale?: number
  // 地毯、牆上的相框和壁架不擋路
  solid?: boolean
  // 可以坐、躺的家具才需要：互動用的代號與顯示名稱，可以做的動作由 SEAT_SPOTS 依模型決定
  interactive?: { id: string; name: string }
}

// 家具上可以坐、躺的位置，用模型自己的座標（縮放前、模型正面朝 +Z）。
// 座面高度是對模型做向下射線量出來的：沙發、單人沙發的座面 0.5、床墊 0.5（枕頭 0.75）
interface SpotDef {
  pose: RestPose
  label: string
  x: number
  y: number
  z: number
  // 身體朝向（相對模型）；躺下時頭朝身體的 -Z
  yaw: number
  // 走過去要停的地板位置，要留在碰撞範圍外（角色半徑 0.25 公尺）
  approach: { x: number; z: number }
  incline?: number
  sleep?: boolean
}

const SEAT_SPOTS: Record<string, SpotDef[]> = {
  // 兩個座位，選離角色近的那個；躺下時頭靠在 +X 那側的扶手上，上半身抬高
  couch_pillows: [
    { pose: 'sit', label: '坐下', x: -0.55, y: 0.5, z: 0.15, yaw: 0, approach: { x: -0.55, z: 1.4 } },
    { pose: 'sit', label: '坐下', x: 0.55, y: 0.5, z: 0.15, yaw: 0, approach: { x: 0.55, z: 1.4 } },
    { pose: 'lie', label: '躺下', x: -0.45, y: 0.5, z: 0.3, yaw: -Math.PI / 2, approach: { x: 0, z: 1.4 }, incline: 0.5 }
  ],
  armchair_pillows: [{ pose: 'sit', label: '坐下', x: 0, y: 0.5, z: 0.15, yaw: 0, approach: { x: 0, z: 1.4 } }],
  // 餐椅面向餐桌，正前方被桌子擋住，從椅子的側後方走過去
  chair_C: [{ pose: 'sit', label: '坐下', x: 0, y: 0.49, z: -0.05, yaw: 0, approach: { x: 0.92, z: -0.5 } }],
  // 頭朝床頭（-Z）、枕在枕頭上；從靠房間中間的那一側（+X）上床
  bed_single_A: [
    { pose: 'lie', label: '睡覺', x: 0, y: 0.5, z: 0.42, yaw: 0, approach: { x: 1.4, z: 0.3 }, incline: 0.15, sleep: true }
  ]
}

export interface FurnitureAction {
  pose: RestPose
  label: string
}

export interface FurnitureInteractable {
  id: string
  name: string
  // 角色靠近到這個範圍附近就能互動
  rect: Rect
  actions: FurnitureAction[]
  spots: RestSpot[]
}

// 3D 場景回報「角色附近可以互動的東西」：家電打開遙控面板，家具可以坐、躺
export type NearbyTarget =
  | { kind: 'device'; id: string }
  | { kind: 'furniture'; id: string; name: string; actions: FurnitureAction[] }
  // 電箱：只有停電時才能互動（復電）
  | { kind: 'breaker'; id: 'breaker' }

// 餐桌的中心（廚房磁磚前面的空地）與椅子離桌子中心的距離（桌面 1.2 公尺見方）
const DINING_X = 3.3
const DINING_Z = 0.65
const DINING_CHAIR_OFFSET = 0.75
// 桌面高度：模型高 1 單位 × FURNITURE_SCALE
const TABLE_TOP = 0.6

// 房間 8 × 6（x -3 ~ 5、z -3 ~ 3），右邊 x 3 ~ 5 是廚房。後牆 z = -3、左牆 x = -3。
// 擺放時要留通道：電視前方（x -2.45 ~ -1.55）、冷氣下方、洗衣機前方都要能走到，不然角色無法操作家電。
// 碰撞方塊會跟著家具旋轉，斜放也沒關係
export const ROOM_FURNITURE: FurniturePiece[] = [
  // 客廳：沙發面對左牆的電視
  { model: 'rug_oval_A', x: -1.3, z: 0.4, rotation: Math.PI / 2, solid: false },
  { model: 'couch_pillows', x: -0.3, z: 0.4, rotation: -Math.PI / 2, interactive: { id: 'couch', name: '沙發' } },
  { model: 'armchair_pillows', x: -1.3, z: 2.35, rotation: -2.4, interactive: { id: 'armchair', name: '單人沙發' } },
  { model: 'table_small', x: -0.3, z: 1.52, scale: 0.4 },
  { model: 'cactus_small_A', x: -0.3, y: 0.4, z: 1.52, scale: 0.4 },
  // 左牆最前面（z 2.6 ~ 2.95）留給電箱
  { model: 'pictureframe_small_A', x: -2.94, y: 1.8, z: 2.0, rotation: Math.PI / 2, solid: false },
  { model: 'pictureframe_small_C', x: -2.94, y: 1.75, z: 2.38, rotation: Math.PI / 2, solid: false },
  // 臥室角落
  { model: 'bed_single_A', x: -2.45, z: -2.05, interactive: { id: 'bed', name: '床' } },
  { model: 'cabinet_small_decorated', x: -1.6, z: -2.7, scale: 0.5 },
  { model: 'lamp_standing', x: -2.65, z: -0.9, scale: 0.5 },
  { model: 'pictureframe_large_B', x: -2.2, y: 1.85, z: -2.94, solid: false },
  // 廚房前面的餐桌：方桌四邊各一張餐椅，椅子朝向桌子中心
  { model: 'table_medium', x: DINING_X, z: DINING_Z },
  // 桌上的小盆栽和一本平放的書（書的模型是立著的，側倒 90 度；原點在書的中心，抬高半本書的厚度）
  { model: 'cactus_small_A', x: DINING_X - 0.12, y: TABLE_TOP, z: DINING_Z - 0.18, solid: false },
  { model: 'book_single', x: DINING_X + 0.2, y: TABLE_TOP + 0.078, z: DINING_Z + 0.22, rotation: 0.4, roll: Math.PI / 2, solid: false },
  { model: 'chair_C', x: DINING_X, z: DINING_Z - DINING_CHAIR_OFFSET, rotation: 0, interactive: { id: 'chair_n', name: '餐椅' } },
  { model: 'chair_C', x: DINING_X, z: DINING_Z + DINING_CHAIR_OFFSET, rotation: Math.PI, interactive: { id: 'chair_s', name: '餐椅' } },
  { model: 'chair_C', x: DINING_X - DINING_CHAIR_OFFSET, z: DINING_Z, rotation: Math.PI / 2, interactive: { id: 'chair_w', name: '餐椅' } },
  { model: 'chair_C', x: DINING_X + DINING_CHAIR_OFFSET, z: DINING_Z, rotation: -Math.PI / 2, interactive: { id: 'chair_e', name: '餐椅' } },
  // 洗衣機旁
  { model: 'cactus_medium_A', x: 1.35, z: -2.6 },
  { model: 'shelf_B_large_decorated', x: 1.5, y: 1.5, z: -2.85, solid: false }
]

// 把模型座標（縮放前）換成世界座標
function toWorld(piece: FurniturePiece, x: number, y: number, z: number) {
  const scale = piece.scale ?? FURNITURE_SCALE
  const yaw = piece.rotation ?? 0
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  return {
    x: piece.x + (x * cos + z * sin) * scale,
    y: (piece.y ?? 0) + y * scale,
    z: piece.z + (-x * sin + z * cos) * scale
  }
}

function spotsFor(piece: FurniturePiece): RestSpot[] {
  return (SEAT_SPOTS[piece.model] ?? []).map((def) => {
    const seat = toWorld(piece, def.x, def.y, def.z)
    const approach = toWorld(piece, def.approach.x, 0, def.approach.z)
    return {
      pose: def.pose,
      ...seat,
      yaw: (piece.rotation ?? 0) + def.yaw,
      approach: { x: approach.x, z: approach.z },
      incline: def.incline ?? 0,
      sleep: def.sleep ?? false
    }
  })
}

// 載入所有家具，回傳整組物件、擋路的碰撞範圍（家具不是家電，deviceId 為 null）與可以坐、躺的家具
export async function loadRoomFurniture(
  THREE: ThreeModule,
  GLTFLoader: GLTFLoaderCtor
): Promise<{ root: THREE.Group; colliders: Collider[]; interactables: FurnitureInteractable[] }> {
  const loader = new GLTFLoader()
  const root = new THREE.Group()
  // 每個模型都各自帶一份相同的材質與貼圖；全部換成第一份，GPU 上只留一張貼圖
  let sharedMaterial: THREE.Material | null = null

  const pieces = await Promise.all(
    ROOM_FURNITURE.map(async (piece) => {
      const { scene } = await loader.loadAsync(`${MODEL_DIR}${piece.model}.gltf`)
      scene.scale.setScalar(piece.scale ?? FURNITURE_SCALE)
      scene.position.set(piece.x, piece.y ?? 0, piece.z)
      scene.rotation.set(0, piece.rotation ?? 0, piece.roll ?? 0, 'YXZ')
      scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return
        obj.castShadow = true
        obj.receiveShadow = true
        if (!sharedMaterial) {
          sharedMaterial = obj.material as THREE.Material
        } else if (obj.material !== sharedMaterial) {
          const own = obj.material as THREE.MeshStandardMaterial
          own.map?.dispose()
          own.dispose()
          obj.material = sharedMaterial
        }
      })
      return { piece, scene }
    })
  )

  const colliders: Collider[] = []
  const interactables: FurnitureInteractable[] = []
  for (const { piece, scene } of pieces) {
    root.add(scene)
    if (piece.solid === false) continue
    // 碰撞方塊用家具自己的座標算（先把位置、旋轉歸零量外框），再用 frame 跟著家具轉，
    // 斜放的家具才不會變成一個比本體大一圈的方塊
    scene.position.set(0, 0, 0)
    scene.rotation.y = 0
    scene.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(scene)
    scene.position.set(piece.x, piece.y ?? 0, piece.z)
    scene.rotation.y = piece.rotation ?? 0
    const rect: Rect = {
      minX: box.min.x,
      maxX: box.max.x,
      minZ: box.min.z,
      maxZ: box.max.z,
      frame: { x: piece.x, z: piece.z, yaw: piece.rotation ?? 0 }
    }
    colliders.push({ deviceId: null, ...rect, solid: true })

    const spots = spotsFor(piece)
    if (!piece.interactive || spots.length === 0) continue
    const { id, name } = piece.interactive
    // 點 3D 場景裡的家具時，用這個找到是哪一件
    scene.traverse((obj) => {
      obj.userData.furnitureId = id
    })
    const actions: FurnitureAction[] = []
    for (const def of SEAT_SPOTS[piece.model]!) {
      if (!actions.some((a) => a.pose === def.pose)) actions.push({ pose: def.pose, label: def.label })
    }
    interactables.push({ id, name, rect, actions, spots })
  }
  return { root, colliders, interactables }
}
