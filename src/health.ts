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
export type HealthCheck = 'empty' | 'marker' | 'density' | 'repetition'

/** Outcome of the checks. */
export type HealthResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly check: HealthCheck; readonly detail: string }

/** A finished decode awaiting inspection. */
export interface HealthInput {
  /** Decoded transcript, markers included. */
  readonly text: string
  /** Recording length in seconds. */
  readonly audioSeconds: number
}

/** Below this length a transcript cannot carry a sentence, so emptiness is judged only above it. */
const MIN_JUDGED_SECONDS = 10

/** Shortest result accepted for a judged recording. */
const MIN_JUDGED_CHARS = 10

/** Characters per second below which content was clearly dropped. */
const MIN_CHARS_PER_SECOND = 1

/** Window length used to detect a decoder stuck in a loop. */
const REPEAT_WINDOW = 20

/** How often one window may appear before the result is treated as a loop. */
const REPEAT_LIMIT = 3

/** Tokens a decoder may leak when it fails to strip control symbols. */
const LEAKED_MARKER = /<sil>|<unk>|<blank>|<pad>|\blanguage\b/iu

/**
 * Remove whitespace, keeping the transcript otherwise intact.
 * @param text - raw decoder output.
 * @returns the text without whitespace.
 */
function compact(text: string): string {
  return text.replace(/\s+/gu, '')
}

/**
 * Find a window repeated often enough to mean the decoder looped.
 * @param text - compacted transcript.
 * @returns the repeated window, or undefined.
 */
function findLoop(text: string): string | undefined {
  if (text.length < REPEAT_WINDOW * REPEAT_LIMIT) return undefined
  const seen = new Map<string, number>()
  for (let index = 0; index + REPEAT_WINDOW <= text.length; index += 1) {
    const window = text.slice(index, index + REPEAT_WINDOW)
    const count = (seen.get(window) ?? 0) + 1
    if (count >= REPEAT_LIMIT) return window
    seen.set(window, count)
  }
  return undefined
}

/**
 * Inspect one transcript.
 * @param input - decoded text and its recording length.
 * @returns `ok`, or the first failing rule and a detail string for the log.
 */
export function checkTranscript(input: HealthInput): HealthResult {
  const raw = input.text.trim()
  const text = compact(raw)
  const judged = input.audioSeconds >= MIN_JUDGED_SECONDS
  if (text.length === 0) {
    return judged
      ? { ok: false, check: 'empty', detail: `no text for ${input.audioSeconds.toFixed(1)}s of audio` }
      : { ok: true }
  }
  const marker = LEAKED_MARKER.exec(raw)
  if (marker !== null) {
    return { ok: false, check: 'marker', detail: `control token ${marker[0]} leaked into the transcript` }
  }
  if (judged && text.length < MIN_JUDGED_CHARS) {
    return { ok: false, check: 'empty', detail: `only ${text.length} characters for ${input.audioSeconds.toFixed(1)}s of audio` }
  }
  if (judged && text.length / input.audioSeconds < MIN_CHARS_PER_SECOND) {
    return {
      ok: false,
      check: 'density',
      detail: `${text.length} characters for ${input.audioSeconds.toFixed(1)}s of audio`,
    }
  }
  const loop = findLoop(text)
  if (loop !== undefined) {
    return { ok: false, check: 'repetition', detail: `decoder repeated "${loop}"` }
  }
  return { ok: true }
}
