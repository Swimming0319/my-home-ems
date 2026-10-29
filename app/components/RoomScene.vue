<script setup lang="ts">
// three.js 只在型別層級靜態 import（編譯後會被擦除），執行期模組在 onMounted 裡
// 動態 import——SSR 階段根本不會載入 three，也不會把它塞進首屏 bundle。
import type * as THREE from 'three'
import type { Device, Reading } from '#shared/types/smartRoom'
import type { Collider } from '~/utils/collision'
import type { RestPose } from '~/utils/playerController'
import type { FurnitureInteractable, NearbyTarget } from '~/utils/roomFurniture'

const props = withDefaults(
  defineProps<{
    devices: Device[]
    readings: Record<string, Reading | null>
    selectedId: string | null
    // admin：自由旋轉鏡頭、點家電選取；player：有可操控的角色，點地板／家電會走過去
    mode?: 'admin' | 'player'
    // player 模式下正在操作（打開遙控面板）的家電：角色會面向它、播操作中的動畫
    interactingId?: string | null
    // 跳電中：房間變暗、電箱的總開關往下、指示燈閃紅燈
    powerOut?: boolean
    // 目前幾點（0～24 小數）：決定天色、環境光，晚上房間變暗
    hour?: number
  }>(),
  { mode: 'admin', interactingId: null, powerOut: false, hour: 12 }
)

const emit = defineEmits<{
  select: [id: string]
  // 角色進入／離開某台家電或可以坐、躺的家具的互動範圍
  nearby: [target: NearbyTarget | null]
  // 點家電走過去，抵達時觸發
  arrive: [id: string]
  // 角色坐下／躺下，或起身（null）
  rest: [pose: RestPose | null]
  // 角色走出正在操作的家電（interactingId）的互動範圍
  leave: []
  // 角色在電箱扳了總開關（外層決定要不要呼叫復電 API）
  breaker: []
  // 載入進度：scene 是第一次畫出畫面（或 WebGL 無法使用），furniture 是家具模型載完（或載入失敗）
  loaded: [stage: 'scene' | 'furniture']
}>()

const containerEl = ref<HTMLDivElement | null>(null)
const labelEls = ref<Record<string, HTMLDivElement | null>>({})
const breakerLabel = ref<HTMLDivElement | null>(null)
const webglFailed = ref<boolean>(false)

// 房間 8 × 6：原本 6 × 6 的客廳／臥室（x -3 ~ 3）往右多一塊廚房（x 3 ~ 5）
const ROOM_MIN_X = -3
const ROOM_MAX_X = 5
const ROOM_DEPTH = 6
const ROOM_WIDTH = ROOM_MAX_X - ROOM_MIN_X
const ROOM_CENTER_X = (ROOM_MIN_X + ROOM_MAX_X) / 2
const WALL_HEIGHT = 3
const BASE_FOV = 45
const WIDE_ASPECT = 1.1
const MAX_FOV = 80
const INTERACT_RANGE = 1.2
// 家具的互動範圍比家電小：沙發就在電視前面，範圍太大的話站在電視前會一直跳出「坐下」
const FURNITURE_RANGE = 0.6
// 電箱掛在左牆最前面；互動範圍比家電小一點
const BREAKER_RANGE = 1
// 走過去時用的特殊代號，抵達後當作「扳電箱」而不是打開某台家電的遙控面板
const BREAKER_TARGET = '__breaker__'
// 停電時環境光、陽光剩幾成
const OUTAGE_LIGHT = 0.3
// 深夜的環境光剩幾成（白天是 1）；夜裡房間主要靠電燈照亮
const NIGHT_LIGHT = 0.12
// 晚上每開一盞燈，整個房間的環境光補多少（壁燈的點光源只照得到附近的牆，房間中間會太暗）
const LAMP_FILL = 0.32
const MAX_LAMP_FILL = 0.65
const ROOM_BOUNDS = { minX: ROOM_MIN_X, maxX: ROOM_MAX_X, minZ: -ROOM_DEPTH / 2, maxZ: ROOM_DEPTH / 2 }

interface DeviceRig {
  group: THREE.Group
  statusLight: THREE.PointLight
  // 點光源平常的顏色；超過閾值時一律改成紅色，回到正常再換回這個
  lightColor: THREE.Color
  labelAnchor: THREE.Vector3
  // 拿遙控器操作時要對準的點（冷氣的正面、電視的螢幕中央），以電器自己的座標表示
  aimAnchor: THREE.Vector3
  // 點光源亮度的倍率：電燈的點光源就是燈本身，要比一般家電的狀態光亮很多
  glowScale?: number
  animate: (level: VisualLevel, reading: Reading | null, dt: number, elapsed: number) => void
}

let cleanup: (() => void) | null = null
let rebuildDevices: (() => void) | null = null
let syncInteraction: (() => void) | null = null
let restOn: ((furnitureId: string, pose: RestPose) => void) | null = null
let standUp: (() => void) | null = null
let operateBreaker: (() => void) | null = null
let walkToBreaker: (() => void) | null = null

