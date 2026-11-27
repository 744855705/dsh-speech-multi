/**
 * Speech-region detection inside the worker.
 *
 * FSMN-VAD is the default because it produced the lowest character error rate of every detector
 * measured on a 212 s recording (4.23-4.61 %, against 6.10-7.60 % for the Silero detector this
 * replaced). FireRedVAD is the fallback at 4.73-5.85 %, tried when the primary model is missing
 * or throws. The energy detector stays last so a recording still gets block boundaries instead of
 * failing outright.
 */
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
 * Detect speech regions, preferring FSMN and degrading to FireRedVAD then to energy.
 * @param samples - mono samples.
 * @param sampleRate - samples per second.
 * @param vadDirectory - directory holding both VAD models, or undefined to use the energy fallback.
 * @param options - thresholds shared by every detector.
 * @returns ascending speech regions.
 */
export declare function detectRegions(samples: Float32Array, sampleRate: number, vadDirectory: string | undefined, options: DetectionOptions): Promise<readonly Span[]>;
