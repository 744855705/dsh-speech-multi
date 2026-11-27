import type { FamilyId, ModelDescriptor } from '../catalog.ts';
import { type AssetManifest } from './assets.ts';
import { type DownloadProgress } from './download.ts';
/** Archive holding the punctuation model, used by the one model that does not punctuate itself. */
export declare const PUNCTUATION_ARCHIVE = "punctuation.tar.zst";
/** Archive holding both voice-activity detectors, shared by every model. */
export declare const VAD_ARCHIVE = "vad.tar.zst";
/** Where one model's files live. */
export declare function modelRoot(dataRoot: string, model: ModelDescriptor): string;
/** Where archives are cached before expansion. */
export declare function archiveCache(dataRoot: string, model: ModelDescriptor): string;
/**
 * Whether a model is already installed.
 * @param root - expected model directory.
 * @param family - family whose marker file proves completeness.
 * @returns true when the marker file is readable.
 */
export declare function isInstalled(root: string, family: FamilyId): Promise<boolean>;
/** Shared asset locations resolved for one model. */
export interface SharedPaths {
    /** Silero VAD model, when the shared archive is installed. */
    readonly vad: string | undefined;
    /** FireRedPunc directory, when the shared archive is installed. */
    readonly punctuation: string | undefined;
}
/**
 * Check the shared archive independently of any model.
 * @param dataRoot - model root.
 * @returns true when the VAD file is readable.
 */
export declare function isSharedInstalled(dataRoot: string): Promise<boolean>;
/** Inputs for one preparation. */
export interface PrepareInput {
    readonly model: ModelDescriptor;
    readonly dataRoot: string;
    readonly baseUrl: string;
    readonly manifest: AssetManifest;
    readonly signal: AbortSignal;
    readonly progressIntervalMs: number;
    readonly onProgress?: ((progress: DownloadProgress) => void) | undefined;
}
/**
 * Make a model available on disk.
 *
 * The archive is verified before it is expanded, and a failed expansion leaves no partial
 * directory that a later run would mistake for a finished install.
 * @param input - model, locations, manifest and cancellation.
 * @returns the model directory.
 */
export declare function ensureModel(input: PrepareInput): Promise<string>;
/**
 * Make the shared archives available.
 *
 * Punctuation is needed by exactly one model, the VAD by all of them, and they ship separately so
 * replacing a detector does not force a re-download of the 248 MB punctuation archive.
 * @param input - locations, manifest and cancellation.
 * @returns the resolved shared paths; an entry stays undefined when its archive is not published.
 */
export declare function ensureShared(input: Omit<PrepareInput, 'model'>): Promise<SharedPaths>;
