export default defineEventHandler(async (event) => {
  await logout(event)
  return { ok: true }
})
