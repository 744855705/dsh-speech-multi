/**
 * Decoding windows for one recording.
 *
 * Every model has three numbers: the window that measured best, the shortest worth decoding,
 * and the length past which it fails. Packing speech segments up to the best window keeps the
 * cut points on silence, which is the only place a boundary costs nothing.
 */
import type { ChunkingPolicy } from './catalog.ts'

/** A half-open sample range. */
export interface Span {
  readonly start: number
  readonly end: number
}

/** Inputs for one block plan. */
export interface PlanInput {
  readonly totalSamples: number
  readonly sampleRate: number
  /** Speech regions from the voice-activity detector, ascending and non-overlapping. */
  readonly segments: readonly Span[]
  readonly policy: ChunkingPolicy
  /** Finds a low-energy cut between two sample offsets; defaults to the built-in scan. */
  readonly findCut?: ((from: number, to: number) => number) | undefined
}

/** Analysis window used to look for a quiet cut, 100 ms at 16 kHz. */
export const CUT_WINDOW_SAMPLES = 1600

/**
 * Split a recording into decoding windows.
 *
 * A recording that fits the target window is never cut. Otherwise speech segments are packed in
 * order until the next one would overflow, which puts every boundary on the silence the detector
 * already found; a segment that is itself too long is cut at its quietest 100 ms.
 * @param input - samples, segments, and the model's policy.
 * @returns windows in ascending order, each at most `blockSeconds` long.
 */
export function planBlocks(input: PlanInput): readonly Span[] {
  const cap = Math.floor(input.policy.blockSeconds * input.sampleRate)
  const total = Math.max(0, Math.floor(input.totalSamples))
  if (total === 0) return []
  if (total <= cap) return [{ start: 0, end: total }]
  const pieces: Span[] = []
  for (const segment of input.segments.length > 0 ? input.segments : [{ start: 0, end: total }]) {
    const start = Math.max(0, Math.min(segment.start, total))
    const end = Math.max(start, Math.min(segment.end, total))
    let cursor = start
    while (end - cursor > cap) {
      const floor = cursor + Math.floor(cap * 0.8)
      const proposed = input.findCut === undefined ? floor : input.findCut(floor, cursor + cap)
      const boundary = Math.min(cursor + cap, Math.max(cursor + 1, proposed))
      pieces.push({ start: cursor, end: boundary })
      cursor = boundary
    }
    if (end > cursor) pieces.push({ start: cursor, end })
  }
  return mergeTail(pack(pieces, cap), cap, Math.floor(input.policy.minBlockSeconds * input.sampleRate))
}

/** Join adjacent pieces while the result stays within the target window. */
function pack(pieces: readonly Span[], cap: number): Span[] {
  const blocks: Span[] = []
  for (const piece of pieces) {
    const last = blocks[blocks.length - 1]
    if (last !== undefined && piece.end - last.start <= cap) {
      blocks[blocks.length - 1] = { start: last.start, end: piece.end }
    } else {
      blocks.push({ start: piece.start, end: piece.end })
    }
  }
  return blocks
}

/**
 * Fold a too-short tail into its predecessor when the combined window still fits, because a
 * short trailing window buys a weaker decode than a slightly longer one.
 */
function mergeTail(blocks: Span[], cap: number, minSamples: number): readonly Span[] {
  if (blocks.length < 2) return blocks
  const tail = blocks[blocks.length - 1]
  const previous = blocks[blocks.length - 2]
  if (tail === undefined || previous === undefined) return blocks
  const tailLength = tail.end - tail.start
  if (tailLength >= minSamples) return blocks
  if (previous.end - previous.start + tailLength > cap) return blocks
  return [...blocks.slice(0, -2), { start: previous.start, end: tail.end }]
}

/**
 * Find the quietest analysis window inside a range and return the offset just past it.
 * @param samples - mono samples.
 * @param from - earliest acceptable cut.
 * @param to - latest acceptable cut.
 * @param window - analysis width in samples.
 * @returns a cut offset strictly between the bounds, clamped to the recording.
 */
export function quietestCut(samples: Float32Array, from: number, to: number, window: number = CUT_WINDOW_SAMPLES): number {
  const start = Math.max(0, Math.min(from, samples.length))
  const limit = Math.max(start + 1, Math.min(to, samples.length))
  let best = limit
  let lowest = Number.POSITIVE_INFINITY
  for (let cursor = start; cursor < limit; cursor += window) {
    const stop = Math.min(cursor + window, samples.length)
    let energy = 0
    for (let index = cursor; index < stop; index += 1) {
      const value = samples[index] ?? 0
      energy += value * value
    }
    const rms = Math.sqrt(energy / Math.max(1, stop - cursor))
    if (rms < lowest) {
      lowest = rms
      best = stop
    }
  }
  return Math.min(limit, Math.max(start + 1, best))
}

/**
 * Reject a plan that would hand a family a window it cannot survive.
 *
 * X-ASR aborts the process past its cap, and that abort cannot be caught, so the check must
 * happen before decoding rather than as error handling afterwards.
 * @param blocks - planned windows.
 * @param sampleRate - samples per second.
 * @param policy - the family's policy.
 * @param modelId - model name used in the message.
 * @throws when any window exceeds the hard cap.
 */
export function assertWithinHardCap(blocks: readonly Span[], sampleRate: number, policy: ChunkingPolicy, modelId: string): void {
  const cap = policy.hardCapSeconds * sampleRate
  for (const block of blocks) {
    const seconds = (block.end - block.start) / sampleRate
    if (block.end - block.start > cap) {
      throw new Error(`${modelId} window of ${seconds.toFixed(1)}s exceeds its ${policy.hardCapSeconds}s hard cap`)
    }
  }
}
