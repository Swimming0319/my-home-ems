import { describe, expect, it } from 'vitest'
import { dayCycle } from './dayCycle'

describe('dayCycle', () => {
  it('中午是白天、半夜是晚上', () => {
    expect(dayCycle(12)).toMatchObject({ daylight: 1, label: '白天' })
    expect(dayCycle(2)).toMatchObject({ daylight: 0, label: '晚上' })
  })

  it('日出、日落有過渡，過渡中間晨昏最明顯', () => {
    const dusk = dayCycle(17.875)
    expect(dusk.label).toBe('傍晚')
    expect(dusk.twilight).toBeCloseTo(1)
    expect(dayCycle(6).label).toBe('清晨')
  })
})
