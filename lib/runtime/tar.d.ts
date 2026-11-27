/**
 * Expand one `.tar.zst` archive.
 * @param archivePath - archive to read.
 * @param destination - directory entries are written under.
 * @returns after every entry has been written.
 * @throws when an entry escapes the destination.
 */
export declare function extractTarZst(archivePath: string, destination: string): Promise<void>;
