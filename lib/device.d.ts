/**
 * Device tiers.
 *
 * Peak memory is driven by the model plus the longest single window, so a small machine gets a
 * smaller model set and a shorter recording allowance instead of an out-of-memory crash. The
 * ordering follows the plan: drop models first, then shorten recordings.
 */
import type { ModelId } from './catalog.ts';
/** Memory class the plugin adapts to. */
export type DeviceTier = 'light' | 'standard' | 'large';
/** What a tier may run. */
export interface TierPolicy {
    readonly tier: DeviceTier;
    /** Recording length ceiling for this tier. */
    readonly maxRecordingSeconds: number;
    /** Models allowed on this tier, in priority order. */
    readonly models: readonly ModelId[];
}
/**
 * Pick a tier from total system memory.
 * @param totalMemoryBytes - physical memory reported by the OS.
 * @returns `light` below 8 GiB, `standard` below 16 GiB, `large` above.
 */
export declare function classifyDevice(totalMemoryBytes: number): DeviceTier;
/**
 * Read a tier's allowance.
 * @param tier - resolved tier.
 * @returns the tier policy.
 */
export declare function tierPolicy(tier: DeviceTier): TierPolicy;
/**
 * Keep the requested models that the tier can actually run, preserving priority order.
 * @param requested - models the user enabled.
 * @param tier - resolved tier.
 * @returns the runnable subset; never empty because every tier allows the leading model.
 */
export declare function availableModels(requested: readonly ModelId[], tier: DeviceTier): readonly ModelId[];
