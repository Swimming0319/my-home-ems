import type * as THREE from 'three'
import type { WashPhase } from '#shared/types/smartRoom'

type ThreeModule = typeof import('three')

// 洗衣機的窗口：滾筒、衣服、水、泡泡、玻璃門。
// 各層之間刻意前後錯開幾公釐，貼在同一個平面上會 z-fighting（畫面出現閃爍條紋）
const DRUM_RADIUS = 0.235
const WATER_RADIUS = 0.225
const WATER_STRIPS = 48
// 有水的階段水面停在窗口下方三分之一左右；脫水時排乾
const WATER_LEVEL = -0.09
const EMPTY_LEVEL = -WATER_RADIUS - 0.03
// 轉速超過這個值，衣服會被甩到筒壁上一起轉，不再翻滾
const STICK_SPEED = 6

const CLOTH_COLORS = ['#e05a5a', '#f2c14e', '#7fb7e6', '#f4f1ea']

// 每個階段的水面波動、泡沫厚度、滾筒正反轉的速度
const PHASE_STYLE: Record<WashPhase, { wave: number; foam: number; tumble: number; bubbles: boolean }> = {
  fill: { wave: 0.008, foam: 0.01, tumble: 2.2, bubbles: false },
  heat: { wave: 0.005, foam: 0.008, tumble: 1.4, bubbles: true },
  wash: { wave: 0.012, foam: 0.04, tumble: 2.8, bubbles: true },
  rinse: { wave: 0.01, foam: 0.012, tumble: 2.6, bubbles: false },
  spin: { wave: 0, foam: 0, tumble: 0, bubbles: false }
}

export interface WasherWindow {
  group: THREE.Group
  // 回傳機身該震動的幅度（脫水時最大）
  update(phase: WashPhase | null, watts: number, dt: number, elapsed: number): number
}

interface Cloth {
  mesh: THREE.Mesh
  angle: number
  radius: number
  falling: boolean
  // 被筒壁的擋板帶到多高才掉下來（從最低點量起的弧度），每件不一樣，看起來才不會同步
  liftLimit: number
  restOffset: number
  // 脫水時在筒壁上的位置（相對滾筒的角度），四件平均散開
  spinSlot: number
}

