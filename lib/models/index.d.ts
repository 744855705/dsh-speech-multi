/** Family lookup: the factory that maps a catalog entry to its strategy. */
import type { FamilyId } from '../catalog.ts';
import type { FamilyStrategy } from './family.ts';
/**
 * Resolve the strategy for a family.
 * @param family - catalog family id.
 * @returns the family strategy; the table is exhaustive, so this cannot miss.
 */
export declare function strategyFor(family: FamilyId): FamilyStrategy;
export type { EngineSpec, FamilyOptions, FamilyStrategy, ModelPaths } from './family.ts';
