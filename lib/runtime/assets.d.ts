/** One published archive. */
export interface AssetRecord {
    /** Lowercase hex SHA-256 of the archive. */
    readonly sha256: string;
    /** Exact archive length in bytes. */
    readonly bytes: number;
}
/** Parsed manifest. */
export interface AssetManifest {
    readonly version: number;
    readonly files: Readonly<Record<string, AssetRecord>>;
}
/**
 * Read and validate the shipped manifest.
 * @returns the parsed manifest.
 * @throws when the file is missing or malformed, which is a packaging defect rather than a user error.
 */
export declare function loadManifest(): AssetManifest;
/**
 * Look up one archive's record.
 * @param manifest - parsed manifest.
 * @param archive - archive file name from the catalog.
 * @returns the digest and length.
 * @throws when the archive is not published, which means the catalog and manifest disagree.
 */
export declare function assetFor(manifest: AssetManifest, archive: string): AssetRecord;
/**
 * Build the download URL for one archive.
 * @param baseUrl - release base URL without a trailing slash.
 * @param archive - archive file name.
 * @returns the absolute HTTPS URL.
 */
export declare function archiveUrl(baseUrl: string, archive: string): string;