onMounted(async () => {
  const [THREE, { OrbitControls }, { RoundedBoxGeometry }, { GLTFLoader }] = await Promise.all([
    import('three'),
    import('three/examples/jsm/controls/OrbitControls.js'),
    import('three/examples/jsm/geometries/RoundedBoxGeometry.js'),
    import('three/examples/jsm/loaders/GLTFLoader.js')
  ])
  const container = containerEl.value
  if (!container) return

  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true })
  } catch (err) {
    console.error('[RoomScene] WebGL 初始化失敗', err)
    webglFailed.value = true
    // 沒有 3D 場景可等，讓外層的 loading 畫面直接結束
    emit('loaded', 'scene')
    emit('loaded', 'furniture')
    return
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#141821')

  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 100)
  camera.position.set(ROOM_CENTER_X + 7, 5.8, 7.8)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(ROOM_CENTER_X, 0.9, 0)
  controls.enableDamping = true
  controls.minDistance = props.mode === 'player' ? 3 : 4
  controls.maxDistance = props.mode === 'player' ? 10 : 16
  // 角色模式下鏡頭中心跟著角色走，平移會跟這個打架
  controls.enablePan = props.mode !== 'player'
  // 限制只能從房間「開口」這一側看，不然鏡頭繞到牆後面會整個被擋住
  controls.minAzimuthAngle = -0.15
  controls.maxAzimuthAngle = Math.PI / 2 + 0.15
  controls.maxPolarAngle = Math.PI / 2 - 0.05
  controls.update()

  const hemisphere = new THREE.HemisphereLight('#cfd8ea', '#2a2f3a', 0.9)
  scene.add(hemisphere)
  const sun = new THREE.DirectionalLight('#ffffff', 1.4)
  // 停電、晚上時兩個環境光一起調暗，用倍率記住原本的亮度
  const baseLight = { hemisphere: hemisphere.intensity, sun: sun.intensity }
  // 第一格直接套用目標亮度，晚上打開頁面時不會從白天慢慢暗下來
  let lightLevel = Number.NaN
  let lampFill = Number.NaN
  const dayColors = {
    lamp: new THREE.Color('#ffd9a8'),
    sun: new THREE.Color('#ffffff'),
    sunTwilight: new THREE.Color('#ffb070'),
    sky: new THREE.Color('#cfd8ea'),
    skyNight: new THREE.Color('#4a5878')
  }
  sun.position.set(4, 8, 5)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.left = -6
  sun.shadow.camera.right = 6
  sun.shadow.camera.top = 6
  sun.shadow.camera.bottom = -6
  scene.add(sun)

  // ---- 房間外殼：地板 + 兩面牆 ----
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(ROOM_WIDTH, 0.1, ROOM_DEPTH),
    new THREE.MeshStandardMaterial({ color: '#8a6f55', roughness: 0.85 })
  )
  floor.position.set(ROOM_CENTER_X, -0.05, 0)
  floor.receiveShadow = true
  scene.add(floor)

  // 廚房地板鋪一塊淺色磁磚，看得出是另一個區域
  const kitchenFloor = new THREE.Mesh(
    new THREE.BoxGeometry(2.3, 0.012, 1.9),
    new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.6 })
  )
  kitchenFloor.position.set(ROOM_MAX_X - 1.15, 0.006, -ROOM_DEPTH / 2 + 0.95)
  kitchenFloor.receiveShadow = true
  scene.add(kitchenFloor)

  const wallMaterial = new THREE.MeshStandardMaterial({ color: '#d9dde4', roughness: 0.95 })
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(ROOM_WIDTH, WALL_HEIGHT, 0.1), wallMaterial)
  backWall.position.set(ROOM_CENTER_X, WALL_HEIGHT / 2, -ROOM_DEPTH / 2 - 0.05)
  backWall.receiveShadow = true
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.1, WALL_HEIGHT, ROOM_DEPTH), wallMaterial)
  leftWall.position.set(ROOM_MIN_X - 0.05, WALL_HEIGHT / 2, 0)
  leftWall.receiveShadow = true
  scene.add(backWall, leftWall)

  // 家電機身一律用圓角，跟家具、角色的圓潤風格一致
  const roundedBox = (width: number, height: number, depth: number, radius: number) =>
    new RoundedBoxGeometry(width, height, depth, 4, radius)

  // ---- 廚房上方的窗戶：窗外的天色跟著時間變（白天藍天、傍晚橘紅、晚上星空和月亮） ----
  const windowCanvas = document.createElement('canvas')
  windowCanvas.width = 160
  windowCanvas.height = 110
  const windowCtx = windowCanvas.getContext('2d')!
  const windowTexture = new THREE.CanvasTexture(windowCanvas)
  windowTexture.colorSpace = THREE.SRGBColorSpace
  const windowGroup = new THREE.Group()
  windowGroup.position.set(3.55, 1.95, -ROOM_DEPTH / 2 + 0.01)
  scene.add(windowGroup)
  const windowGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.75), new THREE.MeshBasicMaterial({ map: windowTexture }))
  windowGlass.position.z = 0.012
  windowGroup.add(windowGlass)
  const frameMaterial = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.6 })
  for (const [w, h, x, y] of [
    [1.24, 0.07, 0, 0.41],
    [1.24, 0.07, 0, -0.41],
    [0.07, 0.89, -0.585, 0],
    [0.07, 0.89, 0.585, 0],
    [0.035, 0.75, 0, 0],
    [1.1, 0.035, 0, 0]
  ] as const) {
    const bar = new THREE.Mesh(roundedBox(w, h, 0.05, 0.015), frameMaterial)
    bar.position.set(x, y, 0.025)
    windowGroup.add(bar)
  }
  const sill = new THREE.Mesh(roundedBox(1.32, 0.04, 0.12, 0.015), frameMaterial)
  sill.position.set(0, -0.46, 0.06)
  windowGroup.add(sill)

  // 星星位置固定，每次重畫都一樣
  const stars = Array.from({ length: 18 }, (_, i) => ({ x: (i * 53) % 160, y: (i * 37) % 70, r: i % 3 === 0 ? 1.3 : 0.8 }))
  let drawnHour = Number.NaN
  function drawWindow(hour: number) {
    // 每 6 分鐘重畫一次就夠，天色變化很慢
    if (Math.abs(hour - drawnHour) < 0.1) return
    drawnHour = hour
    const { daylight, twilight } = dayCycle(hour)
    const sky = new THREE.Color('#0d1730').lerp(new THREE.Color('#7cc4f2'), daylight)
    const horizon = new THREE.Color('#1c2a4a').lerp(new THREE.Color('#cdeaff'), daylight).lerp(new THREE.Color('#ffb27a'), twilight * 0.8)
    const gradient = windowCtx.createLinearGradient(0, 0, 0, windowCanvas.height)
    gradient.addColorStop(0, `#${sky.getHexString()}`)
    gradient.addColorStop(1, `#${horizon.getHexString()}`)
    windowCtx.fillStyle = gradient
    windowCtx.fillRect(0, 0, windowCanvas.width, windowCanvas.height)
    // 夜裡的星星
    windowCtx.fillStyle = `rgba(255, 255, 255, ${(1 - daylight) * 0.9})`
    for (const star of stars) {
      windowCtx.beginPath()
      windowCtx.arc(star.x, star.y, star.r, 0, Math.PI * 2)
      windowCtx.fill()
    }
    // 白天太陽、晚上月亮，從左邊升起、右邊落下
    const isDay = daylight > 0.5
    const progress = isDay ? (hour - 6) / 12 : ((hour + 6) % 24) / 12
    const x = 20 + Math.min(1, Math.max(0, progress)) * 120
    const y = 70 - Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI) * 50
    windowCtx.fillStyle = isDay ? `#${new THREE.Color('#fff3b0').lerp(new THREE.Color('#ff9a5a'), twilight).getHexString()}` : '#f3f0dc'
    windowCtx.beginPath()
    windowCtx.arc(x, y, isDay ? 11 : 9, 0, Math.PI * 2)
    windowCtx.fill()
    // 遠方的山
    windowCtx.fillStyle = `#${new THREE.Color('#1a2438').lerp(new THREE.Color('#6fae7a'), daylight).getHexString()}`
    windowCtx.beginPath()
    windowCtx.moveTo(0, 110)
    for (let px = 0; px <= 160; px += 10) windowCtx.lineTo(px, 92 - Math.sin(px / 22) * 8 - Math.sin(px / 9) * 3)
    windowCtx.lineTo(160, 110)
    windowCtx.fill()
    windowTexture.needsUpdate = true
  }

  // ---- 電箱：掛在左牆最前面，跳電時總開關往下、指示燈閃紅燈 ----
  const breakerBox = new THREE.Group()
  breakerBox.position.set(ROOM_MIN_X + 0.06, 1.45, ROOM_DEPTH / 2 - 0.25)
  breakerBox.rotation.y = Math.PI / 2
  scene.add(breakerBox)
  const breakerBody = new THREE.Mesh(roundedBox(0.34, 0.44, 0.1, 0.025), new THREE.MeshStandardMaterial({ color: '#c3c9d1', roughness: 0.5 }))
  breakerBody.castShadow = true
  breakerBox.add(breakerBody)
  const breakerDoor = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.2), new THREE.MeshStandardMaterial({ color: '#aab1bb', roughness: 0.5 }))
  breakerDoor.position.set(0, 0.07, 0.051)
  breakerBox.add(breakerDoor)
  const warning = new THREE.Mesh(new THREE.CircleGeometry(0.035, 3), new THREE.MeshStandardMaterial({ color: '#f2c14e' }))
  warning.position.set(0, -0.12, 0.051)
  breakerBox.add(warning)
  // 總開關：繞著樞紐轉，往上是有電、往下是跳電
  const breakerLever = new THREE.Group()
  breakerLever.position.set(0, 0.07, 0.06)
  breakerBox.add(breakerLever)
  const leverHandle = new THREE.Mesh(roundedBox(0.05, 0.1, 0.03, 0.012), new THREE.MeshStandardMaterial({ color: '#2b2f36' }))
  leverHandle.position.y = 0.04
  breakerLever.add(leverHandle)
  const breakerLedMaterial = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#3ecf8e', emissiveIntensity: 1.5 })
  const breakerLed = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), breakerLedMaterial)
  breakerLed.position.set(0.12, 0.17, 0.055)
  breakerBox.add(breakerLed)
  breakerBox.traverse((obj) => {
    obj.userData.breaker = true
  })
  breakerBox.updateMatrixWorld(true)
  const breakerBounds = new THREE.Box3().setFromObject(breakerBox)
  const breakerRect = { minX: breakerBounds.min.x, maxX: breakerBounds.max.x, minZ: breakerBounds.min.z, maxZ: breakerBounds.max.z }
  const breakerLabelAnchor = new THREE.Vector3(ROOM_MIN_X + 0.1, 1.85, ROOM_DEPTH / 2 - 0.25)

  function animateBreaker(dt: number, elapsed: number) {
    const target = props.powerOut ? 0.9 : -0.9
    breakerLever.rotation.x += (target - breakerLever.rotation.x) * Math.min(1, dt * 10)
    breakerLedMaterial.emissive.set(props.powerOut ? LEVEL_COLORS.alert : LEVEL_COLORS.active)
    breakerLedMaterial.emissiveIntensity = props.powerOut ? (Math.sin(elapsed * 8) > 0 ? 2.5 : 0.2) : 1.5
  }

  // ---- 電器 ----
  const deviceRoot = new THREE.Group()
  scene.add(deviceRoot)
  let rigs = new Map<string, DeviceRig>()
  // 角色碰撞與互動範圍用的方塊：電器的跟著電器重建，家具的等模型載完才有
  let deviceColliders: Collider[] = []
  let furnitureColliders: Collider[] = []
  let colliders: Collider[] = []
  let furnitureRoot: THREE.Object3D | null = null
  let furniture: FurnitureInteractable[] = []

  // 家具只是裝飾，載入失敗也不影響操作家電
  let disposed = false
  loadRoomFurniture(THREE, GLTFLoader)
    .then(({ root, colliders: loaded, interactables }) => {
      if (disposed) {
        disposeObject(root)
        return
      }
      scene.add(root)
      furnitureRoot = root
      furniture = interactables
      furnitureColliders = loaded
      colliders = [...deviceColliders, ...furnitureColliders]
      emit('loaded', 'furniture')
    })
    .catch((err) => {
      console.error('[RoomScene] 家具載入失敗', err)
      emit('loaded', 'furniture')
    })

  const levelColor = (level: VisualLevel) => new THREE.Color(LEVEL_COLORS[level])

  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material) {
    const m = new THREE.Mesh(geometry, material)
    m.castShadow = true
    m.receiveShadow = true
    return m
  }

  function statusLed(group: THREE.Group, position: THREE.Vector3) {
    const material = new THREE.MeshStandardMaterial({ color: '#000000', emissiveIntensity: 2 })
    const led = mesh(new THREE.SphereGeometry(0.035, 12, 12), material)
    led.position.copy(position)
    group.add(led)
    return material
  }

  // 超過閾值時機身快速脈動發紅光、接近閾值時緩慢脈動發黃光；其他狀態不發光，只靠指示燈與點光源表達。
  function applyAlertGlow(material: THREE.MeshStandardMaterial, level: VisualLevel, elapsed: number) {
    if (level === 'alert') {
      material.emissive.set(LEVEL_COLORS.alert)
      material.emissiveIntensity = 0.35 + 0.25 * Math.sin(elapsed * 4)
    } else if (level === 'warning') {
      material.emissive.set(LEVEL_COLORS.warning)
      material.emissiveIntensity = 0.18 + 0.12 * Math.sin(elapsed * 2)
    } else {
      material.emissiveIntensity = 0
    }
  }

  function buildAirConditioner(): DeviceRig {
    const group = new THREE.Group()
    const body = new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.4 })
    group.add(mesh(roundedBox(1.4, 0.42, 0.28, 0.09), body))

    const flapMaterial = new THREE.MeshStandardMaterial({ color: '#dfe3e8', roughness: 0.5 })
    const flapPivot = new THREE.Group()
    flapPivot.position.set(0, -0.2, 0.12)
    const flap = mesh(roundedBox(1.1, 0.02, 0.12, 0.009), flapMaterial)
    flap.position.z = 0.06
    flapPivot.add(flap)
    group.add(flapPivot)

    const led = statusLed(group, new THREE.Vector3(0.58, -0.08, 0.145))

    // 出風：幾條半透明的細長條往下飄，開機時才看得到
    const windMaterial = new THREE.MeshBasicMaterial({ color: '#bfe3ff', transparent: true, opacity: 0 })
    const winds = Array.from({ length: 4 }, (_, i) => {
      const wind = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.012, 0.012), windMaterial)
      wind.userData.phase = i / 4
      group.add(wind)
      return wind
    })

    const statusLight = new THREE.PointLight('#ffffff', 0, 2.5)
    statusLight.position.set(0, -0.4, 0.5)
    group.add(statusLight)

    return {
      group,
      statusLight,
      lightColor: new THREE.Color('#bfe3ff'),
      labelAnchor: new THREE.Vector3(0, 0.45, 0.2),
      aimAnchor: new THREE.Vector3(0, 0, 0.14),
      animate(level, _reading, dt, elapsed) {
        const on = level !== 'off' && level !== 'idle'
        led.emissive.copy(levelColor(level))
        applyAlertGlow(body, level, elapsed)
        const targetAngle = on ? 0.9 + 0.25 * Math.sin(elapsed * 0.8) : 0
        flapPivot.rotation.x += (targetAngle - flapPivot.rotation.x) * Math.min(1, dt * 3)
        windMaterial.opacity += ((on ? 0.45 : 0) - windMaterial.opacity) * Math.min(1, dt * 3)
        for (const wind of winds) {
          const t = (elapsed * 0.5 + (wind.userData.phase as number)) % 1
          wind.position.set(0, -0.3 - t * 1.4, 0.3 + t * 0.9)
          wind.scale.x = 1 - t * 0.4
        }
      }
    }
  }

  function buildTv(): DeviceRig {
    const group = new THREE.Group()
    const cabinet = new THREE.MeshStandardMaterial({ color: '#4a3b2f', roughness: 0.7 })
    const stand = mesh(roundedBox(2, 0.5, 0.5, 0.08), cabinet)
    stand.position.y = 0.25
    group.add(stand)

    const frame = new THREE.MeshStandardMaterial({ color: '#16181d', roughness: 0.3 })
    const panel = mesh(roundedBox(1.7, 1, 0.06, 0.029), frame)
    panel.position.set(0, 1.15, 0)
    group.add(panel)
    const neck = mesh(roundedBox(0.12, 0.2, 0.06, 0.029), frame)
    neck.position.set(0, 0.6, 0)
    group.add(neck)

    // 螢幕：節目畫在 canvas 上當作發光貼圖；關機時亮度降到 0，只剩黑色玻璃的反光
    const program = createTvProgram(THREE)
    const screen = new THREE.MeshStandardMaterial({
      color: '#050608',
      emissive: '#ffffff',
      emissiveMap: program.texture,
      emissiveIntensity: 0,
      roughness: 0.2
    })
    const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.58, 0.88), screen)
    screenMesh.position.set(0, 1.15, 0.031)
    group.add(screenMesh)

    const led = statusLed(group, new THREE.Vector3(0.78, 0.68, 0.03))

    const statusLight = new THREE.PointLight('#8ab4ff', 0, 3)
    statusLight.position.set(0, 1.15, 0.6)
    group.add(statusLight)

    // 跑馬燈：各家電與全屋的即時用電
    const ticker = () => {
      let total = 0
      const parts = props.devices.map((device) => {
        const watts = props.readings[device.id]?.power_watts ?? 0
        total += watts
        return `${device.name} ${watts.toLocaleString()} W`
      })
      return `全屋用電 ${total.toLocaleString()} W　｜　${parts.join('　・　')}`
    }

    const lightColor = new THREE.Color('#8ab4ff')
    let brightness = 0
    return {
      group,
      statusLight,
      lightColor,
      labelAnchor: new THREE.Vector3(0, 1.85, 0),
      aimAnchor: new THREE.Vector3(0, 1.15, 0.03),
      animate(level, _reading, dt, elapsed) {
        led.emissive.copy(levelColor(level))
        applyAlertGlow(frame, level, elapsed)
        // 開機時畫面淡入，關機時很快暗掉
        const on = level !== 'off'
        brightness += ((on ? 1 : 0) - brightness) * Math.min(1, dt * (on ? 3 : 10))
        screen.emissiveIntensity = brightness
        if (brightness > 0.01) program.draw(elapsed, ticker)
        lightColor.copy(program.glow)
      }
    }
  }

  function buildWasher(): DeviceRig {
    const group = new THREE.Group()
    // 機身、面板、窗口放在同一組，脫水時整台一起震動
    const shell = new THREE.Group()
    group.add(shell)
    const body = new THREE.MeshStandardMaterial({ color: '#eef1f4', roughness: 0.35 })
    const box = mesh(roundedBox(0.85, 0.9, 0.65, 0.1), body)
    box.position.y = 0.45
    shell.add(box)

    // 操作面板內縮，不要突出到圓角外面
    const panelMaterial = new THREE.MeshStandardMaterial({ color: '#c8ced6', roughness: 0.4 })
    const panel = mesh(roundedBox(0.62, 0.12, 0.02, 0.009), panelMaterial)
    panel.position.set(0, 0.76, 0.33)
    shell.add(panel)

    // 窗口裡的滾筒、衣服、水都是純視覺效果，不設 castShadow（只有門框會），才不會被算進碰撞範圍
    const washerWindow = createWasherWindow(THREE)
    washerWindow.group.position.set(0, 0.4, 0.325)
    shell.add(washerWindow.group)

    const led = statusLed(shell, new THREE.Vector3(0.22, 0.76, 0.345))

    const statusLight = new THREE.PointLight('#ffffff', 0, 2.5)
    statusLight.position.set(0, 0.6, 0.8)
    group.add(statusLight)

    return {
      group,
      statusLight,
      lightColor: new THREE.Color('#ffffff'),
      labelAnchor: new THREE.Vector3(0, 1.15, 0),
      aimAnchor: new THREE.Vector3(0, 0.4, 0.33),
      animate(level, reading, dt, elapsed) {
        led.emissive.copy(levelColor(level))
        applyAlertGlow(body, level, elapsed)
        const shake = washerWindow.update(reading?.wash_phase ?? null, reading?.power_watts ?? 0, dt, elapsed)
        shell.position.x = Math.sin(elapsed * 40) * 0.004 * shake
      }
    }
  }

  // ---- 廚房：微波爐、熱水壺各自帶一段流理台，並排起來就是一整條檯面 ----
  const COUNTER_HEIGHT = 0.9
  function buildCounter(group: THREE.Group) {
    const cabinet = mesh(roundedBox(0.7, COUNTER_HEIGHT - 0.04, 0.6, 0.04), new THREE.MeshStandardMaterial({ color: '#ece6da', roughness: 0.6 }))
    cabinet.position.y = (COUNTER_HEIGHT - 0.04) / 2
    group.add(cabinet)
    const top = mesh(roundedBox(0.72, 0.05, 0.64, 0.02), new THREE.MeshStandardMaterial({ color: '#a07e5e', roughness: 0.7 }))
    top.position.y = COUNTER_HEIGHT - 0.02
    group.add(top)
    const handle = mesh(roundedBox(0.16, 0.025, 0.025, 0.012), new THREE.MeshStandardMaterial({ color: '#8a8f98', metalness: 0.5, roughness: 0.4 }))
    handle.position.set(0, COUNTER_HEIGHT - 0.16, 0.31)
    group.add(handle)
  }

  function buildMicrowave(): DeviceRig {
    const group = new THREE.Group()
    buildCounter(group)
    const body = new THREE.MeshStandardMaterial({ color: '#f3f3f1', roughness: 0.4 })
    const box = mesh(roundedBox(0.52, 0.3, 0.38, 0.04), body)
    box.position.set(0, COUNTER_HEIGHT + 0.15, -0.02)
    group.add(box)

    // 門上的窗：加熱時裡面亮起暖黃色的光
    const glass = new THREE.MeshStandardMaterial({ color: '#1d2129', emissive: '#ffc864', emissiveIntensity: 0, roughness: 0.2 })
    const windowMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.19), glass)
    windowMesh.position.set(-0.07, COUNTER_HEIGHT + 0.15, 0.172)
    group.add(windowMesh)
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.22), new THREE.MeshStandardMaterial({ color: '#d5d8dd', roughness: 0.5 }))
    panel.position.set(0.17, COUNTER_HEIGHT + 0.15, 0.172)
    group.add(panel)
    const led = statusLed(group, new THREE.Vector3(0.17, COUNTER_HEIGHT + 0.22, 0.18))

    const statusLight = new THREE.PointLight('#ffd27a', 0, 1.8)
    statusLight.position.set(-0.07, COUNTER_HEIGHT + 0.15, 0.45)
    group.add(statusLight)

    return {
      group,
      statusLight,
      lightColor: new THREE.Color('#ffd27a'),
      labelAnchor: new THREE.Vector3(0, COUNTER_HEIGHT + 0.55, 0),
      aimAnchor: new THREE.Vector3(0.17, COUNTER_HEIGHT + 0.12, 0.18),
      animate(level, reading, dt, elapsed) {
        led.emissive.copy(levelColor(level))
        applyAlertGlow(body, level, elapsed)
        const running = reading?.status === 'running'
        const target = running ? 1.1 + 0.15 * Math.sin(elapsed * 6) : 0
        glass.emissiveIntensity += (target - glass.emissiveIntensity) * Math.min(1, dt * 6)
      }
    }
  }

  function buildKettle(): DeviceRig {
    const group = new THREE.Group()
    buildCounter(group)
    const base = mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.03, 24), new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.5 }))
    base.position.y = COUNTER_HEIGHT + 0.015
    group.add(base)
    const body = new THREE.MeshStandardMaterial({ color: '#e8564e', roughness: 0.35 })
    const pot = mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.2, 24), body)
    pot.position.y = COUNTER_HEIGHT + 0.13
    group.add(pot)
    const lid = mesh(new THREE.SphereGeometry(0.076, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), body)
    lid.scale.y = 0.4
    lid.position.y = COUNTER_HEIGHT + 0.23
    group.add(lid)
    const knob = mesh(new THREE.SphereGeometry(0.018, 12, 8), new THREE.MeshStandardMaterial({ color: '#2b2f36' }))
    knob.position.y = COUNTER_HEIGHT + 0.26
    group.add(knob)
    const handle = mesh(new THREE.TorusGeometry(0.06, 0.014, 8, 16, Math.PI), new THREE.MeshStandardMaterial({ color: '#2b2f36' }))
    handle.rotation.set(0, Math.PI / 2, -Math.PI / 2)
    handle.position.set(-0.095, COUNTER_HEIGHT + 0.14, 0)
    group.add(handle)
    const spout = mesh(new THREE.ConeGeometry(0.025, 0.07, 12), body)
    spout.rotation.z = -Math.PI / 2.6
    spout.position.set(0.1, COUNTER_HEIGHT + 0.18, 0)
    group.add(spout)
    const led = statusLed(group, new THREE.Vector3(0, COUNTER_HEIGHT + 0.03, 0.105))

    // 煮水時壺嘴冒出一團團蒸氣往上飄（純視覺效果，不設 castShadow）
    const steamMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false })
    const steam = Array.from({ length: 5 }, () => {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), steamMaterial.clone())
      group.add(puff)
      return puff
    })

    const statusLight = new THREE.PointLight('#ff9a6b', 0, 1.5)
    statusLight.position.set(0, COUNTER_HEIGHT + 0.2, 0.35)
    group.add(statusLight)

    let steaming = 0
    return {
      group,
      statusLight,
      lightColor: new THREE.Color('#ff9a6b'),
      labelAnchor: new THREE.Vector3(0, COUNTER_HEIGHT + 0.55, 0),
      aimAnchor: new THREE.Vector3(-0.08, COUNTER_HEIGHT + 0.16, 0),
      animate(level, reading, dt, elapsed) {
        led.emissive.copy(levelColor(level))
        applyAlertGlow(body, level, elapsed)
        steaming += ((reading?.status === 'running' ? 1 : 0) - steaming) * Math.min(1, dt * 1.5)
        steam.forEach((puff, i) => {
          const t = (elapsed * 0.6 + i / steam.length) % 1
          puff.visible = steaming > 0.02
          puff.position.set(0.14 + t * 0.06 + Math.sin(elapsed * 2 + i) * 0.02, COUNTER_HEIGHT + 0.22 + t * 0.45, 0)
          puff.scale.setScalar(0.6 + t * 1.4)
          ;(puff.material as THREE.MeshBasicMaterial).opacity = steaming * 0.55 * Math.sin(t * Math.PI)
        })
      }
    }
  }

  function buildFridge(): DeviceRig {
    const group = new THREE.Group()
    const body = new THREE.MeshStandardMaterial({ color: '#e6ebef', roughness: 0.35 })
    const box = mesh(roundedBox(0.72, 1.75, 0.66, 0.07), body)
    box.position.y = 0.875
    group.add(box)
    // 冷凍、冷藏兩扇門之間的縫
    const seam = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.012), new THREE.MeshStandardMaterial({ color: '#9aa3ad' }))
    seam.position.set(0, 1.22, 0.331)
    group.add(seam)
    const handleMaterial = new THREE.MeshStandardMaterial({ color: '#9aa4b1', metalness: 0.6, roughness: 0.3 })
    for (const [y, h] of [[1.42, 0.3], [0.85, 0.5]] as const) {
      const handle = mesh(roundedBox(0.035, h, 0.04, 0.015), handleMaterial)
      handle.position.set(0.26, y, 0.35)
      group.add(handle)
    }
    // 門上的冰箱貼
    ;['#f2c14e', '#7fb7e6', '#e05a5a'].forEach((color, i) => {
      const magnet = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }))
      magnet.position.set(-0.18 + i * 0.09, 1.45 - (i % 2) * 0.07, 0.331)
      group.add(magnet)
    })
    const led = statusLed(group, new THREE.Vector3(-0.25, 1.62, 0.335))

    const statusLight = new THREE.PointLight('#cfe8ff', 0, 1.5)
    statusLight.position.set(0, 1.2, 0.6)
    group.add(statusLight)

    return {
      group,
      statusLight,
      lightColor: new THREE.Color('#cfe8ff'),
      labelAnchor: new THREE.Vector3(0, 2.05, 0),
      aimAnchor: new THREE.Vector3(0.26, 1.0, 0.35),
      // 冰箱一直開著，點光源打在白色門上會變成一大塊亮斑，所以不用；接近／超過閾值時機身本身會發光
      glowScale: 0,
      animate(level, reading, _dt, elapsed) {
        led.emissive.copy(levelColor(level))
        applyAlertGlow(body, level, elapsed)
        // 壓縮機運轉時機身輕微震動
        box.position.x = reading?.status === 'running' ? Math.sin(elapsed * 50) * 0.0015 : 0
      }
    }
  }

  // 壁燈：裝在牆上（群組的 +Z 朝房間內），點光源就是燈本身的光
  function buildLight(): DeviceRig {
    const group = new THREE.Group()
    const wood = new THREE.MeshStandardMaterial({ color: '#7a5a43', roughness: 0.7 })
    const plate = mesh(roundedBox(0.16, 0.24, 0.04, 0.015), wood)
    plate.position.z = 0.02
    group.add(plate)
    const arm = mesh(roundedBox(0.03, 0.03, 0.16, 0.012), wood)
    arm.position.set(0, 0.02, 0.1)
    group.add(arm)
    const shade = new THREE.MeshStandardMaterial({
      color: '#f6efe2',
      emissive: '#ffcf86',
      emissiveIntensity: 0,
      roughness: 0.8,
      side: THREE.DoubleSide
    })
    const shadeMesh = mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.14, 24, 1, true), shade)
    shadeMesh.position.set(0, 0.02, 0.19)
    group.add(shadeMesh)
    const bulb = new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: '#ffe2a8', emissiveIntensity: 0 })
    const bulbMesh = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), bulb)
    bulbMesh.position.set(0, -0.03, 0.19)
    group.add(bulbMesh)

    const statusLight = new THREE.PointLight('#ffd9a0', 0, 6, 1.5)
    statusLight.position.set(0, -0.15, 0.35)
    group.add(statusLight)

    return {
      group,
      statusLight,
      lightColor: new THREE.Color('#ffd9a0'),
      labelAnchor: new THREE.Vector3(0, 0.3, 0.15),
      aimAnchor: new THREE.Vector3(0, 0, 0.2),
      glowScale: 2.5,
      animate(level, _reading, dt) {
        const on = level !== 'off'
        const target = on ? 1.2 : 0
        shade.emissiveIntensity += (target * 0.6 - shade.emissiveIntensity) * Math.min(1, dt * 6)
        bulb.emissiveIntensity += (target - bulb.emissiveIntensity) * Math.min(1, dt * 6)
      }
    }
  }

  const builders: Record<Device['kind'], () => DeviceRig> = {
    air_conditioner: buildAirConditioner,
    tv: buildTv,
    washer: buildWasher,
    fridge: buildFridge,
    microwave: buildMicrowave,
    kettle: buildKettle,
    light: buildLight
  }

  // 選取標記：選中的電器頭上有個上下浮動的倒三角
  const marker = new THREE.Mesh(
    new THREE.ConeGeometry(0.12, 0.22, 16),
    new THREE.MeshBasicMaterial({ color: '#ffd166' })
  )
  marker.rotation.x = Math.PI
  marker.visible = false
  scene.add(marker)

  function disposeObject(root: THREE.Object3D) {
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
        materials.forEach((m: THREE.Material) => {
          // 家具模型的貼圖、電視節目與窗外天色的 canvas 貼圖
          if (m instanceof THREE.MeshStandardMaterial) {
            m.map?.dispose()
            m.emissiveMap?.dispose()
          }
          if (m instanceof THREE.MeshBasicMaterial) m.map?.dispose()
          m.dispose()
        })
      }
    })
  }

  rebuildDevices = () => {
    for (const rig of rigs.values()) {
      deviceRoot.remove(rig.group)
      disposeObject(rig.group)
    }
    rigs = new Map()
    for (const device of props.devices) {
      const rig = builders[device.kind]()
      const { x, y, z, rotation } = device.room_position
      rig.group.position.set(x, y, z)
      rig.group.rotation.y = rotation
      rig.group.traverse((obj) => {
        obj.userData.deviceId = device.id
      })
      deviceRoot.add(rig.group)
      rigs.set(device.id, rig)
    }

    // 只用會投射陰影的實體零件算範圍：冷氣的出風線、光源這些純視覺效果不該擋路
    deviceRoot.updateMatrixWorld(true)
    deviceColliders = [...rigs.entries()].map(([deviceId, rig]) => {
      const box = new THREE.Box3()
      rig.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.castShadow) box.union(new THREE.Box3().setFromObject(obj))
      })
      return {
        deviceId,
        minX: box.min.x,
        maxX: box.max.x,
        minZ: box.min.z,
        maxZ: box.max.z,
        solid: box.min.y < PLAYER_HEIGHT
      }
    })
    colliders = [...deviceColliders, ...furnitureColliders]
  }
  rebuildDevices()

  // ---- 角色（前台） ----
  const player =
    props.mode === 'player'
      ? createPlayerController(THREE, {
          camera,
          bounds: ROOM_BOUNDS,
          // 要避開家具，起點在沙發右後方的空地
          start: { x: 1.2, z: 1.4 },
          onArrive: (id) => (id === BREAKER_TARGET ? operateBreaker?.() : emit('arrive', id)),
          onRestChange: (pose) => {
            resting = pose !== null
            emit('rest', pose)
          },
          RoundedBoxGeometry
        })
      : null
  let resting = false
  // 目前回報給外層的互動對象，用「種類:代號」比對有沒有變
  let nearbyKey: string | null = null
  const followTarget = new THREE.Vector3()
  if (player) {
    scene.add(player.object)
    controls.target.set(player.position.x, 0.9, player.position.z)
    camera.position.set(player.position.x + 3.6, 3.4, player.position.z + 4.4)
    controls.update()
  }

  // ---- 點選電器 ----
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let downAt = { x: 0, y: 0 }
  const onPointerDown = (e: PointerEvent) => {
    downAt = { x: e.clientX, y: e.clientY }
  }
  const onPointerUp = (e: PointerEvent) => {
    // 拖曳旋轉鏡頭的放開動作不算點擊
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    // 家電、家具、電箱一起判斷，才知道點到的是前面那一個
    const hit = raycaster.intersectObjects(furnitureRoot ? [deviceRoot, furnitureRoot, breakerBox] : [deviceRoot, breakerBox], true)[0]
    const id = hit?.object.userData.deviceId as string | undefined

    if (!player) {
      if (id) emit('select', id)
      return
    }
    // 點電箱：走過去扳總開關（有電時也可以走過去看看，只是不會怎樣）
    if (hit?.object.userData.breaker) {
      walkToBreaker?.()
      return
    }
    // 點可以坐、躺的家具：走過去做它的第一個動作（沙發是坐下、床是睡覺）
    const furnitureId = hit?.object.userData.furnitureId as string | undefined
    const item = furnitureId ? furniture.find((f) => f.id === furnitureId) : undefined
    if (item) {
      restOn?.(item.id, item.actions[0]!.pose)
      return
    }
    // 角色模式：點家電就走到它旁邊（停在互動範圍內），點地板就走到那個點
    const collider = id ? colliders.find((c) => c.deviceId === id) : undefined
    if (id && collider) {
      const point = closestPointOnRect(player.position.x, player.position.z, collider)
      player.walkTo({ ...point, stopDistance: INTERACT_RANGE - 0.3, deviceId: id })
      return
    }
    const floorHit = raycaster.intersectObject(floor)[0]
    if (floorHit) player.walkTo({ x: floorHit.point.x, z: floorHit.point.z, stopDistance: 0.05, deviceId: null })
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointerup', onPointerUp)

  // ---- 尺寸 ----
  let width = 1
  let height = 1
  const resize = () => {
    width = container.clientWidth || 1
    height = container.clientHeight || 1
    renderer.setSize(width, height)
    camera.aspect = width / height
    // 直式螢幕（手機）時把垂直視角放大，讓水平可視範圍維持跟寬螢幕差不多，
    // 不然房間兩側的電器會被切掉
    const horizontalFov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) * WIDE_ASPECT)
    camera.fov = Math.min(
      MAX_FOV,
      Math.max(BASE_FOV, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(horizontalFov / 2) / camera.aspect)))
    )
    camera.updateProjectionMatrix()
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)
  resize()

  // ---- 動畫迴圈 ----
  const timer = new THREE.Timer()
  const projected = new THREE.Vector3()
  let frame = 0
  // HTML 標籤跟著 3D 位置走：每格把錨點投影到螢幕座標，直接寫 style，
  // 不經過 Vue 的響應式更新，避免每秒 60 次觸發元件重新渲染。
  // 家電多了以後標籤會疊在一起：依優先順序一個個放，撞到已經放好的就往上移到它的上方
  const LABEL_GAP = 3
  const labelQueue: { el: HTMLDivElement; x: number; y: number; behind: boolean; priority: number }[] = []
  const placedLabels: { left: number; right: number; top: number; bottom: number }[] = []
  function placeLabels() {
    labelQueue.sort((a, b) => a.priority - b.priority)
    placedLabels.length = 0
    for (const item of labelQueue) {
      item.el.style.opacity = item.behind ? '0' : '1'
      if (item.behind) continue
      const w = item.el.offsetWidth
      const h = item.el.offsetHeight
      const left = item.x - w / 2
      let top = item.y - h
      for (let tries = 0; tries < labelQueue.length; tries++) {
        const hit = placedLabels.find((p) => left < p.right && left + w > p.left && top < p.bottom && top + h > p.top)
        if (!hit) break
        top = hit.top - h - LABEL_GAP
      }
      placedLabels.push({ left, right: left + w, top, bottom: top + h })
      item.el.style.transform = `translate(${left}px, ${top}px)`
    }
    labelQueue.length = 0
  }

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick)
    timer.update(now)
    const dt = Math.min(timer.getDelta(), 0.1)
    const elapsed = timer.getElapsed()

    const cycle = dayCycle(props.hour)
    const dayLevel = NIGHT_LIGHT + (1 - NIGHT_LIGHT) * cycle.daylight
    const targetLevel = (props.powerOut ? OUTAGE_LIGHT : 1) * dayLevel
    lightLevel = Number.isNaN(lightLevel) ? targetLevel : lightLevel + (targetLevel - lightLevel) * Math.min(1, dt * 3)
    // 開著的電燈補環境光：只在天暗時有感（白天本來就亮），停電時燈都關了自然是 0
    const litLamps = props.devices.filter((d) => d.kind === 'light' && props.readings[d.id]?.status === 'on').length
    const targetFill = Math.min(MAX_LAMP_FILL, litLamps * LAMP_FILL) * (1 - cycle.daylight)
    lampFill = Number.isNaN(lampFill) ? targetFill : lampFill + (targetFill - lampFill) * Math.min(1, dt * 6)
    hemisphere.intensity = baseLight.hemisphere * (lightLevel + lampFill)
    sun.intensity = baseLight.sun * lightLevel
    sun.color.copy(dayColors.sun).lerp(dayColors.sunTwilight, cycle.twilight * 0.7)
    hemisphere.color
      .copy(dayColors.skyNight)
      .lerp(dayColors.sky, cycle.daylight)
      .lerp(dayColors.lamp, lampFill / (lightLevel + lampFill + 0.001))
    drawWindow(props.hour)
    animateBreaker(dt, elapsed)
    if (breakerLabel.value) {
      projected.copy(breakerLabelAnchor).project(camera)
      labelQueue.push({
        el: breakerLabel.value,
        x: ((projected.x + 1) / 2) * width,
        y: ((1 - projected.y) / 2) * height,
        behind: projected.z > 1 || !props.powerOut,
        priority: 0
      })
    }

    for (const device of props.devices) {
      const rig = rigs.get(device.id)
      if (!rig) continue
      const reading = props.readings[device.id] ?? null
      const level = visualLevel(device, reading)
      rig.animate(level, reading, dt, elapsed)
      if (level === 'alert' || level === 'warning') rig.statusLight.color.set(LEVEL_COLORS[level])
      else rig.statusLight.color.copy(rig.lightColor)
      const targetIntensity = {
        off: 0,
        idle: 0,
        active: 1.2,
        warning: 1.6 + 0.4 * Math.sin(elapsed * 2),
        alert: 2.5 + Math.sin(elapsed * 4)
      }[level]
      const glow = targetIntensity * (rig.glowScale ?? 1)
      rig.statusLight.intensity += (glow - rig.statusLight.intensity) * Math.min(1, dt * 4)

      const label = labelEls.value[device.id]
      if (label) {
        projected.copy(rig.labelAnchor)
        rig.group.localToWorld(projected)
        projected.project(camera)
        labelQueue.push({
          el: label,
          x: ((projected.x + 1) / 2) * width,
          y: ((1 - projected.y) / 2) * height,
          behind: projected.z > 1,
          // 選取中、接近／超過閾值的標籤優先放在原位，其他的被擠開
          priority: device.id === props.selectedId ? 0 : level === 'alert' || level === 'warning' ? 1 : 2
        })
      }

      if (device.id === props.selectedId) {
        marker.visible = true
        marker.position.copy(rig.labelAnchor)
        rig.group.localToWorld(marker.position)
        marker.position.y += 0.35 + Math.sin(elapsed * 3) * 0.06
      }
    }
    if (!props.selectedId || !rigs.has(props.selectedId)) marker.visible = false
    placeLabels()

    if (player) {
      player.update(dt, elapsed, colliders)
      // 鏡頭跟著角色：目標點與鏡頭位置一起平移同樣的距離，使用者轉過的視角維持不變
      followTarget.set(player.position.x, 0.9, player.position.z).sub(controls.target).multiplyScalar(Math.min(1, dt * 6))
      controls.target.add(followTarget)
      camera.position.add(followTarget)

      // 廚房的家電擠在一起，「最近的家電」常常不是正在操作的那台；改用距離判斷有沒有走開
      const operating = props.interactingId ? colliders.find((c) => c.deviceId === props.interactingId) : undefined
      if (operating && distanceToRect(player.position.x, player.position.z, operating) > INTERACT_RANGE) emit('leave')

      const next = resting ? null : nearestTarget(player.position.x, player.position.z)
      const key = next ? `${next.kind}:${next.id}` : null
      if (key !== nearbyKey) {
        nearbyKey = key
        emit('nearby', next)
      }
    }

    controls.update()
    renderer.render(scene, camera)
    if (!firstFrameDone) {
      firstFrameDone = true
      emit('loaded', 'scene')
    }
  }
  let firstFrameDone = false
  frame = requestAnimationFrame(tick)

  // 家電與家具取最近的那個；家具的範圍比較小（FURNITURE_RANGE）
  function nearestTarget(x: number, z: number): NearbyTarget | null {
    let best: { target: NearbyTarget; distance: number } | null = null
    const deviceId = nearestInteractable(x, z, colliders, INTERACT_RANGE)
    const device = deviceId ? colliders.find((c) => c.deviceId === deviceId) : undefined
    if (deviceId && device) best = { target: { kind: 'device', id: deviceId }, distance: distanceToRect(x, z, device) }
    for (const item of furniture) {
      const distance = distanceToRect(x, z, item.rect)
      if (distance <= FURNITURE_RANGE && (!best || distance < best.distance)) {
        best = { target: { kind: 'furniture', id: item.id, name: item.name, actions: item.actions }, distance }
      }
    }
    // 停電時電箱優先：家電都不能用了，靠近電箱就該提示復電
    if (props.powerOut && distanceToRect(x, z, breakerRect) <= BREAKER_RANGE) return { kind: 'breaker', id: 'breaker' }
    return best?.target ?? null
  }

  walkToBreaker = () => {
    if (!player) return
    const point = closestPointOnRect(player.position.x, player.position.z, breakerRect)
    player.walkTo({ ...point, stopDistance: BREAKER_RANGE - 0.3, deviceId: BREAKER_TARGET })
  }

  // 扳電箱：角色伸手按一下（0.8 秒後回到原本的動作），再通知外層呼叫復電 API
  operateBreaker = () => {
    if (!player) return
    const lever = breakerLever.getWorldPosition(new THREE.Vector3())
    player.setInteraction({ ...closestPointOnRect(player.position.x, player.position.z, breakerRect), style: 'reach', aim: lever })
    setTimeout(() => syncInteraction?.(), 800)
    emit('breaker')
  }

  restOn = (furnitureId, pose) => {
    const item = furniture.find((f) => f.id === furnitureId)
    if (!player || !item) return
    // 同一個動作有好幾個位置（沙發的兩個座位）時，選走過去最近的
    const spot = item.spots
      .filter((s) => s.pose === pose)
      .sort(
        (a, b) =>
          Math.hypot(a.approach.x - player.position.x, a.approach.z - player.position.z) -
          Math.hypot(b.approach.x - player.position.x, b.approach.z - player.position.z)
      )[0]
    if (spot) player.restAt(spot)
  }
  standUp = () => player?.standUp()

  syncInteraction = () => {
    const collider = colliders.find((c) => c.deviceId === props.interactingId)
    const device = props.devices.find((d) => d.id === props.interactingId)
    const rig = props.interactingId ? rigs.get(props.interactingId) : undefined
    if (!player || !collider || !device || !rig) {
      player?.setInteraction(null)
      return
    }
    const aim = rig.group.localToWorld(rig.aimAnchor.clone())
    player.setInteraction({
      ...closestPointOnRect(player.position.x, player.position.z, collider),
      // 洗衣機放在地上，蹲下來操作；冷氣、電視拿遙控器對著它按；其他（廚房家電、電燈開關）伸手去按
      style: device.kind === 'washer' ? 'crouch' : device.kind === 'air_conditioner' || device.kind === 'tv' ? 'remote' : 'reach',
      aim: { x: aim.x, y: aim.y, z: aim.z }
    })
  }

  cleanup = () => {
    disposed = true
    cancelAnimationFrame(frame)
    resizeObserver.disconnect()
    renderer.domElement.removeEventListener('pointerdown', onPointerDown)
    renderer.domElement.removeEventListener('pointerup', onPointerUp)
    controls.dispose()
    player?.dispose()
    disposeObject(scene)
    timer.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  }
})

