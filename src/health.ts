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
export type HealthCheck = 'marker' | 'empty' | 'density' | 'repetition'

/** Outcome of the checks. */
export type HealthResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly check: HealthCheck; readonly detail: string }

/** A finished decode awaiting inspection. */
export interface HealthInput {
  /** Raw decoder output, markers included. */
  readonly text: string
  /** Recording length in seconds. */
  readonly audioSeconds: number
  /** Speech the detector found; defaults to the whole recording when the caller cannot tell. */
  readonly speechSeconds?: number
}

/** Control tokens are replaced by a space so words on either side do not run together. */
const CONTROL_TOKEN = /<(?:sil|unk|blank|pad|s|noise|noise[_-]?token)>/giu

/** A decoder that leaked the word `language` produced no real transcript. */
const LEAKED_WORD = /\blanguage\b/iu

/** Below this much detected speech, a short or empty result is normal. */
const MIN_JUDGED_SECONDS = 3

/** Characters per second below which content was clearly dropped. */
const MIN_CHARS_PER_SECOND = 1

/** Window length used to detect a decoder stuck in a loop. */
const REPEAT_WINDOW = 20

/** How often one window may appear before the result is treated as a loop. */
const REPEAT_LIMIT = 3

/**
 * Remove control tokens and redundant whitespace.
 * @param text - raw decoder output.
 * @returns the transcript with markers stripped.
 */
export function sanitize(text: string): string {
  return text.replace(CONTROL_TOKEN, ' ').replace(/[ \t]{2,}/gu, ' ').trim()
}

/**
 * Find a window repeated often enough to mean the decoder looped.
 * @param text - compacted transcript.
 * @returns the repeated window, or undefined.
 */
function findLoop(text: string): string | undefined {
  const compact = text.replace(/\s+/gu, '')
  if (compact.length < REPEAT_WINDOW * REPEAT_LIMIT) return undefined
  const seen = new Map<string, number>()
  for (let index = 0; index + REPEAT_WINDOW <= compact.length; index += 1) {
    const window = compact.slice(index, index + REPEAT_WINDOW)
    const count = (seen.get(window) ?? 0) + 1
    if (count >= REPEAT_LIMIT) return window
    seen.set(window, count)
  }
  return undefined
}

/**
 * Inspect one transcript.
 * @param input - decoder output, recording length and detected speech.
 * @returns `ok`, or the first failing rule and a detail string for the log.
 */
export function checkTranscript(input: HealthInput): HealthResult {
  const cleaned = sanitize(input.text)
  const speechSeconds = input.speechSeconds ?? input.audioSeconds
  const judged = speechSeconds >= MIN_JUDGED_SECONDS
  if (LEAKED_WORD.test(cleaned)) {
    return { ok: false, check: 'marker', detail: 'the decoder emitted the token "language" instead of a transcript' }
  }
  if (cleaned.length === 0) {
    return judged
      ? { ok: false, check: 'empty', detail: `no text for ${speechSeconds.toFixed(1)}s of detected speech` }
      : { ok: true }
  }
  const characters = cleaned.replace(/\s+/gu, '').length
  if (judged && characters < Math.max(10, speechSeconds * MIN_CHARS_PER_SECOND * 0.25)) {
    return { ok: false, check: 'density', detail: `${characters} characters for ${speechSeconds.toFixed(1)}s of detected speech` }
  }
  const loop = findLoop(cleaned)
  if (loop !== undefined) {
    return { ok: false, check: 'repetition', detail: `decoder repeated "${loop}"` }
  }
  return { ok: true }
}
