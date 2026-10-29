// 角色碰撞：只在地板平面（XZ）上做「圓形角色 vs 方塊障礙物」，不引入物理引擎（規劃文件決策紀錄）。
// 純函式，跟 three.js 無關，方便測試。

export interface Rect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  // 斜放的家具：min／max 是家具自己的座標（以 x、z 為原點、繞 Y 轉 yaw，跟 three.js 的 rotation.y 同方向），
  // 方塊跟著家具轉，才不會因為外框對齊座標軸而比家具大一圈。沒有就是對齊座標軸的方塊
  frame?: { x: number; z: number; yaw: number }
}

export interface Collider extends Rect {
  deviceId: string | null
  // 擋路的家具／家電；掛在牆上、比角色高的（冷氣）不擋路，但仍然可以互動
  solid: boolean
}

// 世界座標 ↔ 方塊自己的座標
function toLocal(x: number, z: number, rect: Rect): { x: number; z: number } {
  if (!rect.frame) return { x, z }
  const { frame } = rect
  const dx = x - frame.x
  const dz = z - frame.z
  const cos = Math.cos(frame.yaw)
  const sin = Math.sin(frame.yaw)
  return { x: dx * cos - dz * sin, z: dx * sin + dz * cos }
}

function toWorld(x: number, z: number, rect: Rect): { x: number; z: number } {
  if (!rect.frame) return { x, z }
  const { frame } = rect
  const cos = Math.cos(frame.yaw)
  const sin = Math.sin(frame.yaw)
  return { x: frame.x + x * cos + z * sin, z: frame.z - x * sin + z * cos }
}

export function distanceToRect(x: number, z: number, rect: Rect): number {
  const p = toLocal(x, z, rect)
  const dx = Math.max(rect.minX - p.x, 0, p.x - rect.maxX)
  const dz = Math.max(rect.minZ - p.z, 0, p.z - rect.maxZ)
  return Math.hypot(dx, dz)
}

export function closestPointOnRect(x: number, z: number, rect: Rect): { x: number; z: number } {
  const p = toLocal(x, z, rect)
  return toWorld(Math.min(Math.max(p.x, rect.minX), rect.maxX), Math.min(Math.max(p.z, rect.minZ), rect.maxZ), rect)
}

// 把角色推出所有擋路的方塊，再限制在房間範圍內。跑兩輪，處理卡在兩個方塊夾角的情況
export function resolveCircle(
  x: number,
  z: number,
  radius: number,
  colliders: Collider[],
  bounds: Rect
): { x: number; z: number } {
  let px = x
  let pz = z
  for (let pass = 0; pass < 2; pass++) {
    for (const rect of colliders) {
      if (!rect.solid) continue
      const closest = closestPointOnRect(px, pz, rect)
      const dx = px - closest.x
      const dz = pz - closest.z
      const distance = Math.hypot(dx, dz)
      if (distance >= radius) continue
      if (distance > 1e-6) {
        px = closest.x + (dx / distance) * radius
        pz = closest.z + (dz / distance) * radius
      } else {
        // 圓心已經在方塊裡面（例如瞬移進去）：往穿透最淺的那一邊推出去（在方塊自己的座標裡算）
        const local = toLocal(px, pz, rect)
        const pushes = [
          { x: rect.minX - radius, z: local.z, depth: local.x - rect.minX },
          { x: rect.maxX + radius, z: local.z, depth: rect.maxX - local.x },
          { x: local.x, z: rect.minZ - radius, depth: local.z - rect.minZ },
          { x: local.x, z: rect.maxZ + radius, depth: rect.maxZ - local.z }
        ].sort((a, b) => a.depth - b.depth)
        const pushed = toWorld(pushes[0]!.x, pushes[0]!.z, rect)
        px = pushed.x
        pz = pushed.z
      }
    }
    px = Math.min(Math.max(px, bounds.minX + radius), bounds.maxX - radius)
    pz = Math.min(Math.max(pz, bounds.minZ + radius), bounds.maxZ - radius)
  }
  return { x: px, z: pz }
}

// 角色範圍內最近的家電；沒有就回傳 null
export function nearestInteractable(x: number, z: number, colliders: Collider[], range: number): string | null {
  let best: { id: string; distance: number } | null = null
  for (const collider of colliders) {
    if (!collider.deviceId) continue
    const distance = distanceToRect(x, z, collider)
    if (distance <= range && (!best || distance < best.distance)) best = { id: collider.deviceId, distance }
  }
  return best?.id ?? null
}

