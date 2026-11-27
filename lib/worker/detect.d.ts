import type { Span } from '../chunking.ts';
/** Detection settings carried from the plugin configuration. */
export interface DetectionOptions {
    readonly threshold: number;
    readonly minSilenceSeconds: number;
    readonly minSpeechSeconds: number;
    readonly maxSpeechSeconds: number;
    readonly threads: number;
}
/**
 * Detect speech regions, preferring Silero.
 * @param samples - mono samples.
 * @param sampleRate - samples per second.
 * @param vadModel - Silero model path, or undefined to use the energy fallback.
 * @param options - thresholds shared by both detectors.
 * @returns ascending speech regions.
 */
export declare function detectRegions(samples: Float32Array, sampleRate: number, vadModel: string | undefined, options: DetectionOptions): readonly Span[];
