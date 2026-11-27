/**
 * Device tiers.
 *
 * Peak memory is driven by the model plus the longest single window, so a small machine gets a
 * smaller model set and a shorter recording allowance instead of an out-of-memory crash. The
 * ordering follows the plan: drop models first, then shorten recordings.
 */
import type { ModelId } from './catalog.ts'

/** Memory class the plugin adapts to. */
export type DeviceTier = 'light' | 'standard' | 'large'

/** What a tier may run. */
export interface TierPolicy {
  readonly tier: DeviceTier
  /** Recording length ceiling for this tier. */
  readonly maxRecordingSeconds: number
  /** Models allowed on this tier, in priority order. */
  readonly models: readonly ModelId[]
}

const GIB = 1024 ** 3

/** Tiers in ascending capability, used by the classifier. */
const POLICIES: Readonly<Record<DeviceTier, TierPolicy>> = {
  light: {
    tier: 'light',
    maxRecordingSeconds: 60,
    models: ['multi-xasr', 'multi-funasr'],
  },
  standard: {
    tier: 'standard',
    maxRecordingSeconds: 120,
    models: ['multi-xasr', 'multi-funasr', 'multi-firered'],
  },
  large: {
    tier: 'large',
    maxRecordingSeconds: 300,
    models: ['multi-xasr', 'multi-funasr', 'multi-qwen3', 'multi-firered'],
  },
}

/**
 * Pick a tier from total system memory.
 * @param totalMemoryBytes - physical memory reported by the OS.
 * @returns `light` below 8 GiB, `standard` below 16 GiB, `large` above.
 */
export function classifyDevice(totalMemoryBytes: number): DeviceTier {
  if (!Number.isFinite(totalMemoryBytes) || totalMemoryBytes <= 0) return 'light'
  if (totalMemoryBytes < 8 * GIB) return 'light'
  if (totalMemoryBytes < 16 * GIB) return 'standard'
  return 'large'
}

/**
 * Read a tier's allowance.
 * @param tier - resolved tier.
 * @returns the tier policy.
 */
export function tierPolicy(tier: DeviceTier): TierPolicy {
  return POLICIES[tier]
}

/**
 * Keep the requested models that the tier can actually run, preserving priority order.
 * @param requested - models the user enabled.
 * @param tier - resolved tier.
 * @returns the runnable subset; never empty because every tier allows the leading model.
 */
export function availableModels(requested: readonly ModelId[], tier: DeviceTier): readonly ModelId[] {
  const allowed = new Set(tierPolicy(tier).models)
  const kept = requested.filter((id) => allowed.has(id))
  return kept.length > 0 ? kept : [tierPolicy(tier).models[0] as ModelId]
}
