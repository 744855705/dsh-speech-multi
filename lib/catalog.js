/**
 * The model catalog: one place that says which local recognizers exist, how they rank,
 * and what each tolerates. Everything else in the plugin reads this instead of
 * hard-coding a model name, so adding a fifth model is a catalog edit plus one strategy.
 */
/**
 * Ranked best first, which is also the fallback order the tests were run in.
 * X-ASR leads because it was both the most accurate and the fastest on a 212 s
 * real recording; FireRedASR2-AED trails because its English degrades past a minute.
 */
export const MODELS = [
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
    {
        id: 'multi-qwen3',
        family: 'qwen3',
        displayName: 'Qwen3-ASR 0.6B (int8)',
        languages: ['auto', 'zh', 'en'],
        priority: 3,
        chunking: { blockSeconds: 14, minBlockSeconds: 8, hardCapSeconds: 60 },
        punctuation: 'builtin',
        expectedMemoryBytes: 6_400_000_000,
        recommendedDiskBytes: 960_000_000,
        archive: 'qwen3-asr-0.6b-int8.tar.zst',
        root: 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25',
    },
    {
        id: 'multi-firered',
        family: 'firered',
        displayName: 'FireRedASR2-AED (int8)',
        languages: ['auto', 'zh', 'en'],
        priority: 4,
        chunking: { blockSeconds: 26, minBlockSeconds: 8, hardCapSeconds: 55 },
        punctuation: 'external',
        expectedMemoryBytes: 3_300_000_000,
        recommendedDiskBytes: 1_300_000_000,
        archive: 'firered-asr2-aed-int8.tar.zst',
        root: 'firered-aed',
    },
];
/** The model a fresh installation selects. */
export const DEFAULT_MODEL_ID = 'multi-xasr';
/**
 * Every model, best first.
 * @returns a new array sorted by ascending priority.
 */
export function modelsByPriority() {
    return [...MODELS].sort((left, right) => left.priority - right.priority);
}
/**
 * Look up one model.
 * @param id - candidate model id.
 * @returns the descriptor, or undefined when the id is not part of this plugin.
 */
export function findModel(id) {
    return MODELS.find((model) => model.id === id);
}
/**
 * Model ids in priority order; the lock whitelist and the device tiers are expressed in these ids.
 * @returns the ordered id list.
 */
export function modelIds() {
    return modelsByPriority().map((model) => model.id);
}
/**
 * Whether a value is one of this plugin's model ids.
 * @param value - candidate id.
 * @returns true when the catalog contains it.
 */
export function isModelId(value) {
    return findModel(value) !== undefined;
}
//# sourceMappingURL=catalog.js.map