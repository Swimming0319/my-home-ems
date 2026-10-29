// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

// 分享預覽卡片（Open Graph）的圖片與網址：社群平台抓預覽時只認完整網址，換網域時要一起改
const SITE_URL = 'https://my-home-ems.vercel.app'
const SITE_DESCRIPTION = '一間全站共用的 3D 小套房：操控 Q 版角色開關家電，用電量、警示、跳電會即時同步到監控後台。'

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
    // 可以用 Google 登入後台的信箱（逗號分隔）；要搭配 Supabase Auth 開啟 Google provider
    adminEmails: '',
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
      meta: [
        { name: 'description', content: SITE_DESCRIPTION },
        // 貼到 LINE、Facebook、LinkedIn、Slack 時的預覽卡片；圖片 public/og-image.jpg（1200×630）
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: '用電小屋' },
        { property: 'og:title', content: '用電小屋 · 3D 房間用電監控' },
        { property: 'og:description', content: SITE_DESCRIPTION },
        { property: 'og:url', content: SITE_URL },
        { property: 'og:locale', content: 'zh_TW' },
        { property: 'og:image', content: `${SITE_URL}/og-image.jpg` },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:image:alt', content: '用電小屋：3D 小套房裡的 Q 版角色、開著的冷氣與電視，旁邊標示即時耗電量' },
        // X（Twitter）用大圖卡片，沒有 twitter:image 時會沿用 og:image
        { name: 'twitter:card', content: 'summary_large_image' }
      ],
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
