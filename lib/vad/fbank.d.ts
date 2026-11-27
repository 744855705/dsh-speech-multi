/**
 * Kaldi-compatible log-mel frontend shared by both VAD detectors.
 *
 * The two models were trained on 80-bin fbank computed from 16 kHz audio whose samples carry
 * int16 scale, not the `[-1, 1]` range a WAV decoder hands back. Feeding the normalised range
 * shifts every log-mel value by about -18.9, which does not fail loudly: FireRedVAD keeps
 * returning probabilities, they just sit at 0.001 everywhere. Hence {@link INT16_SCALE}.
 *
 * Frame geometry matches Kaldi's defaults — 25 ms window, 10 ms shift, Povey window, 512-point
 * FFT, 80 mel bins from 20 Hz to Nyquist — because that is what the reference implementation
 * used when the CER numbers were measured.
 */
/** Samples per second the models expect. */
export declare const FEATURE_SAMPLE_RATE = 16000;
/** Mel bins per frame. */
export declare const FEATURE_DIM = 80;
/**
 * Compute log-mel frames.
 *
 * The samples are expected in the `[-1, 1]` range, exactly as the WAV decoder returns them;
 * scaling to int16 happens here so no caller has to remember it.
 * @param samples - mono samples in `[-1, 1]`.
 * @param sampleRate - audio rate in Hz.
 * @returns `frames * FEATURE_DIM` values, frame-major.
 */
export declare function logMel(samples: Float32Array, sampleRate: number): {
    data: Float32Array;
    frames: number;
};
/**
 * Normalise with a mean/inverse-deviation pair, in place.
 * @param data - frame-major features.
 * @param means - per-dimension means.
 * @param scales - per-dimension multipliers.
 */
export declare function applyMeanScale(data: Float32Array, means: Float32Array, scales: Float32Array): void;
/**
 * Normalise by shift and scale, the form FunASR's `vad.mvn` uses.
 * @param data - frame-major features, already stacked for LFR.
 * @param shift - per-dimension addend (typically negative).
 * @param scales - per-dimension multiplier.
 */
export declare function applyShiftScale(data: Float32Array, shift: Float32Array, scales: Float32Array): void;
/**
 * Stack `lfrM` consecutive frames into one, keeping every frame in order.
 *
 * FunASR's LFR repeats the first frame `(lfrM - 1) / 2` times at the front so the output keeps
 * the input frame count.
 * @param data - frame-major features.
 * @param frames - input frame count.
 * @param lfrM - frames to stack.
 * @returns stacked features of `frames * FEATURE_DIM * lfrM` values.
 */
export declare function lfr(data: Float32Array, frames: number, lfrM: number): Float32Array;
