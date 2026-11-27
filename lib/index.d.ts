import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.ts';
export { Config } from './config.ts';
export declare const name = "dsh-speech-multi";
export declare const inject: string[];
/**
 * Register the enabled models as separate providers and install the selection lock.
 * @param ctx - host registry, subprocess owner and logger.
 * @param config - validated configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
