/**
 * Energy-based speech detection.
 *
 * The plugin needs speech/silence regions only to place block boundaries; the models do the
 * acoustic work. A percentile-based threshold follows a quiet room and a noisy fan alike without
 * a second model file, and an absolute floor keeps a silent recording from being cut into noise.
 */
import type { Span } from './chunking.ts'

/** Analysis frame, 20 ms at 16 kHz. */
const FRAME_SAMPLES = 320

/** Regions shorter than this are treated as clicks. */
const MIN_SPEECH_SECONDS = 0.2

/** Silence shorter than this does not end a region. */
const MIN_GAP_SECONDS = 0.5

/** Fraction of the loud-to-quiet range treated as the speech threshold. */
const THRESHOLD_RATIO = 0.18

/** Never treat anything below this RMS as speech, whatever the percentiles say. */
const ABSOLUTE_FLOOR = 0.004

/** Detection tuning. */
export interface VadOptions {
  readonly minSpeechSeconds?: number
  readonly minGapSeconds?: number
}

/** Read a percentile from an ascending array. */
function percentile(sorted: Float64Array, fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)))
  return sorted[index] ?? 0
}

/**
 * Split a recording into speech regions.
 * @param samples - mono samples.
 * @param sampleRate - samples per second.
 * @param options - overrides for the defaults above.
 * @returns ascending, non-overlapping speech regions; empty when nothing crosses the floor.
 */
export function detectSpeech(samples: Float32Array, sampleRate: number, options: VadOptions = {}): readonly Span[] {
  const frame = Math.max(1, Math.round(sampleRate * 0.02))
  const frames = Math.floor(samples.length / frame)
  if (frames === 0) return []
  const energy = new Float64Array(frames)
  for (let index = 0; index < frames; index += 1) {
    let total = 0
    const start = index * frame
    for (let cursor = start; cursor < start + frame; cursor += 1) {
      const value = samples[cursor] ?? 0
      total += value * value
    }
    energy[index] = Math.sqrt(total / frame)
  }
  const sorted = Float64Array.from(energy).sort()
  const quiet = percentile(sorted, 0.1)
  const loud = percentile(sorted, 0.9)
  const threshold = Math.max(ABSOLUTE_FLOOR, quiet + (loud - quiet) * THRESHOLD_RATIO)
  const minSpeechFrames = Math.max(1, Math.round((options.minSpeechSeconds ?? MIN_SPEECH_SECONDS) / 0.02))
  const gapFrames = Math.max(1, Math.round((options.minGapSeconds ?? MIN_GAP_SECONDS) / 0.02))
  const regions: Span[] = []
  let start = -1
  let silence = 0
  for (let index = 0; index < frames; index += 1) {
    const voiced = (energy[index] ?? 0) >= threshold
    if (voiced) {
      if (start < 0) start = index
      silence = 0
      continue
    }
    if (start < 0) continue
    silence += 1
    if (silence < gapFrames) continue
    push(regions, start, index - silence + 1, frame, minSpeechFrames)
    start = -1
    silence = 0
  }
  if (start >= 0) push(regions, start, frames, frame, minSpeechFrames)
  return regions
}

/** Append a region when it is long enough, extending it to the end of the final voiced frame. */
function push(regions: Span[], startFrame: number, endFrame: number, frame: number, minFrames: number): void {
  if (endFrame - startFrame < minFrames) return
  regions.push({ start: startFrame * frame, end: endFrame * frame })
}

export { FRAME_SAMPLES }
