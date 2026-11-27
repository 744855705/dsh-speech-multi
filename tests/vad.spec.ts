import { describe, expect, it } from 'vitest'
import { applyMeanScale, applyShiftScale, logMel, lfr } from '../src/vad/fbank.ts'
import { parseMvn, spansFromFlags } from '../src/vad/detect.ts'

const RATE = 16000
const OPTIONS = {
  threshold: 0.5,
  minSilenceSeconds: 0.8,
  minSpeechSeconds: 0.1,
  maxSpeechSeconds: 3,
  threads: 1,
}

/** A 440 Hz tone, which must land in a different mel band than silence. */
function tone(seconds: number): Float32Array {
  const samples = new Float32Array(Math.round(seconds * RATE))
  for (let index = 0; index < samples.length; index++) samples[index] = 0.5 * Math.sin((2 * Math.PI * 440 * index) / RATE)
  return samples
}

describe('logMel', () => {
  it('emits one 80-dim frame per 10 ms hop', () => {
    const { frames, data } = logMel(tone(1), RATE)
    // (16000 - 400) / 160 = 97.5, so 98 windows start inside one second of audio.
    expect(frames).toBe(98)
    expect(data.length).toBe(frames * 80)
  })

  it('separates a tone from silence', () => {
    const loud = logMel(tone(0.5), RATE)
    const quiet = logMel(new Float32Array(RATE / 2), RATE)
    const peak = (input: { data: Float32Array }): number => Math.max(...Array.from(input.data))
    expect(peak(loud)).toBeGreaterThan(peak(quiet))
  })

  it('returns nothing for audio shorter than one window', () => {
    expect(logMel(new Float32Array(100), RATE).frames).toBe(0)
  })
})

describe('lfr', () => {
  it('keeps the frame count and stacks five frames', () => {
    const frames = 4
    const data = Float32Array.from({ length: frames * 80 }, (_, index) => index)
    const stacked = lfr(data, frames, 5)
    expect(stacked.length).toBe(frames * 400)
    // The first output repeats the first input frame while the window slides in.
    expect(Array.from(stacked.subarray(0, 80))).toEqual(Array.from(data.subarray(0, 80)))
    expect(Array.from(stacked.subarray(80, 160))).toEqual(Array.from(data.subarray(0, 80)))
  })
})

describe('normalisation', () => {
  it('applies mean and scale per dimension', () => {
    const data = Float32Array.from([1, 2, 3, 4])
    const means = Float32Array.from([1, 1, 1, 1])
    const scales = Float32Array.from([2, 2, 2, 2])
    applyMeanScale(data, means, scales)
    expect(Array.from(data)).toEqual([0, 2, 4, 6])
  })

  it('applies shift and scale, the FunASR form', () => {
    const data = Float32Array.from([1, 2])
    applyShiftScale(data, Float32Array.from([-1, -2]), Float32Array.from([2, 2]))
    expect(Array.from(data)).toEqual([0, 0])
  })
})

describe('parseMvn', () => {
  it('reads both bracketed vectors', () => {
    const text = '<Nnet>\n<AddShift> 2 2\n<LearnRateCoef> 0 [ -1 -2 ]\n<Rescale> 2 2\n<LearnRateCoef> 0 [ 0.5 0.25 ]\n'
    const { shift, scale } = parseMvn(text)
    expect(Array.from(shift)).toEqual([-1, -2])
    expect(Array.from(scale)).toEqual([0.5, 0.25])
  })

  it('rejects a file without the tags', () => {
    expect(() => parseMvn('<Nnet>')).toThrow(/AddShift/u)
  })
})

describe('spansFromFlags', () => {
  it('closes a region only after enough silence', () => {
    // 50 frames of speech, 20 frames of silence (0.2 s), 50 more: one region.
    const flags = Array.from({ length: 120 }, (_, index) => index < 50 || index >= 70)
    expect(spansFromFlags(flags, OPTIONS)).toHaveLength(1)
  })

  it('splits once the silence threshold is crossed', () => {
    const flags = Array.from({ length: 200 }, (_, index) => index < 50 || index >= 150)
    expect(spansFromFlags(flags, OPTIONS)).toHaveLength(2)
  })

  it('drops a region that never reaches the minimum length', () => {
    // Five frames of speech (0.05 s), then enough silence to close it.
    const flags = Array.from({ length: 200 }, (_, index) => index >= 40 && index < 45)
    expect(spansFromFlags(flags, OPTIONS)).toHaveLength(0)
  })

  it('cuts a region at the maximum block length', () => {
    const flags = new Array(1000).fill(true)
    const regions = spansFromFlags(flags, OPTIONS)
    expect(regions.length).toBeGreaterThan(3)
    for (const region of regions) expect(region.end - region.start).toBeLessThanOrEqual(3 * RATE)
  })
})
