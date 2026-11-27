import { describe, expect, it } from 'vitest'
import { assertWithinHardCap, planBlocks, quietestCut, type Span } from '../src/chunking.ts'
import type { ChunkingPolicy } from '../src/catalog.ts'

const RATE = 16000
const POLICY: ChunkingPolicy = { blockSeconds: 30, minBlockSeconds: 8, hardCapSeconds: 38 }

/** Build a segment from seconds. */
function span(start: number, end: number): Span {
  return { start: Math.round(start * RATE), end: Math.round(end * RATE) }
}

describe('planBlocks', () => {
  it('never cuts a recording that fits the target window', () => {
    const blocks = planBlocks({ totalSamples: 12 * RATE, sampleRate: RATE, segments: [span(0, 12)], policy: POLICY })
    expect(blocks).toEqual([{ start: 0, end: 12 * RATE }])
  })

  it('packs consecutive segments until the next one would overflow', () => {
    const segments = [span(0, 10), span(10.5, 20), span(20.5, 44)]
    const blocks = planBlocks({ totalSamples: 44 * RATE, sampleRate: RATE, segments, policy: POLICY })
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({ start: 0, end: 20 * RATE })
    expect(blocks[1]).toEqual({ start: 20.5 * RATE, end: 44 * RATE })
  })

  it('cuts an over-long segment at the injected low-energy point', () => {
    const blocks = planBlocks({
      totalSamples: 50 * RATE,
      sampleRate: RATE,
      segments: [span(0, 50)],
      policy: POLICY,
      findCut: (from, to) => Math.min(to, Math.max(from, 28 * RATE)),
    })
    expect(blocks[0]).toEqual({ start: 0, end: 28 * RATE })
    for (const block of blocks) expect(block.end - block.start).toBeLessThanOrEqual(30 * RATE)
  })

  it('folds a short tail into its predecessor when it still fits', () => {
    const segments = [span(0, 20), span(20.5, 24)]
    const blocks = planBlocks({ totalSamples: 24 * RATE, sampleRate: RATE, segments, policy: POLICY })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({ start: 0, end: 24 * RATE })
  })

  it('returns nothing for empty input', () => {
    expect(planBlocks({ totalSamples: 0, sampleRate: RATE, segments: [], policy: POLICY })).toEqual([])
  })
})

describe('quietestCut', () => {
  it('returns the offset just past the quietest window', () => {
    const samples = new Float32Array(4 * RATE)
    samples.fill(0.5)
    for (let index = RATE; index < RATE + 1600; index += 1) samples[index] = 0
    const cut = quietestCut(samples, 0, 3 * RATE)
    expect(cut).toBeGreaterThanOrEqual(RATE)
    expect(cut).toBeLessThanOrEqual(RATE + 1600)
  })
})

describe('assertWithinHardCap', () => {
  it('accepts windows at the cap', () => {
    expect(() => assertWithinHardCap([{ start: 0, end: 38 * RATE }], RATE, POLICY, 'multi-xasr')).not.toThrow()
  })

  it('rejects a window past the cap', () => {
    expect(() => assertWithinHardCap([{ start: 0, end: 39 * RATE }], RATE, POLICY, 'multi-xasr'))
      .toThrow(/hard cap/u)
  })
})
