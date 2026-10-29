import { describe, expect, it } from 'vitest'
import { isAllowedGoogleUser, parseAdminEmails } from './adminAllowlist'

const google = (email: string, extra: object = {}) => ({
  email,
  email_confirmed_at: '2026-10-29T00:00:00Z',
  app_metadata: { provider: 'google', providers: ['google'] },
  ...extra
})

describe('後台 Google 登入的允許名單', () => {
  it('逗號分隔、去掉空白、不分大小寫', () => {
    expect(parseAdminEmails(' Me@Gmail.com , other@example.com,, ')).toEqual(['me@gmail.com', 'other@example.com'])
    expect(parseAdminEmails(undefined)).toEqual([])
  })

  it('名單裡的 Google 帳號可以登入，信箱大小寫不同也算', () => {
    expect(isAllowedGoogleUser(google('ME@gmail.com'), ['me@gmail.com'])).toBe(true)
  })

  it('不在名單裡的 Google 帳號不行', () => {
    expect(isAllowedGoogleUser(google('stranger@gmail.com'), ['me@gmail.com'])).toBe(false)
  })

  it('信箱沒驗證、或不是用 Google 登入的帳號不行（避免別人用你的信箱註冊）', () => {
    expect(isAllowedGoogleUser(google('me@gmail.com', { email_confirmed_at: null }), ['me@gmail.com'])).toBe(false)
    expect(isAllowedGoogleUser(google('me@gmail.com', { app_metadata: { provider: 'email', providers: ['email'] } }), ['me@gmail.com'])).toBe(false)
  })

  it('名單是空的：誰都不行', () => {
    expect(isAllowedGoogleUser(google('me@gmail.com'), [])).toBe(false)
    expect(isAllowedGoogleUser(null, ['me@gmail.com'])).toBe(false)
  })
})
