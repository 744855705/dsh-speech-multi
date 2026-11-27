import { firered } from "./firered.js";
import { funasr } from "./funasr.js";
import { qwen3 } from "./qwen3.js";
import { xasr } from "./xasr.js";
const STRATEGIES = { xasr, funasr, qwen3, firered };
/**
 * Resolve the strategy for a family.
 * @param family - catalog family id.
 * @returns the family strategy; the table is exhaustive, so this cannot miss.
 */
export function strategyFor(family) {
    return STRATEGIES[family];
}
//# sourceMappingURL=index.js.map