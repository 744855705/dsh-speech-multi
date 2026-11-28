/** One slice of an archive published in pieces. */
export interface AssetPart {
    /** File name of the slice inside its release. */
    readonly name: string;
    /** Lowercase hex SHA-256 of the slice. */
    readonly sha256: string;
    /** Exact slice length in bytes. */
    readonly bytes: number;
}
/** One published archive. */
export interface AssetRecord {
    /** Lowercase hex SHA-256 of the archive, or of the reassembled archive when it ships in parts. */
    readonly sha256: string;
    /** Exact archive length in bytes, or the sum of the parts. */
    readonly bytes: number;
    /**
     * Release tag holding the file, when it is not the default release.
     *
     * The model set outgrew one release: the CPU archives stay where they were published and the
     * GPU ones live under a later tag, so the manifest has to say which tag each file belongs to.
     */
    readonly release?: string | undefined;
    /**
     * Ordered slices of an archive larger than the host's per-file ceiling.
     *
     * GitHub refuses release assets over 2 GB, so the 1.7B archives are split and reassembled after
     * every slice has been verified individually.
     */
    readonly parts?: readonly AssetPart[] | undefined;
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
/**
 * Build the download URL for one file of a manifest entry.
 *
 * @param baseUrl - release base URL, ending in the default release tag.
 * @param record - the entry that may name a different release.
 * @param file - archive name, or one part's file name.
 * @returns the absolute HTTPS URL.
 */
export declare function assetUrl(baseUrl: string, record: AssetRecord | undefined, file: string): string;
