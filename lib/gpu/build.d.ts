import type { Config } from '../config.ts';
import { type AssetManifest } from '../runtime/assets.ts';
import type { GpuBackend } from './backend.ts';
/** Pinned runtime source, published beside the models. */
export declare const LLAMA_SOURCE_ARCHIVE = "llama.cpp-1.1.0.zip";
/** Inputs for resolving the runtime binary. */
export interface BuildInput {
    readonly config: Config;
    readonly manifest: AssetManifest;
    readonly backend: GpuBackend;
    readonly signal: AbortSignal;
    /** Reports a human-readable step, so the settings page can show what is happening. */
    readonly onStep?: ((step: string) => void) | undefined;
}
/**
 * Where a built binary lives for one backend.
 * @param config - plugin configuration.
 * @param backend - backend it was compiled for.
 * @returns the absolute path to `llama-mtmd-cli`.
 */
export declare function builtBinary(config: Config, backend: GpuBackend): string;
/**
 * Resolve the runtime binary, compiling it when needed.
 * @param input - configuration, manifest, backend and cancellation.
 * @returns the absolute path to `llama-mtmd-cli`.
 * @throws when the source is missing, the toolchain rejects the build, or cancellation fired.
 */
export declare function ensureLlamaBinary(input: BuildInput): Promise<string>;