watch(
  () => props.devices,
  () => rebuildDevices?.()
)

watch(
  () => props.interactingId,
  () => syncInteraction?.()
)

onBeforeUnmount(() => {
  cleanup?.()
  cleanup = null
  rebuildDevices = null
  syncInteraction = null
  restOn = null
  standUp = null
  operateBreaker = null
})

// 前台頁面用：按 E／R 或點提示按鈕時，讓角色坐下、躺下或起身
defineExpose({
  rest: (furnitureId: string, pose: RestPose) => restOn?.(furnitureId, pose),
  standUp: () => standUp?.(),
  operateBreaker: () => operateBreaker?.(),
  // 新手導覽的「帶我去電箱」：停電後鏡頭跟著角色，電箱常常在畫面外
  walkToBreaker: () => walkToBreaker?.()
})

function setLabelEl(id: string, el: unknown) {
  labelEls.value[id] = el instanceof HTMLDivElement ? el : null
}
</script>

<template>
  <!-- 圓角交給外層決定：後台是圓角卡片，前台是滿版 -->
  <div class="relative size-full overflow-hidden bg-scene">
    <div ref="containerEl" class="absolute inset-0" />
    <div class="pointer-events-none absolute inset-0" aria-hidden="true">
      <!-- 停電時在電箱上方提示 -->
      <!-- 外層的 transform 由動畫迴圈寫入位置，彈跳動畫放在內層，兩個 transform 才不會互相蓋掉 -->
      <div ref="breakerLabel" class="absolute top-0 left-0 opacity-0">
        <span
          class="flex animate-bounce items-center gap-1.5 rounded-full border border-alert bg-[rgb(15_18_25/0.88)] px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-alert"
        >
          ⚡ 電箱
        </span>
      </div>
      <!-- 位置由動畫迴圈每格直接寫 style.transform / opacity，所以初始是 opacity-0 -->
      <div
        v-for="device in devices"
        :key="device.id"
        :ref="(el) => setLabelEl(device.id, el)"
        class="absolute top-0 left-0 flex items-center gap-1.5 rounded-full border bg-[rgb(15_18_25/0.82)] px-2.5 py-1 text-xs whitespace-nowrap opacity-0 transition-opacity"
        :class="device.id === selectedId ? 'border-highlight' : 'border-line'"
        :style="{ '--level-color': LEVEL_COLORS[visualLevel(device, readings[device.id] ?? null)] }"
      >
        <!-- 接近／超過閾值時換成會跳動的驚嘆號，遠遠就看得到哪台家電快超過了 -->
        <span
          v-if="['warning', 'alert'].includes(visualLevel(device, readings[device.id] ?? null))"
          class="flex size-5 animate-bounce items-center justify-center rounded-full bg-(--level-color) text-xs font-black text-bg shadow-[0_0_10px_var(--level-color)]"
        >
          !
        </span>
        <span v-else class="size-2 rounded-full bg-(--level-color) shadow-[0_0_6px_var(--level-color)]" />
        {{ device.name }}
        <strong class="font-semibold tabular-nums">{{ readings[device.id]?.power_watts ?? '—' }} W</strong>
      </div>
    </div>
    <p v-if="webglFailed" class="absolute inset-x-4 bottom-4 text-sm text-muted">
      這個瀏覽器無法啟用 WebGL，3D 場景無法顯示；右側面板與圖表仍可使用。
    </p>
  </div>
</template>
