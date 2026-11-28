import type { Config } from '../config.ts';
import { type AssetManifest } from '../runtime/assets.ts';
import type { GpuModelSpec } from './spec.ts';
/** The two files one GPU model needs. */
export interface GpuFilePaths {
    /** Text model weights. */
    readonly model: string;
    /** Audio encoder, run on the CPU by the runtime. */
    readonly mmproj: string;
}
/** Inputs for resolving one model's files. */
export interface GpuFilesInput {
    readonly spec: GpuModelSpec;
    readonly config: Config;
    readonly manifest: AssetManifest;
    readonly signal: AbortSignal;
}
/** Where one GPU model is installed. */
export declare function gpuModelRoot(config: Config, spec: GpuModelSpec): string;
/**
 * Resolve the model files, installing them when they are missing.
 * @param input - model, configuration, manifest and cancellation.
 * @returns the model and audio-tower paths.
 * @throws when the files are absent locally and the archive does not provide them.
 */
export declare function resolveGpuFiles(input: GpuFilesInput): Promise<GpuFilePaths>;
