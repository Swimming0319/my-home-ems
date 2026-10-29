import type * as THREE from 'three'

type ThreeModule = typeof import('three')

// 電視節目：用 canvas 即時畫一段卡通風景（天空、雲、山丘、跳跳的小雞），
// 下方跑馬燈顯示房間的即時用電。不用影片檔，沒有授權問題，也不用額外下載
const WIDTH = 512
const HEIGHT = 288
// 每秒重畫 30 次就夠順，不用跟著 60fps 的動畫迴圈
const FRAME_INTERVAL = 1 / 30
// 天色變化一輪的秒數：白天 → 黃昏 → 白天
const DAY_SECONDS = 60
const TICKER_HEIGHT = 30
const TICKER_SPEED = 60

export interface TvProgram {
  texture: THREE.CanvasTexture
  // 螢幕照到房間裡的光的顏色，跟著天色變
  glow: THREE.Color
  // ticker 只在真的要重畫時才呼叫，避免每格都組字串
  draw(elapsed: number, ticker: () => string): void
}

function mixColor(a: string, b: string, t: number): string {
  const pa = Number.parseInt(a.slice(1), 16)
  const pb = Number.parseInt(b.slice(1), 16)
  const channel = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t)
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}

export function createTvProgram(THREE: ThreeModule): TvProgram {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')!
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const glow = new THREE.Color('#8ab4ff')
  let lastDraw = -Infinity

  const farHill = (x: number, t: number) => 196 + 16 * Math.sin((x + t * 15) / 70)
  const nearHill = (x: number, t: number) => 226 + 12 * Math.sin((x + t * 40) / 48 + 1)

  function hills(y: (x: number) => number, color: string) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(0, HEIGHT)
    for (let x = 0; x <= WIDTH; x += 8) ctx.lineTo(x, y(x))
    ctx.lineTo(WIDTH, HEIGHT)
    ctx.fill()
  }

  function cloud(x: number, y: number, size: number) {
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.arc(x + size * 0.9, y - size * 0.4, size * 0.8, 0, Math.PI * 2)
    ctx.arc(x + size * 1.7, y, size * 0.7, 0, Math.PI * 2)
    ctx.fill()
  }

  function chick(t: number) {
    const x = WIDTH * 0.38
    const hop = Math.abs(Math.sin(t * 3))
    const ground = nearHill(x, t)
    // 落地時壓扁一點，跳起來拉長
    const squash = hop < 0.15 ? 1 - (0.15 - hop) * 1.5 : 1 + hop * 0.06
    const y = ground - 15 * squash - hop * 30
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(1 / squash, squash)
    ctx.fillStyle = '#ffd84d'
    ctx.beginPath()
    ctx.arc(0, 0, 16, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#f2b833'
    ctx.beginPath()
    ctx.ellipse(-9, 3, 7, 4, -0.5 + Math.sin(t * 18) * 0.5 * hop, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#2b2b2b'
    ctx.beginPath()
    ctx.arc(6, -5, 2.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ff9a3c'
    ctx.beginPath()
    ctx.moveTo(14, -2)
    ctx.lineTo(22, 1)
    ctx.lineTo(14, 4)
    ctx.fill()
    ctx.restore()
    // 影子
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'
    ctx.beginPath()
    ctx.ellipse(x, ground + 2, 14 - hop * 5, 3, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  function overlay(t: number, ticker: string) {
    ctx.font = 'bold 15px "Noto Sans TC", sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.beginPath()
    ctx.roundRect(12, 12, 74, 26, 8)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.fillText('小屋台', 22, 26)

    ctx.font = 'bold 13px "Noto Sans TC", sans-serif'
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.beginPath()
    ctx.roundRect(WIDTH - 72, 12, 60, 26, 8)
    ctx.fill()
    ctx.fillStyle = Math.sin(t * 4) > -0.3 ? '#ff5d5d' : 'rgba(255, 93, 93, 0.3)'
    ctx.beginPath()
    ctx.arc(WIDTH - 60, 25, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.fillText('LIVE', WIDTH - 50, 26)

    const top = HEIGHT - TICKER_HEIGHT
    ctx.fillStyle = 'rgba(15, 18, 25, 0.88)'
    ctx.fillRect(0, top, WIDTH, TICKER_HEIGHT)
    ctx.font = '15px "Noto Sans TC", sans-serif'
    const textWidth = ctx.measureText(ticker).width
    const labelWidth = 92
    const x = WIDTH - ((t * TICKER_SPEED) % (textWidth + WIDTH - labelWidth))
    ctx.fillStyle = '#ffffff'
    ctx.fillText(ticker, x, top + TICKER_HEIGHT / 2 + 1)
    // 左邊的標籤蓋在捲動文字上面
    ctx.fillStyle = '#ff9f43'
    ctx.fillRect(0, top, labelWidth, TICKER_HEIGHT)
    ctx.font = 'bold 15px "Noto Sans TC", sans-serif'
    ctx.fillStyle = '#1b1f27'
    ctx.fillText('即時用電', 14, top + TICKER_HEIGHT / 2 + 1)
  }

  return {
    texture,
    glow,
    draw(t, ticker) {
      if (t - lastDraw < FRAME_INTERVAL) return
      lastDraw = t
      const dusk = (1 - Math.cos((t / DAY_SECONDS) * Math.PI * 2)) / 2

      const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT)
      sky.addColorStop(0, mixColor('#5fb8f2', '#e9796b', dusk))
      sky.addColorStop(1, mixColor('#c4ebff', '#ffd39a', dusk))
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, WIDTH, HEIGHT)

      ctx.fillStyle = mixColor('#fff3a8', '#ffb35c', dusk)
      ctx.beginPath()
      ctx.arc(WIDTH * 0.78, 70 + dusk * 90, 26, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
      for (let i = 0; i < 3; i++) {
        const span = WIDTH + 160
        cloud(((t * (10 + i * 6) + i * 210) % span) - 80, 52 + i * 30, 15 + (i % 2) * 4)
      }

      hills((x) => farHill(x, t), mixColor('#86cc7b', '#7d8f62', dusk))
      hills((x) => nearHill(x, t), mixColor('#4fae5a', '#4d7a48', dusk))
      chick(t)
      overlay(t, ticker())

      texture.needsUpdate = true
      glow.set(mixColor('#9fd6ff', '#ffb38a', dusk))
    }
  }
}
