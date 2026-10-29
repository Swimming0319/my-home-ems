import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// server/utils 底下的純函式會 import shared/ 裡的常數，測試時要對上 Nuxt 的 #shared 別名
export default defineConfig({
  resolve: {
    alias: { '#shared': fileURLToPath(new URL('./shared', import.meta.url)) }
  }
})
