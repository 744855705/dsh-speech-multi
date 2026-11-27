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
 * Inspect one transcript.
 * @param input - decoder output, recording length and detected speech.
 * @returns `ok`, or the first failing rule and a detail string for the log.
 */
export declare function checkTranscript(input: HealthInput): HealthResult;
