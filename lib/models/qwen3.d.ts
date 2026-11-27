import type { FamilyStrategy } from './family.ts';
/**
 * Size the shared context budget for one recording.
 * @param audioSeconds - decoded recording length.
 * @returns a token budget between the graph minimum and its ceiling.
 */
export declare function totalLenFor(audioSeconds: number): number;
export declare const qwen3: FamilyStrategy;
