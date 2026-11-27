import { describe, expect, it } from 'vitest'
import { MODELS } from '../src/catalog.ts'
import { strategyFor } from '../src/models/index.ts'

describe('family strategies', () => {
  it('every family names a token table', () => {
    for (const model of MODELS) {
      const spec = strategyFor(model.family).engine({ root: '/models/root' }, { threads: 1, audioSeconds: 30 })
      expect(spec.tokens, `${model.family} must resolve a token table`).toMatch(/\/models\/root\//u)
    }
  })

  it('builds the shared recognizer options each family needs', () => {
    for (const model of MODELS) {
      const spec = strategyFor(model.family).engine({ root: '/models/root' }, { threads: 3, audioSeconds: 30 })
      expect(spec.modelConfig.numThreads, `${model.family} threads`).toBe(3)
      expect(spec.modelConfig.provider, `${model.family} provider`).toBe('cpu')
    }
  })

  it('drives X-ASR with greedy search and sizes the Qwen3 budget from the window', () => {
    expect(strategyFor('xasr').engine({ root: '/x' }, { threads: 1, audioSeconds: 38 }).options).toEqual({ decodingMethod: 'greedy_search' })
    const short = strategyFor('qwen3').engine({ root: '/q' }, { threads: 1, audioSeconds: 10 })
    const long = strategyFor('qwen3').engine({ root: '/q' }, { threads: 1, audioSeconds: 100 })
    const budget = (spec: { modelConfig: Record<string, unknown> }): number =>
      ((spec.modelConfig.qwen3Asr as { maxTotalLen: number }).maxTotalLen)
    expect(budget(long)).toBeGreaterThan(budget(short))
  })
})
