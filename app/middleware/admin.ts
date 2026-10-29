// 進後台前先拿到登入狀態，頁面一畫出來就知道要不要顯示控制按鈕（SSR 時也會帶 cookie）。
// 沒登入不擋：後台以訪客模式（唯讀）顯示，作品集的審閱者沒有密碼也看得到圖表與警示紀錄；
// 寫入的 API（遠端控制、復電、改閾值／契約容量）在伺服器端另外用 requireAdmin 擋。
// 開發模式沒設定管理密碼時 authenticated 會直接是 true
export default defineNuxtRouteMiddleware(async () => {
  await useAdminSession().refresh()
})
