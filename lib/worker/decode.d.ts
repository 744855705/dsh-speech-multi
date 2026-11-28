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
import type { ChunkingPolicy } from '../catalog.ts';
import { type Span } from '../chunking.ts';
/** The slice of the sherpa recognizer this module uses. */
export interface StreamRecognizer {
    createStream(hotwords?: string): {
        acceptWaveform(input: {
            sampleRate: number;
            samples: Float32Array;
        }): void;
    };
    decode(stream: unknown): void;
    getResult(stream: unknown): {
        text: string;
    };
}
/** One decode request. */
export interface DecodeRequest {
    readonly recognizer: StreamRecognizer;
    readonly modelId: string;
    readonly policy: ChunkingPolicy;
    readonly samples: Float32Array;
    readonly sampleRate: number;
    /** Biasing phrases, only for a family that implements contextual biasing. */
    readonly hotwords?: string;
    /** Speech regions from whichever detector the worker chose. */
    readonly segments: readonly Span[];
}
/** Result of one decode. */
export interface DecodeResult {
    readonly text: string;
    readonly blocks: number;
    readonly audioSeconds: number;
    /** Speech the detector actually found; silence must not be judged like speech. */
    readonly speechSeconds: number;
    readonly inferenceSeconds: number;
}
/**
 * Plan the windows for a recording without decoding it.
 * @param request - samples, detected regions and the model's policy.
 * @returns the windows to decode.
 * @throws when a window would exceed the model's hard cap.
 */
export declare function planRecording(request: Pick<DecodeRequest, 'samples' | 'sampleRate' | 'policy' | 'modelId' | 'segments'>): readonly Span[];
/**
 * Decode a recording block by block and join the transcripts.
 * @param request - recognizer, samples, regions and policy.
 * @returns joined text with timing.
 */
export declare function decodeRecording(request: DecodeRequest): Promise<DecodeResult>;