export interface Point {
  x: number
  z: number
}

// 路徑格子的大小（公尺）；房間 6 × 6 只有 3600 格，每次點擊重算一次也很快
const PATH_CELL = 0.1
// 規劃路徑時多留一點空隙，不要擦著家具邊緣走
const PATH_MARGIN = 0.03

function isClear(x: number, z: number, radius: number, colliders: Collider[], bounds: Rect): boolean {
  if (x < bounds.minX + radius || x > bounds.maxX - radius || z < bounds.minZ + radius || z > bounds.maxZ - radius) {
    return false
  }
  return colliders.every((c) => !c.solid || distanceToRect(x, z, c) >= radius + PATH_MARGIN)
}

function segmentClear(a: Point, b: Point, radius: number, colliders: Collider[], bounds: Rect): boolean {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (PATH_CELL / 2))
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    if (!isClear(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, radius, colliders, bounds)) return false
  }
  return true
}

// 繞過擋路的家具走到目標附近（距離 target 在 stopDistance 以內就算到）。
// 網格 A* 找到路之後把能直線走的轉折點拿掉，回傳不含起點的轉折點；走不到回傳 null
export function findPath(
  from: Point,
  target: Point,
  stopDistance: number,
  radius: number,
  colliders: Collider[],
  bounds: Rect
): Point[] | null {
  const cols = Math.round((bounds.maxX - bounds.minX) / PATH_CELL)
  const rows = Math.round((bounds.maxZ - bounds.minZ) / PATH_CELL)
  const center = (index: number): Point => ({
    x: bounds.minX + ((index % cols) + 0.5) * PATH_CELL,
    z: bounds.minZ + (Math.floor(index / cols) + 0.5) * PATH_CELL
  })
  const cellOf = (p: Point) => {
    const col = Math.min(cols - 1, Math.max(0, Math.floor((p.x - bounds.minX) / PATH_CELL)))
    const row = Math.min(rows - 1, Math.max(0, Math.floor((p.z - bounds.minZ) / PATH_CELL)))
    return row * cols + col
  }
  const clear = new Map<number, boolean>()
  const passable = (index: number) => {
    let value = clear.get(index)
    if (value === undefined) {
      const p = center(index)
      value = isClear(p.x, p.z, radius, colliders, bounds)
      clear.set(index, value)
    }
    return value
  }
  const remaining = (p: Point) => Math.max(0, Math.hypot(target.x - p.x, target.z - p.z) - stopDistance)

  const start = cellOf(from)
  const cost = new Map<number, number>([[start, 0]])
  const cameFrom = new Map<number, number>()
  const open = new Set<number>([start])
  const closed = new Set<number>()
  let goal: number | null = null

  while (open.size > 0) {
    let current = -1
    let best = Infinity
    for (const index of open) {
      const score = cost.get(index)! + remaining(center(index))
      if (score < best) {
        best = score
        current = index
      }
    }
    open.delete(current)
    if (remaining(center(current)) <= PATH_CELL / 2) {
      goal = current
      break
    }
    closed.add(current)

    const col = current % cols
    const row = Math.floor(current / cols)
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx === 0 && dz === 0) || col + dx < 0 || col + dx >= cols || row + dz < 0 || row + dz >= rows) continue
        const next = (row + dz) * cols + col + dx
        if (closed.has(next) || !passable(next)) continue
        // 斜走不能切過擋路格子的角
        if (dx !== 0 && dz !== 0 && (!passable(row * cols + col + dx) || !passable((row + dz) * cols + col))) continue
        const nextCost = cost.get(current)! + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1) * PATH_CELL
        if (nextCost < (cost.get(next) ?? Infinity)) {
          cost.set(next, nextCost)
          cameFrom.set(next, current)
          open.add(next)
        }
      }
    }
  }
  if (goal === null) return null

  const cells: Point[] = []
  for (let index: number | undefined = goal; index !== undefined && index !== start; index = cameFrom.get(index)) {
    cells.unshift(center(index))
  }
  // 從目前位置往後看，能直線走到的最遠點當下一個轉折點
  const path: Point[] = []
  let anchor = from
  let i = 0
  while (i < cells.length) {
    let far = i
    for (let j = cells.length - 1; j > i; j--) {
      if (segmentClear(anchor, cells[j]!, radius, colliders, bounds)) {
        far = j
        break
      }
    }
    path.push(cells[far]!)
    anchor = cells[far]!
    i = far + 1
  }
  return path
}
