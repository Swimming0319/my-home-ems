import { describe, expect, it } from 'vitest'
import { type Collider, distanceToRect, findPath, nearestInteractable, resolveCircle } from './collision'

const room = { minX: -3, maxX: 3, minZ: -3, maxZ: 3 }
const washer: Collider = { minX: 1.8, maxX: 2.6, minZ: -2.5, maxZ: -1.9, deviceId: 'washer', solid: true }
const ac: Collider = { minX: -0.7, maxX: 0.7, minZ: -3, maxZ: -2.7, deviceId: 'ac', solid: false }

describe('resolveCircle', () => {
  it('沒碰到任何東西時位置不變', () => {
    expect(resolveCircle(0, 0, 0.25, [washer], room)).toEqual({ x: 0, z: 0 })
  })

  it('從側面撞到家電會被推回邊緣外', () => {
    const { x, z } = resolveCircle(1.7, -2.2, 0.25, [washer], room)
    expect(x).toBeCloseTo(1.55)
    expect(z).toBeCloseTo(-2.2)
  })

  it('圓心整個跑進方塊裡，會從穿透最淺的那一邊推出去', () => {
    const { x, z } = resolveCircle(1.85, -2.2, 0.25, [washer], room)
    expect(x).toBeCloseTo(1.55)
    expect(z).toBeCloseTo(-2.2)
  })

  it('不擋路的家電（牆上的冷氣）可以走到正下方', () => {
    expect(resolveCircle(0, -2.6, 0.25, [ac], room)).toEqual({ x: 0, z: -2.6 })
  })

  it('不會走出房間', () => {
    expect(resolveCircle(5, -5, 0.25, [], room)).toEqual({ x: 2.75, z: -2.75 })
  })
})

describe('nearestInteractable', () => {
  it('距離用到方塊邊緣算，不是到中心', () => {
    expect(distanceToRect(1.0, -2.2, washer)).toBeCloseTo(0.8)
    // 離洗衣機中心約 1.3，但離邊緣不到 0.9，算在範圍內
    expect(nearestInteractable(1.0, -1.5, [washer, ac], 1.2)).toBe('washer')
  })

  it('範圍內有多台時取最近的，都太遠就是 null', () => {
    expect(nearestInteractable(0.9, -2.3, [washer, ac], 1.2)).toBe('ac')
    expect(nearestInteractable(-2, 2, [washer, ac], 1.2)).toBeNull()
  })
})

describe('findPath', () => {
  // 一張橫擋在中間的沙發，左右兩端各留通道
  const couch: Collider = { minX: -1, maxX: 1, minZ: -0.2, maxZ: 0.2, deviceId: null, solid: true }
  const rug: Collider = { minX: -2, maxX: 2, minZ: -2, maxZ: 2, deviceId: null, solid: false }

  function touchesObstacle(from: { x: number; z: number }, path: { x: number; z: number }[]) {
    let prev = from
    for (const p of path) {
      for (let t = 0; t <= 1; t += 0.02) {
        const x = prev.x + (p.x - prev.x) * t
        const z = prev.z + (p.z - prev.z) * t
        if (distanceToRect(x, z, couch) < 0.25) return true
      }
      prev = p
    }
    return false
  }

  it('中間沒有障礙物時直接走到目標', () => {
    const path = findPath({ x: 0, z: 1 }, { x: 0, z: 2 }, 0.05, 0.25, [], room)!
    expect(path).toHaveLength(1)
    expect(path[0]!.z).toBeCloseTo(1.95, 1)
  })

  it('繞過擋在中間的家具，路線不會穿過它', () => {
    const from = { x: 0, z: 1 }
    const path = findPath(from, { x: 0, z: -1 }, 0.05, 0.25, [couch], room)!
    expect(path.length).toBeGreaterThan(1)
    expect(touchesObstacle(from, path)).toBe(false)
    const end = path.at(-1)!
    expect(Math.hypot(end.x, end.z + 1)).toBeLessThan(0.15)
  })

  it('不擋路的東西（地毯）不影響路線', () => {
    expect(findPath({ x: 0, z: 1 }, { x: 0, z: -1 }, 0.05, 0.25, [rug], room)).toHaveLength(1)
  })

  it('目標在家電上：走到 stopDistance 以內就停', () => {
    const path = findPath({ x: 0, z: 2 }, { x: 2.2, z: -1.9 }, 0.9, 0.25, [washer], room)!
    const end = path.at(-1)!
    expect(Math.hypot(end.x - 2.2, end.z + 1.9)).toBeLessThanOrEqual(0.9 + 0.05)
  })

  it('目標在家具裡面走不到時回傳 null', () => {
    expect(findPath({ x: 0, z: 1 }, { x: 0, z: 0 }, 0.05, 0.25, [couch], room)).toBeNull()
  })
})

describe('斜放的方塊（frame）', () => {
  // 1 × 0.6 的方塊，中心在 (1, 1)，轉 45 度
  const yaw = Math.PI / 4
  const tilted: Collider = { minX: -0.5, maxX: 0.5, minZ: -0.3, maxZ: 0.3, frame: { x: 1, z: 1, yaw }, deviceId: null, solid: true }

  it('距離沿著方塊自己的方向計算', () => {
    // 方塊的 +Z 方向在世界座標是 (sin yaw, cos yaw)，正面外 0.2 的點距離就是 0.2
    const dir = { x: Math.sin(yaw), z: Math.cos(yaw) }
    expect(distanceToRect(1 + dir.x * 0.5, 1 + dir.z * 0.5, tilted)).toBeCloseTo(0.2)
    // 對齊座標軸的外框會包住這個點，但斜放的方塊其實離它還有一段距離
    expect(distanceToRect(1.55, 1.55, tilted)).toBeGreaterThan(0.2)
  })

  it('撞到斜放的方塊會沿著它的面推出去', () => {
    const dir = { x: Math.sin(yaw), z: Math.cos(yaw) }
    const { x, z } = resolveCircle(1 + dir.x * 0.4, 1 + dir.z * 0.4, 0.25, [tilted], room)
    expect(distanceToRect(x, z, tilted)).toBeCloseTo(0.25)
  })

  it('圓心在方塊裡面時也推得出來', () => {
    const { x, z } = resolveCircle(1.05, 1, 0.25, [tilted], room)
    expect(distanceToRect(x, z, tilted)).toBeCloseTo(0.25)
  })
})
