import { describe, expect, it } from 'vitest'
import { detectRegions } from '../src/worker/detect.ts'

const RATE = 16000
const OPTIONS = {
  threshold: 0.5,
  minSilenceSeconds: 0.8,
  minSpeechSeconds: 0.1,
  maxSpeechSeconds: 29.45,
  threads: 1,
}

/** Silence, speech, silence, speech. */
function sample(): Float32Array {
  const samples = new Float32Array(6 * RATE)
  for (let index = 2 * RATE; index < 3 * RATE; index += 1) samples[index] = 0.4 * Math.sin(index / 8)
  for (let index = 4 * RATE; index < 5 * RATE; index += 1) samples[index] = 0.4 * Math.sin(index / 8)
  return samples
}

describe('detectRegions', () => {
  it('falls back to the energy detector when no Silero model is installed', () => {
    const regions = detectRegions(sample(), RATE, undefined, OPTIONS)
    expect(regions.length).toBe(2)
    expect(regions[0]?.start).toBeLessThan(2 * RATE + 1000)
    expect(regions[1]?.start).toBeGreaterThan(3.5 * RATE)
  })

  it('never returns overlapping regions', () => {
    const regions = detectRegions(sample(), RATE, undefined, OPTIONS)
    for (let index = 1; index < regions.length; index += 1) {
      expect((regions[index]?.start ?? 0)).toBeGreaterThanOrEqual(regions[index - 1]?.end ?? 0)
    }
  })
})
