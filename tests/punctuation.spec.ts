import { describe, expect, it } from 'vitest'
import { applyMarks, punctuateOrKeep } from '../src/punctuation/fireredpunc.ts'

describe('applyMarks', () => {
  it('inserts a mark right after the character it follows', () => {
    expect(applyMarks('帮我排查一个线上bug这个服务出问题了', [{ at: 11, mark: '，' }]))
      .toBe('帮我排查一个线上bug，这个服务出问题了')
  })

  it('keeps English casing and the spaces around it', () => {
    const text = '旧的产物被重复打包进 DOCKER 镜像最后补一个 BENCHMARK'
    expect(applyMarks(text, [{ at: 17, mark: '，' }]))
      .toBe('旧的产物被重复打包进 DOCKER， 镜像最后补一个 BENCHMARK')
  })

  it('places several marks in one pass', () => {
    expect(applyMarks('第一句第二句第三句', [{ at: 3, mark: '，' }, { at: 6, mark: '。' }]))
      .toBe('第一句，第二句。第三句')
  })

  it('ignores marks that are out of range or out of order', () => {
    expect(applyMarks('短句', [{ at: 9, mark: '。' }, { at: 0, mark: '，' }])).toBe('短句')
  })

  it('never stacks a mark on one the decoder already produced', () => {
    expect(applyMarks('第一句。第二句', [{ at: 4, mark: '。' }])).toBe('第一句。第二句')
    expect(applyMarks('第一句，第二句', [{ at: 4, mark: '，' }])).toBe('第一句，第二句')
  })

  it('still inserts where the previous character is ordinary text', () => {
    expect(applyMarks('第一句第二句', [{ at: 3, mark: '。' }])).toBe('第一句。第二句')
  })

  it('returns the text unchanged when nothing is marked', () => {
    expect(applyMarks('没有标点', [])).toBe('没有标点')
  })
})

describe('punctuateOrKeep', () => {
  it('returns the transcript unchanged when punctuation is turned off', async () => {
    await expect(punctuateOrKeep(undefined, '没有标点的文本')).resolves.toBe('没有标点的文本')
  })

  it('returns the transcript unchanged when the punctuation model cannot load', async () => {
    await expect(punctuateOrKeep('/nonexistent/punctuation', '加载失败也要保留文本'))
      .resolves.toBe('加载失败也要保留文本')
  })
})
