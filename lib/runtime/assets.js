/**
 * Release manifest.
 *
 * Every archive's digest is compiled in rather than fetched, so a rewritten release asset or a
 * dropped-in file is rejected instead of installed. The base URL is configuration because the
 * release lives in the user's own repository.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
const recordSchema = z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    bytes: z.number().int().positive(),
}).strict();
const manifestSchema = z.object({
    version: z.number().int().positive(),
    files: z.record(z.string().min(1), recordSchema),
}).strict();
/** Manifest path, resolved relative to this module so it works from `src` and `lib` alike. */
const MANIFEST_URL = new URL('../../runtime/assets.json', import.meta.url);
/**
 * Read and validate the shipped manifest.
 * @returns the parsed manifest.
 * @throws when the file is missing or malformed, which is a packaging defect rather than a user error.
 */
export function loadManifest() {
    const raw = JSON.parse(readFileSync(fileURLToPath(MANIFEST_URL), 'utf8'));
    return manifestSchema.parse(raw);
}
/**
 * Look up one archive's record.
 * @param manifest - parsed manifest.
 * @param archive - archive file name from the catalog.
 * @returns the digest and length.
 * @throws when the archive is not published, which means the catalog and manifest disagree.
 */
export function assetFor(manifest, archive) {
    const record = manifest.files[archive];
    if (record === undefined)
        throw new Error(`speech-multi manifest does not list ${archive}`);
    return record;
}
/**
 * Build the download URL for one archive.
 * @param baseUrl - release base URL without a trailing slash.
 * @param archive - archive file name.
 * @returns the absolute HTTPS URL.
 */
export function archiveUrl(baseUrl, archive) {
    return `${baseUrl.replace(/\/+$/u, '')}/${encodeURIComponent(archive)}`;
}
//# sourceMappingURL=assets.js.map