import { describe, expect, it } from 'vitest'
import { checkTranscript } from '../src/health.ts'

describe('checkTranscript', () => {
  it('accepts a plausible transcript', () => {
    expect(checkTranscript({ text: '帮我排查一个线上问题，日志里提示有未声明的变量。', audioSeconds: 5 })).toEqual({ ok: true })
  })

  it('rejects an empty result for a judged recording', () => {
    const verdict = checkTranscript({ text: '', audioSeconds: 30 })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.check).toBe('empty')
  })

  it('accepts an empty result for a very short recording', () => {
    expect(checkTranscript({ text: '', audioSeconds: 2 })).toEqual({ ok: true })
  })

  it('rejects a leaked control token', () => {
    const verdict = checkTranscript({ text: '灰度节点<sil>如果确认', audioSeconds: 20 })
    expect(verdict.ok === false && verdict.check).toBe('marker')
  })

  it('rejects a transcript far shorter than the audio', () => {
    const verdict = checkTranscript({ text: '帮我排查', audioSeconds: 30 })
    expect(verdict.ok === false && verdict.check).toBe('empty')
  })

  it('rejects a decoder stuck in a repetition loop', () => {
    const loop = '另外帮我确认一下编译器的缓存是不是没清干净'
    const verdict = checkTranscript({ text: loop.repeat(4), audioSeconds: 12 })
    expect(verdict.ok === false && verdict.check).toBe('repetition')
  })
})
