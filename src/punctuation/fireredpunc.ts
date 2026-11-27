/**
 * FireRedPunc punctuation through WebAssembly.
 *
 * The model is a BERT-style token classifier: it labels every token with the punctuation that
 * follows it. Two details make the difference between usable and broken output:
 *
 * - Marks are re-inserted into the *original* transcript at the token's end offset, never into
 *   the tokenizer's own decode. Rebuilding from the original string keeps English casing and the
 *   spaces around embedded English words, which a detokenized rebuild silently loses.
 * - WebAssembly rather than the native runtime: `onnxruntime-node` downloads a build at install
 *   time and fails behind a redirecting mirror, while the WASM build ships inside the package and
 *   installs anywhere.
 */
import { createRequire } from 'node:module'
import { dirname, sep } from 'node:path'

/** Punctuation labels the model can emit, indexed by class. */
const LABELS = ['', '，', '。', '？', '！'] as const

/** Lazily created session and tokenizer; both are expensive enough to keep. */
let shared: Promise<{ session: OrtSession; tokenizer: OrtTokenizer }> | undefined

/** Minimal shapes this module needs; the packages type themselves. */
interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<{ logits: { data: Float32Array; dims: readonly number[] } }>
}
interface OrtTokenizer {
  encode(text: string): Promise<{
    getIds(): number[]
    getOffsets(): [number, number][]
    getAttentionMask(): number[]
    getTypeIds(): number[]
    getSpecialTokensMask(): number[]
  }>
}

/** Files this module expects inside the punctuation directory. */
export const PUNCTUATION_FILES = ['punc.fp16.onnx', 'tokenizer.json'] as const

const require = createRequire(import.meta.url)

/**
 * Directory holding the WebAssembly assets that ship with `onnxruntime-web`.
 *
 * The trailing separator matters: the runtime joins this value with the asset name directly, so
 * a bare directory produces `distort-wasm-simd-threaded.mjs`.
 * @returns the directory prefix ending with a separator.
 */
function wasmDirectory(): string {
  const directory = dirname(require.resolve('onnxruntime-web'))
  return directory.endsWith(sep) ? directory : `${directory}${sep}`
}

/**
 * Create the shared session and tokenizer on first use.
 * @param directory - prepared punctuation directory.
 * @returns the runtime handles.
 */
async function load(directory: string): Promise<{ session: OrtSession; tokenizer: OrtTokenizer }> {
  const ort = await import('onnxruntime-web')
  ort.env.wasm.wasmPaths = wasmDirectory()
  // One thread keeps this inside a worker subprocess without spawning its own pool.
  ort.env.wasm.numThreads = 1
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { Tokenizer } = await import('tokenizers')
  const session = await ort.InferenceSession.create(readFileSync(join(directory, 'punc.fp16.onnx')), {
    executionProviders: ['wasm'],
  }) as unknown as OrtSession
  const tokenizer = await Tokenizer.fromFile(join(directory, 'tokenizer.json')) as unknown as OrtTokenizer
  return { session, tokenizer }
}

/**
 * Resolve the lazily created handles, caching the successful pair.
 * @param directory - prepared punctuation directory.
 * @returns the runtime handles.
 */
async function runtime(directory: string): Promise<{ session: OrtSession; tokenizer: OrtTokenizer }> {
  shared ??= load(directory).catch((error: unknown) => {
    shared = undefined
    throw error
  })
  return await shared
}

/** One punctuation mark and the transcript offset it follows. */
export interface Mark {
  readonly at: number
  readonly mark: string
}

/**
 * Insert marks into the original string without touching its characters.
 *
 * Working from the source text rather than a detokenized rebuild is what keeps `COMMIT`, `API`
 * and the spaces around embedded English intact.
 * @param text - original transcript.
 * @param marks - marks keyed by character offset.
 * @returns the transcript with marks inserted.
 */
export function applyMarks(text: string, marks: readonly Mark[]): string {
  const alreadyMarked = (offset: number): boolean => offset > 0 && /[，。？！、；：]/u.test(text.slice(offset - 1, offset))
  let result = ''
  let cursor = 0
  for (const { at, mark } of marks) {
    if (at <= cursor || at > text.length) continue
    // Never stack a mark on top of a mark the decoder already produced.
    if (alreadyMarked(at)) continue
    result += `${text.slice(cursor, at)}${mark}`
    cursor = at
  }
  return result + text.slice(cursor)
}

/**
 * Insert punctuation into a transcript.
 * @param directory - prepared punctuation directory.
 * @param text - unpunctuated transcript; the original characters are preserved.
 * @returns the transcript with punctuation, or the input unchanged when nothing is marked.
 */
export async function punctuate(directory: string, text: string): Promise<string> {
  if (text.length === 0) return text
  const { session, tokenizer } = await runtime(directory)
  const encoded = await tokenizer.encode(text)
  const ids = encoded.getIds()
  if (ids.length === 0) return text
  const int64 = (values: readonly number[]): BigInt64Array => BigInt64Array.from(values.map((value) => BigInt(value)))
  const ort = await import('onnxruntime-web')
  const width = ids.length
  const logits = await session.run({
    input_ids: new ort.Tensor('int64', int64(ids), [1, width]),
    attention_mask: new ort.Tensor('int64', int64(encoded.getAttentionMask()), [1, width]),
    token_type_ids: new ort.Tensor('int64', int64(encoded.getTypeIds()), [1, width]),
  })
  const offsets = encoded.getOffsets()
  const special = encoded.getSpecialTokensMask()
  const classes = logits.logits.dims[2] ?? LABELS.length
  const marks: Mark[] = []
  for (let index = 0; index < width; index += 1) {
    if ((special[index] ?? 0) === 1) continue
    let best = 0
    let highest = Number.NEGATIVE_INFINITY
    for (let label = 0; label < classes; label += 1) {
      const value = logits.logits.data[index * classes + label] ?? Number.NEGATIVE_INFINITY
      if (value > highest) {
        highest = value
        best = label
      }
    }
    const mark = LABELS[best] ?? ''
    const end = offsets[index]?.[1] ?? 0
    if (mark !== '' && end > 0) marks.push({ at: end, mark })
  }
  return applyMarks(text, marks)
}

/**
 * Punctuate without ever losing the transcript.
 *
 * Punctuation is a presentation step: a missing or broken model must leave the recognized text
 * exactly as the decoder produced it rather than failing the recording.
 * @param directory - prepared punctuation directory, or undefined when punctuation is off.
 * @param text - unpunctuated transcript.
 * @returns punctuated text, or the input when punctuation is unavailable.
 */
export async function punctuateOrKeep(directory: string | undefined, text: string): Promise<string> {
  if (directory === undefined) return text
  try {
    return await punctuate(directory, text)
  } catch {
    return text
  }
}

/** Release the cached handles; used when the worker shuts down. */
export function closePunctuation(): void {
  shared = undefined
}
