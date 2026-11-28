/**
 * The model catalog: one place that says which local recognizers exist, how they rank,
 * and what each tolerates. Everything else in the plugin reads this instead of
 * hard-coding a model name, so adding a fifth model is a catalog edit plus one strategy.
 */

/** Registered provider ids; consumers select one of these exact ids. */
export type ModelId = 'multi-xasr' | 'multi-funasr'

/** Recognizer family; selects the strategy that builds the sherpa-onnx configuration. */
export type FamilyId = 'xasr' | 'funasr'

/**
 * Where a model's punctuation comes from.
 *
 * Descriptive only: every remaining decoder punctuates itself, and the second-pass wiring was
 * removed with the model that needed it. `external` stays in the union so a future decoder that
 * needs the pass can declare it without reshaping the descriptor.
 */
export type PunctuationSource = 'builtin' | 'external'

/**
 * Per-model decoding window. `blockSeconds` is the measured best-quality window, not the
 * largest the model survives; `hardCapSeconds` is the point at which output becomes
 * unusable or the process dies.
 */
export interface ChunkingPolicy {
  /** Target window that produced the lowest error rate for this model. */
  readonly blockSeconds: number
  /** Shortest acceptable window; below this the decoder loses context or emits garbage. */
  readonly minBlockSeconds: number
  /** Never decode a window longer than this. X-ASR terminates the process past it. */
  readonly hardCapSeconds: number
}

/** Everything the plugin needs to know about one model. */
export interface ModelDescriptor {
  readonly id: ModelId
  readonly family: FamilyId
  readonly displayName: string
  readonly languages: readonly string[]
  /** 1 is the default; callers sort ascending. */
  readonly priority: number
  readonly chunking: ChunkingPolicy
  readonly punctuation: PunctuationSource
  /** Peak resident memory observed for a multi-minute recording. */
  readonly expectedMemoryBytes: number
  /** Installed size on disk. */
  readonly recommendedDiskBytes: number
  /** Release archive that contains this model, and the directory it expands to. */
  readonly archive: string
  readonly root: string
}

/**
 * Ranked best first, which is also the fallback order the tests were run in.
 * X-ASR leads because it was both the most accurate and the fastest on a 212 s
 * real recording; FireRedASR2-AED trails because its English degrades past a minute.
 */
export const MODELS: readonly ModelDescriptor[] = [
  {
    id: 'multi-xasr',
    family: 'xasr',
    displayName: 'X-ASR zh-en (int8, punctuation)',
    languages: ['auto', 'zh', 'en'],
    priority: 1,
    chunking: { blockSeconds: 34, minBlockSeconds: 20, hardCapSeconds: 38 },
    punctuation: 'builtin',
    expectedMemoryBytes: 1_000_000_000,
    recommendedDiskBytes: 180_000_000,
    archive: 'xasr-zh-en-punct-int8.tar.zst',
    root: 'sherpa-onnx-x-asr-zipformer-transducer-zh-en-punct-int8-2026-06-03',
  },
  {
    id: 'multi-funasr',
    family: 'funasr',
    displayName: 'Fun-ASR-Nano (int8, 1024 context)',
    languages: ['auto', 'zh', 'en', 'ja'],
    priority: 2,
    // Past 34 s this decoder starts repeating a phrase until the window ends, so the
    // target and the cap both stay well below the point where that begins.
    chunking: { blockSeconds: 10, minBlockSeconds: 6, hardCapSeconds: 20 },
    punctuation: 'builtin',
    expectedMemoryBytes: 2_700_000_000,
    recommendedDiskBytes: 1_000_000_000,
    archive: 'funasr-nano-1024-int8.tar.zst',
    root: 'funasr-nano-1024',
  },
]

/** The model a fresh installation selects. */
export const DEFAULT_MODEL_ID: ModelId = 'multi-xasr'

/**
 * Every model, best first.
 * @returns a new array sorted by ascending priority.
 */
export function modelsByPriority(): readonly ModelDescriptor[] {
  return [...MODELS].sort((left, right) => left.priority - right.priority)
}

/**
 * Look up one model.
 * @param id - candidate model id.
 * @returns the descriptor, or undefined when the id is not part of this plugin.
 */
export function findModel(id: string): ModelDescriptor | undefined {
  return MODELS.find((model) => model.id === id)
}

/**
 * Model ids in priority order; the lock whitelist and the device tiers are expressed in these ids.
 * @returns the ordered id list.
 */
export function modelIds(): readonly ModelId[] {
  return modelsByPriority().map((model) => model.id)
}

/**
 * Whether a value is one of this plugin's model ids.
 * @param value - candidate id.
 * @returns true when the catalog contains it.
 */
export function isModelId(value: string): value is ModelId {
  return findModel(value) !== undefined
}
