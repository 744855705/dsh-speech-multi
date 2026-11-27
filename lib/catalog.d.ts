/**
 * The model catalog: one place that says which local recognizers exist, how they rank,
 * and what each tolerates. Everything else in the plugin reads this instead of
 * hard-coding a model name, so adding a fifth model is a catalog edit plus one strategy.
 */
/** Registered provider ids; consumers select one of these exact ids. */
export type ModelId = 'multi-xasr' | 'multi-funasr' | 'multi-qwen3' | 'multi-firered';
/** Recognizer family; selects the strategy that builds the sherpa-onnx configuration. */
export type FamilyId = 'xasr' | 'funasr' | 'qwen3' | 'firered';
/** Where a model's punctuation comes from: the decoder itself, or the shared punctuation model. */
export type PunctuationSource = 'builtin' | 'external';
/**
 * Per-model decoding window. `blockSeconds` is the measured best-quality window, not the
 * largest the model survives; `hardCapSeconds` is the point at which output becomes
 * unusable or the process dies.
 */
export interface ChunkingPolicy {
    /** Target window that produced the lowest error rate for this model. */
    readonly blockSeconds: number;
    /** Shortest acceptable window; below this the decoder loses context or emits garbage. */
    readonly minBlockSeconds: number;
    /** Never decode a window longer than this. X-ASR terminates the process past it. */
    readonly hardCapSeconds: number;
}
/** Everything the plugin needs to know about one model. */
export interface ModelDescriptor {
    readonly id: ModelId;
    readonly family: FamilyId;
    readonly displayName: string;
    readonly languages: readonly string[];
    /** 1 is the default; callers sort ascending. */
    readonly priority: number;
    readonly chunking: ChunkingPolicy;
    readonly punctuation: PunctuationSource;
    /** Peak resident memory observed for a multi-minute recording. */
    readonly expectedMemoryBytes: number;
    /** Installed size on disk. */
    readonly recommendedDiskBytes: number;
    /** Release archive that contains this model, and the directory it expands to. */
    readonly archive: string;
    readonly root: string;
}
/**
 * Ranked best first, which is also the fallback order the tests were run in.
 * X-ASR leads because it was both the most accurate and the fastest on a 212 s
 * real recording; FireRedASR2-AED trails because its English degrades past a minute.
 */
export declare const MODELS: readonly ModelDescriptor[];
/** The model a fresh installation selects. */
export declare const DEFAULT_MODEL_ID: ModelId;
/**
 * Every model, best first.
 * @returns a new array sorted by ascending priority.
 */
export declare function modelsByPriority(): readonly ModelDescriptor[];
/**
 * Look up one model.
 * @param id - candidate model id.
 * @returns the descriptor, or undefined when the id is not part of this plugin.
 */
export declare function findModel(id: string): ModelDescriptor | undefined;
/**
 * Model ids in priority order; the lock whitelist and the device tiers are expressed in these ids.
 * @returns the ordered id list.
 */
export declare function modelIds(): readonly ModelId[];
/**
 * Whether a value is one of this plugin's model ids.
 * @param value - candidate id.
 * @returns true when the catalog contains it.
 */
export declare function isModelId(value: string): value is ModelId;
