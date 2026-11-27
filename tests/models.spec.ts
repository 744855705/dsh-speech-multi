import { describe, expect, it } from 'vitest'
import { MODELS } from '../src/catalog.ts'
import { strategyFor } from '../src/models/index.ts'

describe('family strategies', () => {
  it('every family names a token table', () => {
    for (const model of MODELS) {
      const spec = strategyFor(model.family).engine({ root: '/models/root' }, { threads: 1, audioSeconds: 30, hotwords: [] })
      expect(spec.tokens, `${model.family} must resolve a token table`).toMatch(/\/models\/root\//u)
    }
  })

  it('builds the shared recognizer options each family needs', () => {
    for (const model of MODELS) {
      const spec = strategyFor(model.family).engine({ root: '/models/root' }, { threads: 3, audioSeconds: 30, hotwords: [] })
      expect(spec.modelConfig.numThreads, `${model.family} threads`).toBe(3)
      expect(spec.modelConfig.provider, `${model.family} provider`).toBe('cpu')
    }
  })

  it('drives X-ASR with greedy search and sizes the Qwen3 budget from the window', () => {
    expect(strategyFor('xasr').engine({ root: '/x' }, { threads: 1, audioSeconds: 38, hotwords: [] }).options).toEqual({ decodingMethod: 'greedy_search', maxActivePaths: 4 })
    const short = strategyFor('qwen3').engine({ root: '/q' }, { threads: 1, audioSeconds: 10, hotwords: [] })
    const long = strategyFor('qwen3').engine({ root: '/q' }, { threads: 1, audioSeconds: 100, hotwords: [] })
    const budget = (spec: { modelConfig: Record<string, unknown> }): number =>
      ((spec.modelConfig.qwen3Asr as { maxTotalLen: number }).maxTotalLen)
    expect(budget(long)).toBeGreaterThan(budget(short))
  })
})

describe('hotwords', () => {
  it('switches X-ASR to beam search and declares the character modeling unit', () => {
    // `bpe` would need a token/score vocabulary file, which this model ships only as a
    // sentencepiece binary, so the phrases are given as characters instead.
    const spec = strategyFor('xasr').engine({ root: '/x' }, { threads: 1, audioSeconds: 34, hotwords: ['commit'] })
    expect(spec.options).toEqual({ decodingMethod: 'modified_beam_search', maxActivePaths: 4 })
    expect(spec.modelConfig.modelingUnit).toBe('cjkchar')
  })

  it('passes the prompt to Fun-ASR and nothing to a model that cannot bias', () => {
    const funasr = strategyFor('funasr').engine({ root: '/f' }, { threads: 1, audioSeconds: 20, hotwords: ['commit', '索引'] })
    expect((funasr.modelConfig.funasrNano as Record<string, unknown>).hotwords).toBe('commit、索引')
    const qwen = strategyFor('qwen3').engine({ root: '/q' }, { threads: 1, audioSeconds: 30, hotwords: ['commit'] })
    expect(JSON.stringify(qwen.modelConfig)).not.toContain('commit')
  })
})
