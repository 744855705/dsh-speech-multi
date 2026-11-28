import { describe, expect, it } from 'vitest'
import { checkTranscript, contentLength, sanitize, trimShortTrailingMarks } from '../src/health.ts'

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

describe('trimShortTrailingMarks', () => {
  it('drops the mark from a fragment', () => {
    expect(trimShortTrailingMarks('编译变异。')).toBe('编译变异')
    expect(trimShortTrailingMarks('好的，')).toBe('好的')
    expect(trimShortTrailingMarks('开始？')).toBe('开始')
  })

  it('leaves a fragment with no mark alone', () => {
    expect(trimShortTrailingMarks('编译变异')).toBe('编译变异')
  })

  it('keeps the mark once the sentence is long enough', () => {
    expect(trimShortTrailingMarks('帮我排查一个线上问题。')).toBe('帮我排查一个线上问题。')
  })

  it('counts only the spoken characters', () => {
    expect(contentLength('编译变异。')).toBe(4)
    expect(contentLength('a b，c')).toBe(3)
    expect(trimShortTrailingMarks('一，二，三，四，五。')).toBe('一，二，三，四，五')
  })
})

describe('Qwen3 schema markers', () => {
  it('drops the language prefix a cold block start emits', () => {
    expect(sanitize('language Chinese<asr_text>工期明显变长。')).toBe('工期明显变长。')
    expect(sanitize('前一句。language English <asr_text>后一句')).toBe('前一句。 后一句')
  })

  it('drops the marker when it appears alone', () => {
    expect(sanitize('<asr_text>发现有几条 SQL')).toBe('发现有几条 SQL')
  })

  it('leaves a genuine mention of the word intact', () => {
    expect(sanitize('我们讨论 language 这个单词')).toBe('我们讨论 language 这个单词')
  })
})

describe('short utterance marks', () => {
  it('drops the ending mark of a short fragment in any script', () => {
    // The set is Unicode punctuation, not a hand-written list, so a model that answers "Done!"
    // behaves the same as one that answers "好的。".
    expect(trimShortTrailingMarks('好的。')).toBe('好的')
    expect(trimShortTrailingMarks('OK.')).toBe('OK')
    expect(trimShortTrailingMarks('Done!')).toBe('Done')
    expect(trimShortTrailingMarks('Hello?')).toBe('Hello')
    expect(trimShortTrailingMarks('你好……')).toBe('你好')
    expect(trimShortTrailingMarks('没问题？')).toBe('没问题')
  })

  it('leaves a fragment alone when it ends in a word', () => {
    expect(trimShortTrailingMarks('测试')).toBe('测试')
    expect(trimShortTrailingMarks('行')).toBe('行')
  })

  it('leaves anything longer than five characters untouched', () => {
    expect(trimShortTrailingMarks('我这边在排查一个线上的问题。')).toBe('我这边在排查一个线上的问题。')
  })
})
