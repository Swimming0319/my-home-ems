import type * as THREE from 'three'
import { type ChibiLook, createChibiCharacter, DEFAULT_LOOK } from './chibiCharacter'
import { type Collider, findPath, type Point, type Rect, resolveCircle } from './collision'

type ThreeModule = typeof import('three')
type RoundedBoxCtor = typeof import('three/examples/jsm/geometries/RoundedBoxGeometry.js').RoundedBoxGeometry

export const PLAYER_RADIUS = 0.25
export const PLAYER_HEIGHT = 1.6
const WALK_SPEED = 1.8
// 點地板走路時，實際移動量連續 0.4 秒都不到預期的一成，就當作被擋住，放棄這次目標
const STUCK_SECONDS = 0.4
// 坐上去／起身的過場時間
const REST_TRANSITION_SECONDS = 0.45

// 用 KeyboardEvent.code（實體按鍵位置），注音／其他鍵盤配置下 WASD 也能用
const MOVE_KEYS: Record<string, [right: number, forward: number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0]
}

export interface WalkTarget {
  x: number
  z: number
  stopDistance: number
  // 點家電走過去的，抵達時通知外層打開遙控面板
  deviceId: string | null
}

// 操作家電的方式：crouch 蹲下操作（洗衣機）；remote 舉起右手拿遙控器對準家電（冷氣、電視）；
// reach 伸手去按（廚房家電、電燈開關），動作跟 remote 一樣只是手上沒有遙控器
export interface Interaction {
  // 角色要面對的位置（地板上）
  x: number
  z: number
  style: 'crouch' | 'remote' | 'reach'
  // 遙控器要對準的點
  aim: { x: number; y: number; z: number }
}

export type RestPose = 'sit' | 'lie'

// 家具上可以坐、躺的位置（世界座標），由 roomFurniture 依家具的擺放算出來
export interface RestSpot {
  pose: RestPose
  // 角色的原點要放的位置：座面（床墊）上、屁股正下方
  x: number
  y: number
  z: number
  // 身體朝向（同 rotation.y）；躺下時頭朝身體的 -Z
  yaw: number
  // 走過去要停的地板位置，起身時也回到這裡
  approach: { x: number; z: number }
  // 躺下時上半身抬起的角度（見 ChibiState.incline）
  incline: number
  sleep: boolean
}

