const GIB = 1024 ** 3;
/**
 * Tiers in ascending capability, used by the classifier.
 *
 * The model split follows measured peak resident memory at the tier's recording ceiling, not
 * model size on disk:
 *
 * | ceiling | X-ASR | Fun-ASR | Qwen3-0.6B | FireRed-AED |
 * |---|---|---|---|---|
 * | 6 s   | —     | —       | 2.0 GB     | 2.9 GB      |
 * | 60 s  | 1.0 GB | 2.6 GB | 3.0 GB     | 3.5 GB      |
 * | 120 s | —     | —       | 4.3 GB     | 3.6 GB      |
 *
 * Qwen3 therefore belongs to the mid tier and FireRed to the top tier, which is the opposite of
 * what their download sizes suggest. Without punctuation models the tiers would reorder again.
 */
const POLICIES = {
    light: {
        tier: 'light',
        maxRecordingSeconds: 60,
        models: ['multi-xasr', 'multi-funasr'],
    },
    standard: {
        tier: 'standard',
        maxRecordingSeconds: 120,
        models: ['multi-xasr', 'multi-funasr', 'multi-qwen3'],
    },
    large: {
        tier: 'large',
        maxRecordingSeconds: 120,
        models: ['multi-xasr', 'multi-funasr', 'multi-qwen3', 'multi-firered'],
    },
};
/**
 * Pick a tier from total system memory.
 * @param totalMemoryBytes - physical memory reported by the OS.
 * @returns `light` below 8 GiB, `standard` below 16 GiB, `large` above.
 */
export function classifyDevice(totalMemoryBytes) {
    if (!Number.isFinite(totalMemoryBytes) || totalMemoryBytes <= 0)
        return 'light';
    if (totalMemoryBytes < 8 * GIB)
        return 'light';
    if (totalMemoryBytes < 16 * GIB)
        return 'standard';
    return 'large';
}
/**
 * Read a tier's allowance.
 * @param tier - resolved tier.
 * @returns the tier policy.
 */
export function tierPolicy(tier) {
    return POLICIES[tier];
}
/**
 * Keep the requested models that the tier can actually run, preserving priority order.
 * @param requested - models the user enabled.
 * @param tier - resolved tier.
 * @returns the runnable subset; never empty because every tier allows the leading model.
 */
export function availableModels(requested, tier) {
    const allowed = new Set(tierPolicy(tier).models);
    const kept = requested.filter((id) => allowed.has(id));
    return kept.length > 0 ? kept : [tierPolicy(tier).models[0]];
}
//# sourceMappingURL=device.js.map