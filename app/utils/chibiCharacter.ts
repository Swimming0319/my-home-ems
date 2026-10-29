import type * as THREE from 'three'

type ThreeModule = typeof import('three')
type RoundedBoxCtor = typeof import('three/examples/jsm/geometries/RoundedBoxGeometry.js').RoundedBoxGeometry

// 自製的 Q 版角色：全部用平滑的球體、膠囊體、圓角方塊組成（不用外部模型），
// 骨架是一層層的 Group（肩 → 肘 → 手、髖 → 膝 → 腳），動作也用程式產生。
// 好處是造型圓潤、動作與遙控器位置都能直接控制，外觀顏色也只是參數，之後可以讓玩家自己挑。
// 座標：腳底在 y = 0、臉朝 +Z，總高約 1.63（含毛帽），跟 playerController 的 PLAYER_HEIGHT 對齊。

export interface ChibiLook {
  skin: string
  hair: string
  hat: string
  hatRim: string
  top: string
  topAccent: string
  bottom: string
  bottomCuff: string
  shoes: string
  shoeSole: string
  glasses: string
}

// 棕色包包頭、紅色毛帽、白色帽 T、牛仔褲、圓框眼鏡
export const DEFAULT_LOOK: ChibiLook = {
  skin: '#f7d5c0',
  hair: '#6b4430',
  hat: '#d93b3b',
  hatRim: '#b92e2e',
  top: '#f5f4f0',
  topAccent: '#e2e0da',
  bottom: '#4d72b5',
  bottomCuff: '#7f9fd6',
  shoes: '#fafafa',
  shoeSole: '#c9c9c9',
  glasses: '#2b2b2b'
}

export interface ChibiState {
  moving: boolean
  // 實際移動速度（公尺／秒），決定走路的步伐頻率
  speed: number
  crouch: boolean
  // 右手伸直要對準的世界座標；null 代表放下手
  aim: THREE.Vector3 | null
  // 對準時手上拿著遙控器（冷氣、電視）；伸手按按鈕時不拿
  holdRemote: boolean
  // 坐下／躺下。root 的原點要放在座面（床墊）上、屁股正下方的位置；
  // 躺下時頭朝角色自己的 -Z、臉朝上
  rest: 'sit' | 'lie' | null
  // 躺下時上半身抬起的角度（弧度）：床上有枕頭抬一點，沙發靠在扶手上抬比較多
  incline: number
  // 閉上眼睛睡覺
  sleep: boolean
}

export interface ChibiCharacter {
  root: THREE.Group
  // 頭部，外層要在頭上方顯示東西（睡覺的 Zzz）時用
  head: THREE.Object3D
  update(dt: number, elapsed: number, state: ChibiState): void
  dispose(): void
}

// 骨架尺寸（公尺）
const HIP_Y = 0.52
const CROUCH_HIP_Y = 0.3
// 坐下、躺下時髖部離座面的高度：骨盆的半徑，再陷進坐墊一點
const SIT_HIP_Y = 0.11
const LIE_HIP_Y = 0.13
const THIGH = 0.2
const SHIN = 0.2
const UPPER_ARM = 0.17
const FOREARM = 0.15
const HEAD_R = 0.3
// 步伐頻率：每秒移動 1 公尺時，腿擺動的弧度／秒
const STRIDE_RATE = 4.2
const POSE_BLEND_SPEED = 8