export interface PlayerController {
  object: THREE.Group
  // 腳底的位置；坐著／躺著時 y 是座面高度，其他時候是 0
  position: THREE.Vector3
  // 坐著或躺著時，會先起身再走過去
  walkTo(target: WalkTarget): void
  // 正在操作家電時傳入：角色轉過去面對它，依 style 蹲下操作或舉起遙控器。傳 null 結束
  setInteraction(interaction: Interaction | null): void
  // 走到家具旁坐下或躺下；已經坐著就先起身
  restAt(spot: RestSpot): void
  standUp(): void
  update(dt: number, elapsed: number, colliders: Collider[]): void
  dispose(): void
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

export function createPlayerController(
  THREE: ThreeModule,
  options: {
    camera: THREE.Camera
    bounds: Rect
    start: { x: number; z: number }
    onArrive: (deviceId: string) => void
    // 坐下／躺下（過場開始時）與起身（過場結束時）時通知外層
    onRestChange?: (pose: RestPose | null) => void
    // RoundedBoxGeometry 在 three 的 addons 裡，跟 three 一樣由呼叫端動態載入後傳進來
    RoundedBoxGeometry: RoundedBoxCtor
    look?: ChibiLook
  }
): PlayerController {
  const object = new THREE.Group()
  object.position.set(options.start.x, 0, options.start.z)

  // body 負責轉向，底下是自製的 Q 版角色（臉朝 +Z）
  const body = new THREE.Group()
  const character = createChibiCharacter(THREE, options.RoundedBoxGeometry, options.look ?? DEFAULT_LOOK)
  body.add(character.root)
  object.add(body)

  // 點地板時，目的地顯示一個小圓圈
  const targetMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.12, 0.17, 24),
    new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.85 })
  )
  targetMarker.rotation.x = -Math.PI / 2
  targetMarker.visible = false

  const pressed = new Set<string>()
  const onKeyDown = (e: KeyboardEvent) => {
    if (!(e.code in MOVE_KEYS) || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return
    // 方向鍵預設會捲動頁面
    e.preventDefault()
    pressed.add(e.code)
  }
  const onKeyUp = (e: KeyboardEvent) => pressed.delete(e.code)
  // 切換視窗時 keyup 不會觸發，不清掉的話角色會一直往同個方向走
  const onBlur = () => pressed.clear()
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  let target: WalkTarget | null = null
  // 繞過家具的轉折點；null 表示還沒算（walkTo 時拿不到碰撞範圍，下一格 update 再算）
  let path: Point[] | null = null
  let interaction: Interaction | null = null
  let stuckFor = 0
  const forward = new THREE.Vector3()
  const aim = new THREE.Vector3()

  // 正在走向家具、抵達後要坐下的位置
  let pendingRest: RestSpot | null = null
  // 坐著／躺著的狀態；enter／exit 是坐上去、起身的過場，from 是過場開始時的位置與朝向
  let rest: {
    spot: RestSpot
    phase: 'enter' | 'resting' | 'exit'
    t: number
    from: { x: number; y: number; z: number; yaw: number }
  } | null = null
  // 起身完成後要接著做的事（例如點了別的地方要走過去）
  let afterStand: (() => void) | null = null

  function startWalk(next: WalkTarget, showMarker: boolean) {
    target = next
    path = null
    stuckFor = 0
    targetMarker.position.set(next.x, 0.02, next.z)
    targetMarker.visible = showMarker
    if (!targetMarker.parent && object.parent) object.parent.add(targetMarker)
  }

  function walkTo(next: WalkTarget) {
    if (rest) {
      standUp(() => walkTo(next))
      return
    }
    pendingRest = null
    startWalk(next, next.deviceId === null)
  }

  function clearTarget() {
    target = null
    path = null
    pendingRest = null
    targetMarker.visible = false
  }

  function currentPose() {
    return { x: object.position.x, y: object.position.y, z: object.position.z, yaw: body.rotation.y }
  }

  function restAt(spot: RestSpot) {
    if (rest) {
      if (rest.spot !== spot) standUp(() => restAt(spot))
      return
    }
    startWalk({ x: spot.approach.x, z: spot.approach.z, stopDistance: 0.05, deviceId: null }, false)
    pendingRest = spot
  }

  function standUp(then?: () => void) {
    if (!rest) return
    afterStand = then ?? null
    if (rest.phase === 'exit') return
    rest = { ...rest, phase: 'exit', t: 0, from: currentPose() }
  }

  // ---- 睡覺時頭上飄的 Zzz ----
  const zCanvas = document.createElement('canvas')
  zCanvas.width = 64
  zCanvas.height = 64
  const zCtx = zCanvas.getContext('2d')!
  zCtx.font = 'bold 48px sans-serif'
  zCtx.textAlign = 'center'
  zCtx.textBaseline = 'middle'
  zCtx.lineWidth = 6
  zCtx.strokeStyle = '#1b1f27'
  zCtx.strokeText('Z', 32, 34)
  zCtx.fillStyle = '#ffffff'
  zCtx.fillText('Z', 32, 34)
  const zTexture = new THREE.CanvasTexture(zCanvas)
  const zSprites = Array.from({ length: 3 }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: zTexture, transparent: true, depthWrite: false }))
    sprite.visible = false
    object.add(sprite)
    return sprite
  })
  const headPosition = new THREE.Vector3()

  function updateZzz(elapsed: number, sleeping: boolean) {
    if (sleeping) {
      character.head.getWorldPosition(headPosition)
      object.worldToLocal(headPosition)
    }
    zSprites.forEach((sprite, i) => {
      sprite.visible = sleeping
      if (!sleeping) return
      const t = (elapsed * 0.45 + i / zSprites.length) % 1
      sprite.position.set(headPosition.x + 0.12 + t * 0.2, headPosition.y + 0.3 + t * 0.45, headPosition.z)
      sprite.scale.setScalar(0.1 + t * 0.12)
      ;(sprite.material as THREE.SpriteMaterial).opacity = Math.sin(t * Math.PI)
    })
  }

  // 坐著／躺著時的每格更新：只處理坐上去、起身的過場，不移動、不做碰撞
  function updateRest(dt: number, elapsed: number) {
    if (!rest) return
    // 按方向鍵就起身，起身後接著照按鍵走
    if (pressed.size > 0 && rest.phase !== 'exit') standUp()
    const { spot } = rest
    if (rest.phase !== 'resting') {
      rest.t = Math.min(1, rest.t + dt / REST_TRANSITION_SECONDS)
      const k = rest.t * rest.t * (3 - 2 * rest.t)
      const to =
        rest.phase === 'enter'
          ? { x: spot.x, y: spot.y, z: spot.z, yaw: spot.yaw }
          : {
              x: spot.approach.x,
              y: 0,
              z: spot.approach.z,
              // 起身後面向離開家具的方向
              yaw: Math.atan2(spot.approach.x - spot.x, spot.approach.z - spot.z)
            }
      const from = rest.from
      object.position.set(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, from.z + (to.z - from.z) * k)
      const yawDiff = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw))
      body.rotation.y = from.yaw + yawDiff * k
      if (rest.t >= 1) {
        if (rest.phase === 'enter') {
          rest.phase = 'resting'
        } else {
          rest = null
          object.position.y = 0
          options.onRestChange?.(null)
          const next = afterStand
          afterStand = null
          next?.()
        }
      }
    }

    const pose = rest && rest.phase !== 'exit' ? rest.spot.pose : null
    character.update(dt, elapsed, {
      moving: false,
      speed: WALK_SPEED,
      crouch: false,
      aim: null,
      holdRemote: false,
      rest: pose,
      incline: spot.incline,
      sleep: rest?.phase === 'resting' && spot.sleep
    })
    updateZzz(elapsed, rest?.phase === 'resting' && spot.sleep)
  }

  function turnTowards(dirX: number, dirZ: number, dt: number) {
    const targetYaw = Math.atan2(dirX, dirZ)
    // 走最短的那一邊
    let diff = targetYaw - body.rotation.y
    diff = Math.atan2(Math.sin(diff), Math.cos(diff))
    body.rotation.y += diff * Math.min(1, dt * 12)
  }

  function update(dt: number, elapsed: number, colliders: Collider[]) {
    if (rest) {
      updateRest(dt, elapsed)
      return
    }

    let moveX = 0
    let moveZ = 0
    let step = 0

    let inputRight = 0
    let inputForward = 0
    for (const code of pressed) {
      inputRight += MOVE_KEYS[code]![0]
      inputForward += MOVE_KEYS[code]![1]
    }

    if (inputRight !== 0 || inputForward !== 0) {
      // 鍵盤移動以鏡頭為準：W 永遠是「往畫面裡面走」
      clearTarget()
      options.camera.getWorldDirection(forward)
      forward.y = 0
      forward.normalize()
      moveX = forward.x * inputForward - forward.z * inputRight
      moveZ = forward.z * inputForward + forward.x * inputRight
      const length = Math.hypot(moveX, moveZ)
      moveX /= length
      moveZ /= length
      step = WALK_SPEED * dt
    } else if (target) {
      // 找不到路（例如點到家具底下的地板）就照舊直線走，撞到後由下面的卡住偵測放棄
      path ??= findPath(object.position, target, target.stopDistance, PLAYER_RADIUS, colliders, options.bounds) ?? []
      while (path[0] && Math.hypot(path[0].x - object.position.x, path[0].z - object.position.z) < 0.05) path.shift()
      const distance = Math.hypot(target.x - object.position.x, target.z - object.position.z)
      if (distance <= target.stopDistance + 0.01) {
        const deviceId = target.deviceId
        const spot = pendingRest
        clearTarget()
        if (deviceId) options.onArrive(deviceId)
        if (spot) {
          rest = { spot, phase: 'enter', t: 0, from: currentPose() }
          options.onRestChange?.(spot.pose)
        }
      } else {
        const waypoint = path[0] ?? target
        const dx = waypoint.x - object.position.x
        const dz = waypoint.z - object.position.z
        const length = Math.hypot(dx, dz)
        moveX = dx / length
        moveZ = dz / length
        step = Math.min(WALK_SPEED * dt, path[0] ? length : distance - target.stopDistance)
      }
    }

    const moving = step > 0
    if (moving) {
      const before = { x: object.position.x, z: object.position.z }
      const resolved = resolveCircle(before.x + moveX * step, before.z + moveZ * step, PLAYER_RADIUS, colliders, options.bounds)
      object.position.x = resolved.x
      object.position.z = resolved.z

      if (target) {
        const moved = Math.hypot(resolved.x - before.x, resolved.z - before.z)
        stuckFor = moved < step * 0.1 ? stuckFor + dt : 0
        if (stuckFor > STUCK_SECONDS) clearTarget()
      }
      turnTowards(moveX, moveZ, dt)
    } else if (interaction) {
      turnTowards(interaction.x - object.position.x, interaction.z - object.position.z, dt)
    }

    const pointAt =
      interaction && interaction.style !== 'crouch' ? aim.set(interaction.aim.x, interaction.aim.y, interaction.aim.z) : null
    character.update(dt, elapsed, {
      moving,
      speed: WALK_SPEED,
      crouch: interaction?.style === 'crouch',
      aim: pointAt,
      holdRemote: interaction?.style === 'remote',
      rest: null,
      incline: 0,
      sleep: false
    })
    targetMarker.scale.setScalar(1 + Math.sin(elapsed * 6) * 0.1)
  }

  return {
    object,
    position: object.position,
    walkTo,
    setInteraction(next) {
      interaction = next
    },
    restAt,
    standUp: () => standUp(),
    update,
    dispose() {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      character.dispose()
      zTexture.dispose()
      zSprites.forEach((sprite) => sprite.material.dispose())
      targetMarker.removeFromParent()
      targetMarker.geometry.dispose()
      ;(targetMarker.material as THREE.Material).dispose()
    }
  }
}
