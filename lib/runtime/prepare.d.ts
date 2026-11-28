import type { FamilyId, ModelDescriptor } from '../catalog.ts';
import { type AssetManifest, type AssetRecord } from './assets.ts';
import { type DownloadProgress } from './download.ts';
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
    /** Directory holding the voice-activity detectors, when the shared archive is installed. */
    readonly vad: string | undefined;
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
    /** Parallel range requests for a large archive. */
    readonly segments?: number | undefined;
    readonly onProgress?: ((progress: DownloadProgress) => void) | undefined;
}
/**
 * Concatenate the slices of one archive and verify the result.
 *
 * The digest covers the whole archive, so a slice that was silently truncated or swapped is caught
 * here rather than by the extractor minutes later.
 * @param slices - parts in publication order.
 * @param destination - file to write.
 * @param record - expected digest and length of the whole archive.
 * @throws when the joined file does not match; nothing is left behind in that case.
 */
export declare function joinParts(slices: readonly string[], destination: string, record: AssetRecord): Promise<void>;
/**
 * Fetch one archive into the cache, reassembling it when the manifest publishes it in parts.
 *
 * Each slice is verified before it is joined, and the joined file is verified again: a host that
 * silently truncates an upload is otherwise installed as a corrupt archive.
 * @param input - locations, manifest and cancellation.
 * @param archive - archive file name.
 * @param record - its published digest and, when split, its slices.
 * @returns the cached archive path.
 */
export declare function fetchArchive(input: Omit<PrepareInput, 'model'>, archive: string, record: AssetRecord): Promise<string>;
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
 * @param input - locations, manifest and cancellation.
 * @returns the resolved shared paths; an entry stays undefined when its archive is not published.
 */
export declare function ensureShared(input: Omit<PrepareInput, 'model'>): Promise<SharedPaths>;
