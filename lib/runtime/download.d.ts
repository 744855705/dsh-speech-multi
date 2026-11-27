import type { AssetRecord } from './assets.ts';
/** What a caller learns while bytes arrive. */
export interface DownloadProgress {
    readonly completedBytes: number;
    /** Present only when the server sent a content length. */
    readonly totalBytes?: number;
}
/** Options for one download. */
export interface DownloadOptions {
    /** Cancels the transfer. */
    readonly signal: AbortSignal;
    /** Progress callback, already throttled by the caller. */
    readonly onProgress?: ((progress: DownloadProgress) => void) | undefined;
    /** Minimum interval between progress callbacks. */
    readonly progressIntervalMs?: number;
}
/**
 * Verify a file against the manifest.
 * @param path - file to read.
 * @param record - expected digest and length.
 * @returns true when both length and digest match.
 */
export declare function verifyFile(path: string, record: AssetRecord): Promise<boolean>;
/**
 * Stream one archive to disk and verify it.
 * @param url - absolute HTTPS URL.
 * @param destination - file to create; removed when verification fails.
 * @param record - expected digest and length.
 * @param options - cancellation and progress.
 * @returns after the file is proven to match.
 * @throws when the response fails, the length differs, or the digest differs.
 */
export declare function downloadArchive(url: string, destination: string, record: AssetRecord, options: DownloadOptions): Promise<void>;
