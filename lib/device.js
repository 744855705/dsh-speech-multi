const GIB = 1024 ** 3;
/**
 * Tiers in ascending capability, used by the classifier.
 *
 * The model split follows measured peak resident memory at the tier's recording ceiling, not
 * model size on disk:
 *
 * | ceiling | X-ASR  | Fun-ASR |
 * |---------|--------|---------|
 * | 60 s    | 1.0 GB | 2.6 GB  |
 * | 212 s   | 1.0 GB | 2.6 GB  |
 *
 * Both remaining decoders stay inside even the light tier, so the tiers now differ only in how
 * long a recording they accept.
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
        models: ['multi-xasr', 'multi-funasr'],
    },
    large: {
        tier: 'large',
        // The top tier keeps the full ceiling: a small model on a big machine is the cheapest way
        // to transcribe a long recording, and only this tier may attempt one.
        maxRecordingSeconds: 300,
        models: ['multi-xasr', 'multi-funasr'],
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