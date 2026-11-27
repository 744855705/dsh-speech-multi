import type { Span } from '../chunking.ts';
import type { DetectionOptions } from '../worker/detect.ts';
/** A detector knows how to turn samples into speech spans. */
export interface Detector {
    /** Detects speech regions using the models in `directory`. */
    detect(directory: string, samples: Float32Array, options: DetectionOptions): Promise<Span[]>;
}
/**
 * Read FunASR's `vad.mvn`, which stores add-shift and rescale vectors as bracketed lists.
 * @param text - file contents.
 * @returns the two vectors, both 400 wide.
 */
export declare function parseMvn(text: string): {
    shift: Float32Array;
    scale: Float32Array;
};
/**
 * Turn a per-frame speech flag into sample spans.
 *
 * Shared by both detectors so their thresholds mean the same thing: a region closes only after
 * `minSilenceSeconds` of silence, opens only after `minSpeechSeconds` of speech, and is cut at
 * `maxSpeechSeconds` because the downstream models cannot take an unbounded block.
 * @param speech - one flag per frame.
 * @param options - detection thresholds.
 * @returns ascending spans in samples.
 */
export declare function spansFromFlags(speech: readonly boolean[], options: DetectionOptions): Span[];
/** FSMN-VAD: LFR-stacked frames, four recurrent caches, speech when the silence score is low. */
export declare const fsmn: Detector;
/** FireRedVAD: stateless, one pass over the whole utterance, speech when the score is high. */
export declare const fireRed: Detector;