export function createChibiCharacter(
  THREE: ThreeModule,
  RoundedBoxGeometry: RoundedBoxCtor,
  look: ChibiLook = DEFAULT_LOOK
): ChibiCharacter {
  const materials = new Map<string, THREE.MeshStandardMaterial>()
  function mat(color: string, roughness = 0.75, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    const key = `${color}|${roughness}|${JSON.stringify(extra)}`
    let m = materials.get(key)
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra })
      materials.set(key, m)
    }
    return m
  }

  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D) {
    const m = new THREE.Mesh(geometry, material)
    m.castShadow = true
    m.receiveShadow = true
    parent.add(m)
    return m
  }

  const sphere = (r: number) => new THREE.SphereGeometry(r, 32, 24)
  const capsule = (r: number, length: number) => new THREE.CapsuleGeometry(r, length, 8, 20)

  // 在兩點之間放一根細棍（眼鏡的鏡腳、帽 T 的抽繩）
  function stick(from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material, parent: THREE.Object3D) {
    const length = from.distanceTo(to)
    const m = mesh(new THREE.CylinderGeometry(radius, radius, length, 10), material, parent)
    m.position.copy(from).lerp(to, 0.5)
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
    return m
  }

  const root = new THREE.Group()
  const hips = new THREE.Group()
  hips.position.y = HIP_Y
  root.add(hips)

  // ---- 下半身：牛仔褲 ----
  const pelvis = mesh(sphere(0.17), mat(look.bottom), hips)
  pelvis.scale.set(1.1, 0.75, 0.9)

  function buildLeg(side: 1 | -1) {
    const hip = new THREE.Group()
    hip.position.set(0.09 * side, -0.02, 0)
    hips.add(hip)
    const thigh = mesh(capsule(0.078, THIGH), mat(look.bottom), hip)
    thigh.position.y = -THIGH / 2
    const knee = new THREE.Group()
    knee.position.y = -THIGH
    hip.add(knee)
    const shin = mesh(capsule(0.072, SHIN - 0.04), mat(look.bottom), knee)
    shin.position.y = -SHIN / 2
    // 反摺的褲管
    const cuff = mesh(new THREE.TorusGeometry(0.07, 0.022, 10, 24), mat(look.bottomCuff), knee)
    cuff.rotation.x = Math.PI / 2
    cuff.position.y = -SHIN + 0.03
    // 圓潤的白色球鞋，鞋頭往前
    const shoe = mesh(new RoundedBoxGeometry(0.13, 0.1, 0.22, 4, 0.045), mat(look.shoes, 0.6), knee)
    shoe.position.set(0, -SHIN - 0.04, 0.035)
    const sole = mesh(new RoundedBoxGeometry(0.135, 0.03, 0.225, 3, 0.012), mat(look.shoeSole, 0.8), knee)
    sole.position.set(0, -SHIN - 0.088, 0.035)
    return { hip, knee }
  }
  const legL = buildLeg(1)
  const legR = buildLeg(-1)

  // ---- 上半身：白色帽 T ----
  const spine = new THREE.Group()
  hips.add(spine)
  const torso = mesh(capsule(0.19, 0.16), mat(look.top), spine)
  torso.position.y = 0.2
  torso.scale.set(1.05, 1, 0.85)
  // 帽 T 的口袋、抽繩、背後的帽子
  const pocket = mesh(new RoundedBoxGeometry(0.22, 0.08, 0.04, 3, 0.018), mat(look.topAccent), spine)
  pocket.position.set(0, 0.11, 0.155)
  for (const side of [1, -1]) {
    stick(new THREE.Vector3(0.045 * side, 0.36, 0.13), new THREE.Vector3(0.05 * side, 0.25, 0.165), 0.007, mat(look.topAccent), spine)
  }
  const hood = mesh(sphere(0.15), mat(look.top), spine)
  hood.position.set(0, 0.38, -0.12)
  hood.scale.set(1.25, 0.6, 0.7)

  function buildArm(side: 1 | -1) {
    const shoulder = new THREE.Group()
    shoulder.position.set(0.22 * side, 0.36, 0)
    spine.add(shoulder)
    const upper = mesh(capsule(0.062, UPPER_ARM - 0.05), mat(look.top), shoulder)
    upper.position.y = -UPPER_ARM / 2
    const elbow = new THREE.Group()
    elbow.position.y = -UPPER_ARM
    shoulder.add(elbow)
    const fore = mesh(capsule(0.056, FOREARM - 0.05), mat(look.top), elbow)
    fore.position.y = -FOREARM / 2
    const cuff = mesh(new THREE.TorusGeometry(0.05, 0.016, 10, 24), mat(look.topAccent), elbow)
    cuff.rotation.x = Math.PI / 2
    cuff.position.y = -FOREARM + 0.01
    // 手是一顆圓球（Q 版角色常見的「連指手套」手），握東西時讓東西直接穿過拳頭
    const hand = new THREE.Group()
    hand.position.y = -FOREARM
    elbow.add(hand)
    mesh(sphere(0.06), mat(look.skin, 0.6), hand).position.y = -0.045
    return { shoulder, elbow, hand }
  }
  const armL = buildArm(1)
  const armR = buildArm(-1)

  // 遙控器：穿過右手的拳頭，前端從手的下方凸出；手臂對準家電時，前端剛好指向家電
  const remote = new THREE.Group()
  mesh(new RoundedBoxGeometry(0.045, 0.13, 0.024, 3, 0.008), mat('#23262d', 0.45), remote)
  const led = mesh(new THREE.SphereGeometry(0.008, 10, 10), new THREE.MeshBasicMaterial({ color: '#ff5a5a' }), remote)
  led.position.set(0, -0.06, 0.012)
  remote.position.y = -0.09
  remote.visible = false
  armR.hand.add(remote)

  // ---- 頭 ----
  const neck = new THREE.Group()
  neck.position.y = 0.44
  spine.add(neck)
  const head = new THREE.Group()
  head.position.y = 0.27
  neck.add(head)
  mesh(sphere(HEAD_R), mat(look.skin, 0.6), head).scale.set(1.04, 0.98, 1)
  for (const side of [1, -1]) {
    const ear = mesh(sphere(0.05), mat(look.skin, 0.6), head)
    ear.position.set(0.295 * side, -0.03, 0)
    ear.scale.set(0.5, 1, 0.8)
  }

  // 臉：豆豆眼（加一點反光）、腮紅、小鼻子、微笑
  const eyes: THREE.Object3D[] = []
  for (const side of [1, -1]) {
    const eye = new THREE.Group()
    eye.position.set(0.105 * side, -0.01, 0.272)
    head.add(eye)
    const pupil = mesh(sphere(0.038), mat('#2a1d1a', 0.25), eye)
    pupil.scale.set(0.85, 1.15, 0.5)
    const shine = mesh(new THREE.SphereGeometry(0.011, 10, 10), new THREE.MeshBasicMaterial({ color: '#ffffff' }), eye)
    shine.position.set(0.012, 0.016, 0.017)
    eyes.push(eye)

    const blush = mesh(sphere(0.045), mat('#ff8f8f', 0.9, { transparent: true, opacity: 0.45 }), head)
    blush.position.set(0.165 * side, -0.085, 0.24)
    blush.scale.set(1.3, 0.6, 0.3)
    blush.castShadow = false
  }
  mesh(new THREE.SphereGeometry(0.018, 12, 12), mat(look.skin, 0.6), head).position.set(0, -0.05, 0.296)
  const mouth = mesh(new THREE.TorusGeometry(0.03, 0.007, 8, 20, Math.PI), mat('#b5524a', 0.5), head)
  mouth.position.set(0, -0.1, 0.282)
  mouth.rotation.z = Math.PI

  // 圓框眼鏡
  const frame = mat(look.glasses, 0.3)
  for (const side of [1, -1]) {
    const ring = mesh(new THREE.TorusGeometry(0.068, 0.009, 10, 36), frame, head)
    ring.position.set(0.105 * side, -0.01, 0.312)
    stick(new THREE.Vector3(0.173 * side, 0, 0.3), new THREE.Vector3(0.29 * side, 0.01, 0.02), 0.007, frame, head)
  }
  const bridge = mesh(new THREE.TorusGeometry(0.02, 0.007, 8, 16, Math.PI), frame, head)
  bridge.position.set(0, 0.0, 0.318)

  // 頭髮：後腦與兩側一片（正面留一個臉的開口），額頭一片瀏海，後腦勺下方一顆包包頭
  const hairMat = mat(look.hair, 0.8)
  const faceOpening = 1.8
  const back = mesh(
    new THREE.SphereGeometry(0.318, 40, 24, Math.PI / 2 + faceOpening / 2, Math.PI * 2 - faceOpening, 0, Math.PI * 0.72),
    hairMat,
    head
  )
  back.scale.set(1.04, 0.98, 1)
  const bangs = mesh(
    new THREE.SphereGeometry(0.322, 40, 12, Math.PI / 2 - faceOpening / 2 - 0.05, faceOpening + 0.1, Math.PI * 0.3, Math.PI * 0.17),
    hairMat,
    head
  )
  bangs.scale.set(1.04, 0.98, 1)
  const bun = mesh(sphere(0.105), hairMat, head)
  bun.position.set(0, 0.0, -0.31)

  // 紅色毛帽：上半顆球蓋住頭頂，下緣一圈較深的反摺
  const hatTheta = Math.PI * 0.42
  const hat = mesh(new THREE.SphereGeometry(0.335, 40, 16, 0, Math.PI * 2, 0, hatTheta), mat(look.hat, 0.9), head)
  hat.scale.set(1.04, 1.12, 1.02)
  const rim = mesh(new THREE.TorusGeometry(0.335 * Math.sin(hatTheta) * 1.03, 0.038, 12, 48), mat(look.hatRim, 0.9), head)
  rim.rotation.x = Math.PI / 2
  rim.position.y = 0.335 * Math.cos(hatTheta) * 1.12

  // ---- 動作 ----
  let walkWeight = 0
  let crouchWeight = 0
  let sitWeight = 0
  let lieWeight = 0
  let incline = 0
  let aimWeight = 0
  let walkPhase = 0
  let nextBlink = 2
  let blinkTime = 0
  const aimTarget = new THREE.Vector3()
  const tmp = {
    dir: new THREE.Vector3(),
    shoulderWorld: new THREE.Vector3(),
    animQuat: new THREE.Quaternion(),
    aimQuat: new THREE.Quaternion(),
    parentQuat: new THREE.Quaternion(),
    down: new THREE.Vector3(0, -1, 0)
  }

  // 各動作依權重混合：idle 的權重是 1 減掉其他動作的權重
  const mix = (idle: number, walk: number, crouch: number, sit: number, lie: number) =>
    idle * (1 - walkWeight - crouchWeight - sitWeight - lieWeight) +
    walk * walkWeight +
    crouch * crouchWeight +
    sit * sitWeight +
    lie * lieWeight

  function update(dt: number, elapsed: number, state: ChibiState) {
    const blend = Math.min(1, dt * POSE_BLEND_SPEED)
    const resting = state.rest !== null
    walkWeight += ((state.moving && !resting ? 1 : 0) - walkWeight) * blend
    crouchWeight += ((state.crouch && !state.moving && !resting ? 1 : 0) - crouchWeight) * blend
    sitWeight += ((state.rest === 'sit' ? 1 : 0) - sitWeight) * blend
    lieWeight += ((state.rest === 'lie' ? 1 : 0) - lieWeight) * blend
    if (state.rest === 'lie') incline += (state.incline - incline) * blend
    // 權重加起來不超過 1，剩下的是待機
    const total = walkWeight + crouchWeight + sitWeight + lieWeight
    if (total > 1) {
      walkWeight /= total
      crouchWeight /= total
      sitWeight /= total
      lieWeight /= total
    }
    if (state.moving) walkPhase += dt * Math.max(state.speed, 0.6) * STRIDE_RATE

    const breathe = Math.sin(elapsed * 2.2)
    const swing = Math.sin(walkPhase)
    const bounce = Math.abs(Math.cos(walkPhase))

    // 躺下：整個身體以髖部為軸往後倒 90 度，頭朝 -Z、臉朝上；上半身再依 incline 抬起來
    const slowBreathe = Math.sin(elapsed * 1.3)
    hips.position.y = mix(HIP_Y + breathe * 0.004, HIP_Y - 0.012 + bounce * 0.035, CROUCH_HIP_Y, SIT_HIP_Y, LIE_HIP_Y)
    hips.rotation.x = mix(0, 0, 0, 0, -Math.PI / 2)
    spine.rotation.x = mix(0.02, 0.08, 0.38, -0.1, incline)
    torso.scale.y = 1 + mix(breathe * 0.012, breathe * 0.012, breathe * 0.012, breathe * 0.012, slowBreathe * 0.02)
    head.rotation.x = mix(0, -0.04, 0.12, 0.05, 0.15)
    head.rotation.z = mix(Math.sin(elapsed * 0.7) * 0.04, 0, 0, Math.sin(elapsed * 0.7) * 0.03, 0)

    // 腿：往前擺是繞 X 軸負方向；膝蓋往後彎是正方向。
    // 坐下時大腿往前平放、小腿垂下；躺下時左腳屈膝立起、右腳伸直
    legL.hip.rotation.x = mix(0, -swing * 0.55, -1.55, -1.5, -0.7)
    legR.hip.rotation.x = mix(0, swing * 0.55, -1.55, -1.5, -0.05)
    legL.knee.rotation.x = mix(0, Math.max(0, swing) * 0.7, 2.25, 1.4, 1.3)
    legR.knee.rotation.x = mix(0, Math.max(0, -swing) * 0.7, 2.25, 1.4, 0.1)
    legL.hip.rotation.z = mix(0, 0, 0.18, 0.06, 0.05)
    legR.hip.rotation.z = mix(0, 0, -0.18, -0.06, -0.08)

    // 手臂：跟對側的腿一起往前擺。坐下時手放在大腿上；躺下時雙手交疊放在肚子上
    // 躺下時把上臂往內轉（繞 Y），手肘彎曲的方向才會朝身體中線，前臂平放在肚子上
    armL.shoulder.rotation.set(
      mix(0, swing * 0.6, -0.95, -0.55, -0.2),
      mix(0, 0, 0, 0, -1.4),
      mix(0.13 + breathe * 0.015, 0.1, 0.15, 0.12, 0.3)
    )
    armR.shoulder.rotation.set(
      mix(0, -swing * 0.6, -0.95, -0.55, -0.2),
      mix(0, 0, 0, 0, 1.4),
      mix(-0.13 - breathe * 0.015, -0.1, -0.15, -0.12, -0.3)
    )
    armL.elbow.rotation.x = mix(-0.15, -0.5, -0.5, -0.75, -1.7)
    armR.elbow.rotation.x = mix(-0.15, -0.5, -0.5, -0.75, -1.7)

    // 眨眼：每 2～5 秒一次，眼睛壓扁 0.12 秒
    nextBlink -= dt
    if (nextBlink <= 0) {
      blinkTime = 0.12
      nextBlink = 2 + Math.random() * 3
    }
    blinkTime = Math.max(0, blinkTime - dt)
    for (const eye of eyes) eye.scale.y = blinkTime > 0 || (state.sleep && lieWeight > 0.6) ? 0.15 : 1

    // 拿遙控器：右手整隻伸直指向家電，跟上面的動作混合
    if (state.aim) aimTarget.copy(state.aim)
    aimWeight += ((state.aim && !state.moving && !resting ? 1 : 0) - aimWeight) * blend
    remote.visible = aimWeight > 0.5 && state.holdRemote
    if (aimWeight > 0.001) {
      root.updateMatrixWorld(true)
      armR.shoulder.getWorldPosition(tmp.shoulderWorld)
      tmp.dir.subVectors(aimTarget, tmp.shoulderWorld).normalize()
      // 把世界方向換到肩膀父層（spine）的座標裡，算出「手臂往下的方向」要轉到哪裡
      spine.getWorldQuaternion(tmp.parentQuat).invert()
      tmp.dir.applyQuaternion(tmp.parentQuat)
      tmp.aimQuat.setFromUnitVectors(tmp.down, tmp.dir)
      tmp.animQuat.copy(armR.shoulder.quaternion)
      armR.shoulder.quaternion.copy(tmp.animQuat.slerp(tmp.aimQuat, aimWeight))
      armR.elbow.rotation.x *= 1 - aimWeight
    }
  }

  function dispose() {
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose()
    })
    materials.forEach((m) => m.dispose())
    led.material.dispose()
    eyes.forEach((eye) =>
      eye.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshBasicMaterial) obj.material.dispose()
      })
    )
  }

  return { root, head, update, dispose }
}
