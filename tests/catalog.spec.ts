import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL_ID, MODELS, findModel, modelIds, modelsByPriority } from '../src/catalog.ts'
import { loadManifest } from '../src/runtime/assets.ts'

describe('catalog', () => {
  it('ranks the four models in the measured order, best first', () => {
    expect(modelIds()).toEqual(['multi-xasr', 'multi-funasr', 'multi-qwen3', 'multi-firered'])
  })

  it('gives every model a distinct priority', () => {
    const priorities = MODELS.map((model) => model.priority)
    expect(new Set(priorities).size).toBe(priorities.length)
    expect(modelsByPriority().map((model) => model.priority)).toEqual([1, 2, 3, 4])
  })

  it('defaults to the best ranked model', () => {
    const best = modelsByPriority()[0]
    expect(DEFAULT_MODEL_ID).toBe('multi-xasr')
    expect(best?.id).toBe(DEFAULT_MODEL_ID)
  })

  it('keeps the three window numbers in a usable order', () => {
    for (const model of MODELS) {
      expect(model.chunking.minBlockSeconds).toBeLessThan(model.chunking.blockSeconds)
      expect(model.chunking.blockSeconds).toBeLessThanOrEqual(model.chunking.hardCapSeconds)
    }
  })

  it('only marks the model without native punctuation as needing it', () => {
    const external = MODELS.filter((model) => model.punctuation === 'external')
    expect(external.map((model) => model.id)).toEqual(['multi-firered'])
  })

  it('publishes an archive with a digest for every model', () => {
    const manifest = loadManifest()
    for (const model of MODELS) {
      expect(manifest.files[model.archive], `missing archive for ${model.id}`).toBeDefined()
    }
  })

  it('resolves a known id and rejects an unknown one', () => {
    expect(findModel('multi-funasr')?.family).toBe('funasr')
    expect(findModel('multi-ghost')).toBeUndefined()
  })
})
