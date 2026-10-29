import type { CommandResult } from '#shared/types/smartRoom'

// POST /api/devices/:id/commands  { action, set_temp_c?, source }
// 前台玩家與後台遠端控制共用這支 API：後端是唯一的真實來源，前端只送指令，不自己改狀態。
export default defineEventHandler(async (event): Promise<CommandResult> => {
  if (!allowRequest('command', getRequestIP(event, { xForwardedFor: true }) ?? 'unknown', Date.now())) {
    throw createError({ statusCode: 429, statusMessage: '操作太頻繁，請稍後再試' })
  }

  const id = getRouterParam(event, 'id') ?? ''
  const repo = useRepo()
  const device = await repo.getDevice(id)
  if (!device) {
    throw createError({ statusCode: 404, statusMessage: `找不到電器：${id}` })
  }

  const now = Date.now()
  try {
    const command = parseCommand(await readBody(event))
    // 遠端控制是後台功能；玩家操作家電不需要登入
    if (command.source === 'admin') await requireAdmin(event)
    // 先把到現在為止該發生的跳電結算掉，指令才會套用在正確的狀態上
    await advanceBreaker(repo, now)
    if ((await repo.getSettings()).tripped_at) {
      throw createError({ statusCode: 409, statusMessage: '停電中，請先到電箱把總開關扳回去' })
    }
    const current = await repo.latestEvent(device.id, new Date(now))
    const next = applyCommand(device, current, command, now)
    if (next) await repo.insertEvent(next)
    return { changed: next !== null, event: next ?? current, reading: readingFromEvent(device, next ?? current, now) }
  } catch (error) {
    if (error instanceof CommandError) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    throw error
  }
})
