/**
 * One recording through one recognizer.
 *
 * The whole decode lives in the worker process: block planning must happen before the first
 * model call, and the hard-cap check that keeps X-ASR from aborting the process belongs on the
 * same side of the boundary as the decode it guards.
 *
 * Speech regions arrive already computed, so the same planner runs whether the caller detected
 * them with Silero or with the energy fallback.
 */
import type { ChunkingPolicy } from '../catalog.ts'
import { assertWithinHardCap, planBlocks, quietestCut, type Span } from '../chunking.ts'

/** The slice of the sherpa recognizer this module uses. */
export interface StreamRecognizer {
  createStream(hotwords?: string): {
    acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void
  }
  decode(stream: unknown): void
  getResult(stream: unknown): { text: string }
}

/** One decode request. */
export interface DecodeRequest {
  readonly recognizer: StreamRecognizer
  readonly modelId: string
  readonly policy: ChunkingPolicy
  readonly samples: Float32Array
  readonly sampleRate: number
  /** Biasing phrases, only for a family that implements contextual biasing. */
  readonly hotwords?: string
  /** Speech regions from whichever detector the worker chose. */
  readonly segments: readonly Span[]
  /**
   * Adds punctuation after the windows are joined. `always` is for a model that never punctuates;
   * `bare` leaves a transcript that punctuated itself alone and covers the ones that did not.
   */
  readonly punctuate?: ((text: string) => Promise<string>) | undefined
}

/** Result of one decode. */
export interface DecodeResult {
  readonly text: string
  readonly blocks: number
  readonly audioSeconds: number
  /** Speech the detector actually found; silence must not be judged like speech. */
  readonly speechSeconds: number
  readonly inferenceSeconds: number
}

/**
 * Plan the windows for a recording without decoding it.
 * @param request - samples, detected regions and the model's policy.
 * @returns the windows to decode.
 * @throws when a window would exceed the model's hard cap.
 */
export function planRecording(request: Pick<DecodeRequest, 'samples' | 'sampleRate' | 'policy' | 'modelId' | 'segments'>): readonly Span[] {
  const blocks = planBlocks({
    totalSamples: request.samples.length,
    sampleRate: request.sampleRate,
    segments: request.segments,
    policy: request.policy,
    findCut: (from, to) => quietestCut(request.samples, from, to),
  })
  assertWithinHardCap(blocks, request.sampleRate, request.policy, request.modelId)
  return blocks
}

/**
 * Decode a recording block by block, join the transcripts, then punctuate if asked.
 * @param request - recognizer, samples, regions and policy.
 * @returns joined text with timing.
 */
export async function decodeRecording(request: DecodeRequest): Promise<DecodeResult> {
  const started = performance.now()
  const blocks = planRecording(request)
  const parts: string[] = []
  for (const block of blocks) {
    const stream = request.hotwords === undefined
      ? request.recognizer.createStream()
      : request.recognizer.createStream(request.hotwords)
    stream.acceptWaveform({
      sampleRate: request.sampleRate,
      samples: request.samples.subarray(block.start, block.end),
    })
    request.recognizer.decode(stream)
    const piece = request.recognizer.getResult(stream).text.trim()
    if (piece.length > 0) parts.push(piece)
  }
  const speechSamples = request.segments.reduce((total, region) => total + Math.max(0, region.end - region.start), 0)
  const joined = parts.join('')
  const text = request.punctuate === undefined ? joined : await request.punctuate(joined)
  return {
    text,
    blocks: blocks.length,
    audioSeconds: request.samples.length / request.sampleRate,
    speechSeconds: Math.min(speechSamples, request.samples.length) / request.sampleRate,
    inferenceSeconds: (performance.now() - started) / 1000,
  }
}
