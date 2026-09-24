import { describe, expect, it } from 'vitest'
import { AI_MAX_BODY_BYTES, checkAiRequest } from './aiGuard'

const chat = {
  method: 'POST',
  path: '/chat/completions',
  host: 'nettopo.example',
  origin: 'https://nettopo.example',
  secFetchSite: 'same-origin',
  contentType: 'application/json',
}

describe('checkAiRequest', () => {
  it('meneruskan dua panggilan yang dipakai aplikasi', () => {
    expect(checkAiRequest(chat)).toBeNull()
    expect(checkAiRequest({ method: 'GET', path: '/models', host: 'nettopo.example' })).toBeNull()
  })

  it('menolak endpoint dan method lain', () => {
    expect(checkAiRequest({ ...chat, path: '/files' })?.status).toBe(404)
    expect(checkAiRequest({ ...chat, method: 'DELETE', path: '/models' })?.status).toBe(404)
    expect(checkAiRequest({ ...chat, path: '/chat/completions/../../files' })?.status).toBe(404)
    expect(checkAiRequest({ ...chat, path: '/models/', method: 'GET' })?.status).toBe(404)
  })

  it('menolak permintaan dari situs lain', () => {
    expect(checkAiRequest({ ...chat, secFetchSite: 'cross-site' })?.status).toBe(403)
    expect(checkAiRequest({ ...chat, secFetchSite: null, origin: 'https://evil.example' })?.status).toBe(403)
    expect(checkAiRequest({ ...chat, secFetchSite: null, origin: 'null' })?.status).toBe(403)
  })

  it('mewajibkan JSON dan membatasi ukuran', () => {
    expect(checkAiRequest({ ...chat, contentType: 'text/plain' })?.status).toBe(415)
    expect(checkAiRequest({ ...chat, contentLength: String(AI_MAX_BODY_BYTES + 1) })?.status).toBe(413)
  })
})
