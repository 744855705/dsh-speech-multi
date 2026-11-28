import type { Config } from '../config.ts';
import { type AssetManifest } from '../runtime/assets.ts';
import type { GpuBackend } from './backend.ts';
/** Pinned runtime source, published beside the models. */
export declare const LLAMA_SOURCE_ARCHIVE = "llama.cpp-1.1.0.zip";
/**
 * Version of the pinned runtime, taken from the archive name.
 *
 * It keys the source tree, the build directory and the shared-build lock, so publishing a newer
 * archive in a later plugin release rebuilds instead of silently reusing the binary built from the
 * previous one.
 * @returns the version found in {@link LLAMA_SOURCE_ARCHIVE}.
 */
export declare function llamaVersion(): string;
/**
 * Directory holding the extracted source for one version.
 * @param config - plugin configuration.
 * @returns the absolute path.
 */
export declare function sourceDirectory(config: Config): string;
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
 * Where one version and backend are compiled.
 * @param config - plugin configuration.
 * @param backend - backend the build targets.
 * @returns the absolute path to the CMake binary directory.
 */
export declare function buildDirectory(config: Config, backend: GpuBackend): string;
/**
 * Whether a path is executable.
 * @param path - absolute path.
 * @returns true when the file exists and carries the execute bit.
 */
export declare function isUsableBinary(path: string): Promise<boolean>;
/**
 * Join an in-flight build instead of starting a second one.
 *
 * Several GPU providers share one binary, and preparing two models at once must not extract the
 * source twice or run two compilers over the same build directory. Cancellation is counted rather
 * than forwarded: a provider that gives up stops waiting, and the build itself is only stopped once
 * nobody is waiting for it, so cancelling one preparation cannot destroy another's work.
 * @param key - data root and backend identifying the binary.
 * @param factory - starts the build; receives the signal that governs its lifetime.
 * @param signal - the caller's cancellation.
 * @returns the binary path.
 */
export declare function sharedBuild(key: string, factory: (signal: AbortSignal) => Promise<string>, signal?: AbortSignal | undefined): Promise<string>;
/**
 * Resolve the runtime binary, compiling it when needed.
 * @param input - configuration, manifest, backend and cancellation.
 * @returns the absolute path to `llama-mtmd-cli`.
 * @throws when the source is missing, the toolchain rejects the build, or cancellation fired.
 */
export declare function ensureLlamaBinary(input: BuildInput): Promise<string>;
/**
 * Remove builds and sources left over from a previous version.
 *
 * Each version owns its own directories, so a bump would otherwise leave the previous compiler
 * output on disk forever. Deletion happens only after the new binary is proven usable, so a failed
 * upgrade still has the old tree to fall back on.
 * @param config - plugin configuration.
 * @returns the entries removed.
 */
export declare function discardOtherVersions(config: Config): Promise<string[]>;
