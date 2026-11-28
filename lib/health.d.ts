/**
 * Transcript sanity checks.
 *
 * Three of the four models fail silently rather than throwing: they return empty text, a single
 * character, or a paragraph of the same sentence repeated until the token budget runs out. A
 * caller that pastes such text into a prompt never learns the recording was lost, so the plugin
 * inspects every result instead of returning it unchecked.
 *
 * Two rules keep the checks from misfiring:
 *
 * - Control tokens (`<sil>`, `<unk>`, and friends) are stripped before judging. A transducer
 *   emits `<sil>` for silence, sometimes in the middle of a sentence and sometimes as the whole
 *   result when nothing was said. That is noise, not a failure.
 * - Judging keys off *detected speech*, not recording length. A minute of silence legitimately
 *   produces no text, so an empty result is only suspicious when the detector heard speech.
 */
/** Which rule rejected a transcript. */
export type HealthCheck = 'marker' | 'empty' | 'density' | 'repetition';
/** Outcome of the checks. */
export type HealthResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly check: HealthCheck;
    readonly detail: string;
};
/** A finished decode awaiting inspection. */
export interface HealthInput {
    /** Raw decoder output, markers included. */
    readonly text: string;
    /** Recording length in seconds. */
    readonly audioSeconds: number;
    /** Speech the detector found; defaults to the whole recording when the caller cannot tell. */
    readonly speechSeconds?: number;
}
/**
 * Remove control tokens and redundant whitespace.
 * @param text - raw decoder output.
 * @returns the transcript with markers stripped.
 */
export declare function sanitize(text: string): string;
/**
 * Content characters from which a transcript is a sentence rather than a fragment.
 *
 * Anything shorter ("好", "可以") is a word or two in answer to a prompt, and a sentence mark on the
 * end reads as a mistake.
 */
export declare const PUNCTUATED_FROM_CHARS = 3;
/**
 * Count the characters a mark could belong to.
 * @param text - transcript.
 * @returns the length without marks or whitespace.
 */
export declare function contentLength(text: string): number;
/**
 * Drop the trailing punctuation of a fragment.
 *
 * A one- or two-character answer ("好", "可以") is not a sentence, so a full stop or comma on the end
 * reads as a mistake rather than as punctuation. Three characters and up keep whatever mark the
 * model chose.
 * @param text - transcript, already sanitized.
 * @returns the transcript without a trailing mark when it is shorter than {@link PUNCTUATED_FROM_CHARS}.
 */
export declare function trimShortTrailingMarks(text: string): string;
/**
 * Inspect one transcript.
 * @param input - decoder output, recording length and detected speech.
 * @returns `ok`, or the first failing rule and a detail string for the log.
 */
export declare function checkTranscript(input: HealthInput): HealthResult;
