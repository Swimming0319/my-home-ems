const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const

export const DEFAULT_RANGE = '24h'
export const MAX_RANGE_MS = 7 * UNIT_MS.d

// '24h' / '90m' / '7d' → 毫秒；格式不對或超過上限回傳 null，交給呼叫端回 400。
export function parseRange(input: string | undefined): number | null {
  const match = /^(\d+)([mhd])$/.exec(input ?? DEFAULT_RANGE)
  if (!match) return null
  const ms = Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS]
  if (ms <= 0 || ms > MAX_RANGE_MS) return null
  return ms
}
