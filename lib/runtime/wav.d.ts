/**
 * Canonical WAV decoding for the private worker.
 *
 * The recorder hands over 16 kHz mono PCM16. Anything else is rejected here rather than being
 * resampled, because a silent resample would change what the models were measured on.
 */
/** Decoded recording. */
export interface DecodedWave {
    /** Samples in [-1, 1], mono. */
    readonly samples: Float32Array;
    readonly sampleRate: number;
    /** Duration derived from the sample count. */
    readonly seconds: number;
}
/**
 * Decode a WAV buffer.
 * @param bytes - complete file contents.
 * @returns mono samples and their duration.
 * @throws when the header is not RIFF/WAVE, the codec is not PCM16, or the rate is not 16 kHz.
 */
export declare function decodeWave(bytes: Uint8Array): DecodedWave;
