import type { FamilyStrategy } from './family.ts';
/**
 * X-ASR keeps its encoder frozen at 1000 output frames, so a window longer than
 * `hardCapSeconds` makes the native layer abort the process instead of returning an error.
 * Greedy search matches the upstream reference and measured the same error rate as beam search
 * while running a quarter faster.
 */
export declare const xasr: FamilyStrategy;