export function createWasherWindow(THREE: ThreeModule): WasherWindow {
  const group = new THREE.Group()

  // ---- 滾筒（會轉）----
  const drum = new THREE.Group()
  drum.position.z = 0.003
  group.add(drum)
  drum.add(
    new THREE.Mesh(
      new THREE.CircleGeometry(DRUM_RADIUS, 40),
      new THREE.MeshStandardMaterial({ color: '#3b4553', metalness: 0.5, roughness: 0.45 })
    )
  )
  // 筒壁上的排水孔：一圈小圓點，轉起來看得出方向與速度
  const holeMaterial = new THREE.MeshBasicMaterial({ color: '#232a33' })
  const holeGeometry = new THREE.CircleGeometry(0.009, 8)
  for (let ring = 0; ring < 2; ring++) {
    const count = ring === 0 ? 18 : 10
    const radius = ring === 0 ? 0.19 : 0.11
    for (let i = 0; i < count; i++) {
      const hole = new THREE.Mesh(holeGeometry, holeMaterial)
      const a = (i / count) * Math.PI * 2 + ring * 0.2
      hole.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0.001)
      drum.add(hole)
    }
  }
  const lifterMaterial = new THREE.MeshStandardMaterial({ color: '#8793a3', metalness: 0.4, roughness: 0.4 })
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    const lifter = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.008), lifterMaterial)
    lifter.position.set(Math.cos(a) * 0.205, Math.sin(a) * 0.205, 0.004)
    lifter.rotation.z = a + Math.PI / 2
    drum.add(lifter)
  }

  // ---- 衣服 ----
  const clothes: Cloth[] = CLOTH_COLORS.map((color, i) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 16, 12),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 })
    )
    mesh.scale.set(1.3, 0.75, 0.22)
    // 每件前後錯開，疊在一起時才不會互相穿插出切面
    mesh.position.z = 0.01 + i * 0.003
    group.add(mesh)
    const restOffset = (i - 1.5) * 0.32
    return {
      mesh,
      angle: -Math.PI / 2 + restOffset,
      radius: 0.15,
      falling: false,
      liftLimit: 1.5 + i * 0.22,
      restOffset,
      spinSlot: (i / CLOTH_COLORS.length) * Math.PI * 2
    }
  })

  // ---- 水與泡沫：每格依水位、傾斜、波浪重算一排垂直細條，再用圓切出窗口形狀 ----
  function stripGeometry() {
    const geometry = new THREE.BufferGeometry()
    const vertexCount = (WATER_STRIPS + 1) * 2
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3))
    const normals = new Float32Array(vertexCount * 3)
    for (let i = 0; i < vertexCount; i++) normals[i * 3 + 2] = 1
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    const index: number[] = []
    for (let i = 0; i < WATER_STRIPS; i++) {
      const a = i * 2
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
    geometry.setIndex(index)
    return geometry
  }
  const waterGeometry = stripGeometry()
  const water = new THREE.Mesh(
    waterGeometry,
    new THREE.MeshStandardMaterial({
      color: '#5fb2e8',
      emissive: '#123f63',
      transparent: true,
      opacity: 0.55,
      roughness: 0.15,
      depthWrite: false
    })
  )
  water.position.z = 0.024
  water.renderOrder = 1
  group.add(water)

  const foamGeometry = stripGeometry()
  const foam = new THREE.Mesh(
    foamGeometry,
    new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, roughness: 0.9, depthWrite: false })
  )
  foam.position.z = 0.026
  foam.renderOrder = 2
  group.add(foam)

  const bubbleMaterial = new THREE.MeshBasicMaterial({ color: '#e8f6ff', transparent: true, opacity: 0.7, depthWrite: false })
  const bubbles = Array.from({ length: 7 }, (_, i) => {
    const bubble = new THREE.Mesh(new THREE.CircleGeometry(0.007 + (i % 3) * 0.003, 10), bubbleMaterial)
    bubble.position.set(((i * 0.37) % 1) * 0.3 - 0.15, 0, 0.025)
    bubble.renderOrder = 2
    group.add(bubble)
    return bubble
  })

  // ---- 玻璃門：微微凸出的球面，靠反光看出是玻璃 ----
  const capRadius = 0.45
  const capAngle = Math.asin(DRUM_RADIUS / capRadius)
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(capRadius, 32, 8, 0, Math.PI * 2, 0, capAngle),
    new THREE.MeshPhysicalMaterial({
      color: '#dcefff',
      transparent: true,
      opacity: 0.2,
      roughness: 0.05,
      clearcoat: 1,
      depthWrite: false
    })
  )
  glass.rotation.x = Math.PI / 2
  glass.position.z = 0.03 - capRadius * Math.cos(capAngle)
  glass.renderOrder = 3
  group.add(glass)

  const door = new THREE.Mesh(
    new THREE.TorusGeometry(0.255, 0.035, 12, 40),
    new THREE.MeshStandardMaterial({ color: '#9aa4b1', metalness: 0.6, roughness: 0.3 })
  )
  door.position.z = 0.03
  door.castShadow = true
  group.add(door)

  let speed = 0
  let level = EMPTY_LEVEL
  let tilt = 0
  let wave = 0
  let foamThickness = 0

  function surfaceAt(x: number, elapsed: number) {
    return level + tilt * x + wave * (Math.sin(x * 26 - elapsed * 5) + 0.6 * Math.sin(x * 43 + elapsed * 7.3))
  }

  function writeStrips(geometry: THREE.BufferGeometry, elapsed: number, thickness: number | null) {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i <= WATER_STRIPS; i++) {
      const x = -WATER_RADIUS + (2 * WATER_RADIUS * i) / WATER_STRIPS
      const edge = Math.sqrt(Math.max(0, WATER_RADIUS * WATER_RADIUS - x * x))
      const top = Math.min(Math.max(surfaceAt(x, elapsed), -edge), edge)
      const bottom = thickness === null ? -edge : Math.max(-edge, top - thickness)
      position.setXYZ(i * 2, x, bottom, 0)
      position.setXYZ(i * 2 + 1, x, top, 0)
    }
    position.needsUpdate = true
    geometry.computeBoundingSphere()
  }

  return {
    group,
    update(phase, watts, dt, elapsed) {
      const style = phase ? PHASE_STYLE[phase] : null
      const ease = (rate: number) => Math.min(1, dt * rate)

      // 洗滌時正反轉交替（真實洗衣機也是這樣），脫水時依耗電量越轉越快
      const targetSpeed =
        phase === 'spin' ? 8 + ((watts - 400) / 500) * 10 : style ? style.tumble * Math.tanh(3 * Math.sin(elapsed * 0.55)) : 0
      speed += (targetSpeed - speed) * ease(phase === 'spin' ? 0.8 : 1.5)
      drum.rotation.z += speed * dt

      const hasWater = phase !== null && phase !== 'spin'
      level += ((hasWater ? WATER_LEVEL : EMPTY_LEVEL) - level) * ease(0.6)
      // 滾筒轉動時會把水帶向一側，水面跟著傾斜
      tilt += (Math.max(-0.35, Math.min(0.35, speed * 0.045)) - tilt) * ease(2)
      wave += ((style?.wave ?? 0) - wave) * ease(2)
      foamThickness += ((style?.foam ?? 0) - foamThickness) * ease(1)

      const visible = level > -WATER_RADIUS + 0.005
      water.visible = visible
      foam.visible = visible && foamThickness > 0.002
      if (water.visible) writeStrips(waterGeometry, elapsed, null)
      if (foam.visible) writeStrips(foamGeometry, elapsed, foamThickness)

      bubbles.forEach((bubble, i) => {
        bubble.visible = visible && !!style?.bubbles
        if (!bubble.visible) return
        const x = bubble.position.x
        const bottom = -Math.sqrt(WATER_RADIUS * WATER_RADIUS - x * x)
        const t = (elapsed * (0.35 + (i % 4) * 0.08) + i * 0.29) % 1
        bubble.position.y = bottom + (surfaceAt(x, elapsed) - bottom) * t
      })

      // 衣服：慢轉時被擋板帶上去、到一定高度掉回底部；快轉時貼著筒壁一起轉
      const running = phase !== null
      for (const cloth of clothes) {
        cloth.mesh.visible = running
        if (!running) continue
        if (Math.abs(speed) > STICK_SPEED) {
          cloth.falling = false
          const slot = drum.rotation.z + cloth.spinSlot
          cloth.angle += speed * dt + Math.atan2(Math.sin(slot - cloth.angle), Math.cos(slot - cloth.angle)) * ease(1.5)
          cloth.radius += (0.185 - cloth.radius) * ease(4)
        } else if (cloth.falling) {
          const rest = -Math.PI / 2 + cloth.restOffset
          const diff = Math.atan2(Math.sin(rest - cloth.angle), Math.cos(rest - cloth.angle))
          cloth.angle += Math.sign(diff) * Math.min(Math.abs(diff), dt * 7)
          // 掉落途中離開筒壁，往中間落下
          cloth.radius += ((Math.abs(diff) > 0.3 ? 0.07 : 0.15) - cloth.radius) * ease(8)
          if (Math.abs(diff) < 0.05) cloth.falling = false
        } else {
          cloth.angle += speed * dt
          cloth.radius += (0.155 - cloth.radius) * ease(4)
          const lift = Math.atan2(Math.sin(cloth.angle + Math.PI / 2), Math.cos(cloth.angle + Math.PI / 2))
          if (Math.abs(lift) > cloth.liftLimit) cloth.falling = true
        }
        cloth.mesh.position.x = Math.cos(cloth.angle) * cloth.radius
        cloth.mesh.position.y = Math.sin(cloth.angle) * cloth.radius
        cloth.mesh.rotation.z = cloth.angle * 1.3
      }

      return phase === 'spin' ? Math.min(1, Math.abs(speed) / 18) : 0
    }
  }
}
