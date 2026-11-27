/**
 * Energy-based speech detection.
 *
 * The plugin needs speech/silence regions only to place block boundaries; the models do the
 * acoustic work. A percentile-based threshold follows a quiet room and a noisy fan alike without
 * a second model file, and an absolute floor keeps a silent recording from being cut into noise.
 */
import type { Span } from './chunking.ts';
/** Analysis frame, 20 ms at 16 kHz. */
declare const FRAME_SAMPLES = 320;
/** Detection tuning. */
export interface VadOptions {
    readonly minSpeechSeconds?: number;
    readonly minGapSeconds?: number;
}
/**
 * Split a recording into speech regions.
 * @param samples - mono samples.
 * @param sampleRate - samples per second.
 * @param options - overrides for the defaults above.
 * @returns ascending, non-overlapping speech regions; empty when nothing crosses the floor.
 */
export declare function detectSpeech(samples: Float32Array, sampleRate: number, options?: VadOptions): readonly Span[];
export { FRAME_SAMPLES };
