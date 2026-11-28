/** Family lookup: the factory that maps a catalog entry to its strategy. */
import type { FamilyId } from '../catalog.ts'
import type { FamilyStrategy } from './family.ts'
import { funasr } from './funasr.ts'
import { xasr } from './xasr.ts'

const STRATEGIES: Readonly<Record<FamilyId, FamilyStrategy>> = { xasr, funasr }

/**
 * Resolve the strategy for a family.
 * @param family - catalog family id.
 * @returns the family strategy; the table is exhaustive, so this cannot miss.
 */
export function strategyFor(family: FamilyId): FamilyStrategy {
  return STRATEGIES[family]
}

export type { EngineSpec, FamilyOptions, FamilyStrategy, ModelPaths } from './family.ts'
