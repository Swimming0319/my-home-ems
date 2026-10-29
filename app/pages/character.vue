<script setup lang="ts">
// 自製角色的原型預覽：確認造型與動作後，再換到遊戲裡的角色

useHead({ title: '角色預覽 · 用電小屋' })

type PreviewPose = 'idle' | 'walk' | 'remote' | 'crouch' | 'sit' | 'lie' | 'sleep'

const POSES: { id: PreviewPose; label: string }[] = [
  { id: 'idle', label: '待機' },
  { id: 'walk', label: '走路' },
  { id: 'remote', label: '拿遙控器' },
  { id: 'crouch', label: '蹲下' },
  { id: 'sit', label: '坐下' },
  { id: 'lie', label: '躺沙發' },
  { id: 'sleep', label: '睡覺' }
]

// 坐、躺時墊在下面的平台，高度跟沙發座面、床墊差不多（0.3 公尺）
const SEAT_HEIGHT = 0.3

// 網址可以指定動作與視角，例如 /character?pose=remote&angle=-30（angle 是從正面往右轉幾度）
const route = useRoute()
const initialPose = POSES.find((p) => p.id === route.query.pose)?.id ?? 'idle'
const initialAngle = Number(route.query.angle)

const containerEl = ref<HTMLDivElement | null>(null)
const pose = ref<PreviewPose>(initialPose)
const autoRotate = ref<boolean>(!Number.isFinite(initialAngle))
let cleanup: (() => void) | null = null

onMounted(async () => {
  const THREE = await import('three')
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
  const { RoundedBoxGeometry } = await import('three/examples/jsm/geometries/RoundedBoxGeometry.js')
  const container = containerEl.value
  if (!container) return

  // 燈光、陰影設定跟 RoomScene 一樣，預覽看到的就是放進房間的樣子
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#141821')
  scene.add(new THREE.HemisphereLight('#cfd8ea', '#2a2f3a', 0.9))
  const sun = new THREE.DirectionalLight('#ffffff', 1.4)
  sun.position.set(4, 8, 5)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  scene.add(sun)

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1.4, 48),
    new THREE.MeshStandardMaterial({ color: '#8a6f55', roughness: 0.85 })
  )
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)

  // 拿遙控器時對準的「冷氣」，放在右前方高處
  const ac = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.22, 0.15),
    new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.4 })
  )
  ac.position.set(-0.9, 2.2, 1.2)
  ac.rotation.y = Math.PI * 0.75
  scene.add(ac)

  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(1, SEAT_HEIGHT, 1),
    new THREE.MeshStandardMaterial({ color: '#5b8bd0', roughness: 0.8 })
  )
  seat.castShadow = true
  seat.receiveShadow = true
  scene.add(seat)

  const character = createChibiCharacter(THREE, RoundedBoxGeometry)
  scene.add(character.root)

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50)
  const azimuth = THREE.MathUtils.degToRad(Number.isFinite(initialAngle) ? initialAngle : 30)
  camera.position.set(Math.sin(azimuth) * 3.2, 1.5, Math.cos(azimuth) * 3.2)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 0.85, 0)
  controls.enableDamping = true
  controls.minDistance = 1.2
  controls.maxDistance = 6
  controls.update()

  const resize = () => {
    const w = container.clientWidth || 1
    const h = container.clientHeight || 1
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  resize()

  const timer = new THREE.Timer()
  const aimTarget = new THREE.Vector3()
  let frame = 0
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick)
    timer.update(now)
    const dt = Math.min(timer.getDelta(), 0.1)
    // 預覽的「走路」是原地踏步
    const rest = pose.value === 'sit' ? 'sit' : pose.value === 'lie' || pose.value === 'sleep' ? 'lie' : null
    character.update(dt, timer.getElapsed(), {
      moving: pose.value === 'walk',
      speed: 1.8,
      crouch: pose.value === 'crouch',
      aim: pose.value === 'remote' ? ac.getWorldPosition(aimTarget) : null,
      holdRemote: true,
      rest,
      incline: pose.value === 'sleep' ? 0.15 : 0.5,
      sleep: pose.value === 'sleep'
    })
    // 坐下時平台在屁股下方往前延伸；躺下時往頭的方向（-Z）延伸
    seat.visible = rest !== null
    character.root.position.y = rest ? SEAT_HEIGHT : 0
    if (rest === 'sit') {
      seat.scale.set(0.7, 1, 0.5)
      seat.position.set(0, SEAT_HEIGHT / 2, 0.05)
    } else if (rest === 'lie') {
      seat.scale.set(0.8, 1, 1.8)
      seat.position.set(0, SEAT_HEIGHT / 2, -0.4)
    }
    controls.autoRotate = autoRotate.value
    controls.update()
    renderer.render(scene, camera)
  }
  frame = requestAnimationFrame(tick)

  cleanup = () => {
    cancelAnimationFrame(frame)
    observer.disconnect()
    controls.dispose()
    character.dispose()
    timer.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  }
})

onBeforeUnmount(() => cleanup?.())
</script>

<template>
  <div class="relative h-dvh w-full overflow-hidden bg-scene">
    <div ref="containerEl" class="absolute inset-0" />

    <header class="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 p-4">
      <div class="rounded-xl bg-bg/80 px-4 py-3 backdrop-blur">
        <h1 class="text-lg font-bold">角色預覽（原型）</h1>
        <p class="mt-0.5 text-sm text-muted">拖曳轉動角度、滾輪縮放；確認造型後再換到遊戲裡</p>
      </div>
      <NuxtLink
        to="/"
        class="pointer-events-auto rounded-full border border-line bg-bg/80 px-4 py-2 text-sm backdrop-blur hover:border-highlight"
      >
        回前台 →
      </NuxtLink>
    </header>

    <div class="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-2 p-4">
      <button
        v-for="item in POSES"
        :key="item.id"
        type="button"
        class="cursor-pointer rounded-full border bg-bg/80 px-4 py-2 text-sm backdrop-blur"
        :class="pose === item.id ? 'border-highlight text-highlight' : 'border-line hover:border-highlight'"
        :aria-pressed="pose === item.id"
        @click="pose = item.id"
      >
        {{ item.label }}
      </button>
      <label class="flex cursor-pointer items-center gap-2 rounded-full border border-line bg-bg/80 px-4 py-2 text-sm backdrop-blur">
        <input v-model="autoRotate" type="checkbox" class="accent-highlight" >
        自動旋轉
      </label>
    </div>
  </div>
</template>
