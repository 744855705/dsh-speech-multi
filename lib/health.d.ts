/**
 * Transcript sanity checks.
 *
 * Three of the four models fail silently rather than throwing: they return empty text, a single
 * character, or a paragraph of the same sentence repeated until the token budget runs out. A
 * caller that pastes such text into a prompt never learns the recording was lost, so the plugin
 * rejects these results instead of returning them. The checks cost one pass over text that has
 * already been produced; they are not a performance measure.
 */
/** Which rule rejected a transcript. */
export type HealthCheck = 'empty' | 'marker' | 'density' | 'repetition';
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
    /** Decoded transcript, markers included. */
    readonly text: string;
    /** Recording length in seconds. */
    readonly audioSeconds: number;
}
/**
 * Inspect one transcript.
 * @param input - decoded text and its recording length.
 * @returns `ok`, or the first failing rule and a detail string for the log.
 */
export declare function checkTranscript(input: HealthInput): HealthResult;
