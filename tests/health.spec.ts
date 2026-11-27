import { describe, expect, it } from 'vitest'
import { checkTranscript, sanitize } from '../src/health.ts'

describe('sanitize', () => {
  it('strips a silence marker without gluing the words together', () => {
    expect(sanitize('灰度节点<sil>如果确认')).toBe('灰度节点 如果确认')
  })

  it('leaves nothing behind when the decoder only emitted markers', () => {
    expect(sanitize('<sil><sil><sil>')).toBe('')
  })

  it('strips every control token the families can leak', () => {
    expect(sanitize('A<unk>B<blank>C<pad>D')).toBe('A B C D')
  })

  it('keeps ordinary text untouched', () => {
    expect(sanitize('帮我排查一个线上 bug')).toBe('帮我排查一个线上 bug')
  })
})

describe('checkTranscript', () => {
  it('accepts a plausible transcript', () => {
    expect(checkTranscript({ text: '帮我排查一个线上问题，日志里提示有未声明的变量。', audioSeconds: 5 })).toEqual({ ok: true })
  })

  it('accepts a recording with no detected speech and no text', () => {
    expect(checkTranscript({ text: '<sil>', audioSeconds: 20, speechSeconds: 0 })).toEqual({ ok: true })
  })

  it('accepts an empty result for a very short recording', () => {
    expect(checkTranscript({ text: '', audioSeconds: 2 })).toEqual({ ok: true })
  })

  it('keeps the transcript when a marker sat inside it', () => {
    const verdict = checkTranscript({
      text: '部分流量被路由到了灰度节点<sil>如果确认是配置问题就按之前的回滚流程处理',
      audioSeconds: 20,
      speechSeconds: 18,
    })
    expect(verdict).toEqual({ ok: true })
  })

  it('rejects an empty result when the detector heard speech', () => {
    const verdict = checkTranscript({ text: '', audioSeconds: 30, speechSeconds: 28 })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.check).toBe('empty')
  })

  it('rejects a transcript far shorter than the speech it covers', () => {
    const verdict = checkTranscript({ text: '帮我排查', audioSeconds: 30, speechSeconds: 28 })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.check).toBe('density')
  })

  it('rejects a decoder that emitted the word language instead of text', () => {
    const verdict = checkTranscript({ text: 'language', audioSeconds: 40, speechSeconds: 38 })
    expect(verdict.ok === false && verdict.check).toBe('marker')
  })

  it('rejects a decoder stuck in a repetition loop', () => {
    const loop = '另外帮我确认一下编译器的缓存是不是没清干净'
    const verdict = checkTranscript({ text: loop.repeat(4), audioSeconds: 12, speechSeconds: 12 })
    expect(verdict.ok === false && verdict.check).toBe('repetition')
  })
})
