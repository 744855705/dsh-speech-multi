/**
 * Decoding windows for one recording.
 *
 * Every model has three numbers: the window that measured best, the shortest worth decoding,
 * and the length past which it fails. Packing speech segments up to the best window keeps the
 * cut points on silence, which is the only place a boundary costs nothing.
 */
import type { ChunkingPolicy } from './catalog.ts';
/** A half-open sample range. */
export interface Span {
    readonly start: number;
    readonly end: number;
}
/** Inputs for one block plan. */
export interface PlanInput {
    readonly totalSamples: number;
    readonly sampleRate: number;
    /** Speech regions from the voice-activity detector, ascending and non-overlapping. */
    readonly segments: readonly Span[];
    readonly policy: ChunkingPolicy;
    /** Finds a low-energy cut between two sample offsets; defaults to the built-in scan. */
    readonly findCut?: ((from: number, to: number) => number) | undefined;
}
/** Analysis window used to look for a quiet cut, 100 ms at 16 kHz. */
export declare const CUT_WINDOW_SAMPLES = 1600;
/**
 * Split a recording into decoding windows.
 *
 * A recording that fits the target window is never cut. Otherwise speech segments are packed in
 * order until the next one would overflow, which puts every boundary on the silence the detector
 * already found; a segment that is itself too long is cut at its quietest 100 ms.
 * @param input - samples, segments, and the model's policy.
 * @returns windows in ascending order, each at most `blockSeconds` long.
 */
export declare function planBlocks(input: PlanInput): readonly Span[];
/**
 * Find the quietest analysis window inside a range and return the offset just past it.
 * @param samples - mono samples.
 * @param from - earliest acceptable cut.
 * @param to - latest acceptable cut.
 * @param window - analysis width in samples.
 * @returns a cut offset strictly between the bounds, clamped to the recording.
 */
export declare function quietestCut(samples: Float32Array, from: number, to: number, window?: number): number;
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
export declare function assertWithinHardCap(blocks: readonly Span[], sampleRate: number, policy: ChunkingPolicy, modelId: string): void;
