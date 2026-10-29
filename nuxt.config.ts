// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@pinia/nuxt'],
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()]
  },
  runtimeConfig: {
    // 只在伺服器端使用，能繞過 RLS
    supabaseServiceKey: '',
    // 後台管理密碼；開發模式沒設定時不需要登入，正式環境沒設定則沒有人能登入，後台只剩訪客模式
    adminPassword: '',
    public: {
      // 前後端共用同一個 Project URL；瀏覽器只拿 publishable key 訂閱 Realtime
      supabaseUrl: '',
      supabaseKey: ''
    }
  },
  app: {
    head: {
      title: '用電小屋',
      htmlAttrs: { lang: 'zh-Hant' },
      meta: [{ name: 'description', content: '全站共用的 3D 小屋：前台操控角色使用家電，後台即時監控用電、接近上限時警示。' }],
      link: [
        // 小屋＋閃電：SVG 給新瀏覽器，PNG 給不支援 SVG icon 的瀏覽器；iOS 加入主畫面用直角滿版的 180px（系統會自己裁圓角）
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap' }
      ]
    }
  },
  devServer: {
    // 3000 常被其他專案（B2B API）佔用，而且對方只聽 IPv4、Nuxt 聽 IPv6，
    // 兩邊都能啟動、瀏覽器卻會連到別人那邊，很難發現
    port: 3010
  }
})
