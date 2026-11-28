/** Model acquisition: inspect what is on disk, then download, verify and expand what is missing. */
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { assetFor, assetUrl } from "./assets.js";
import { downloadArchive, verifyFile } from "./download.js";
import { extractTarZst } from "./tar.js";
/** Archive holding both voice-activity detectors, shared by every model. */
export const VAD_ARCHIVE = 'vad.tar.zst';
/** File whose presence proves the VAD archive finished expanding. */
const VAD_MARKER = join('vad', 'fsmn.onnx');
/** File whose presence proves an expansion finished, keyed by family. */
const MARKERS = {
    xasr: 'tokens.txt',
    funasr: 'llm.int8.onnx',
};
/** Where one model's files live. */
export function modelRoot(dataRoot, model) {
    return join(dataRoot, model.root);
}
/** Where archives are cached before expansion. */
export function archiveCache(dataRoot, model) {
    return join(dataRoot, '.cache', model.archive);
}
/**
 * Whether a model is already installed.
 * @param root - expected model directory.
 * @param family - family whose marker file proves completeness.
 * @returns true when the marker file is readable.
 */
export async function isInstalled(root, family) {
    try {
        await access(join(root, MARKERS[family]));
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Check the shared archive independently of any model.
 * @param dataRoot - model root.
 * @returns true when the VAD file is readable.
 */
export async function isSharedInstalled(dataRoot) {
    try {
        await access(join(dataRoot, VAD_MARKER));
        return true;
    }
    catch {
        return false;
    }
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
export async function joinParts(slices, destination, record) {
    await rm(destination, { force: true });
    await pipeline(async function* () {
        for (const slice of slices)
            yield* createReadStream(slice);
    }, createWriteStream(destination));
    if (!(await verifyFile(destination, record))) {
        await rm(destination, { force: true });
        throw new Error(`speech-multi archive did not match the published digest after joining ${slices.length} parts`);
    }
}
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
export async function fetchArchive(input, archive, record) {
    const cacheDir = join(input.dataRoot, '.cache');
    const cached = join(cacheDir, archive);
    const options = {
        signal: input.signal,
        progressIntervalMs: input.progressIntervalMs,
        ...input.segments === undefined ? {} : { segments: input.segments },
        ...input.onProgress === undefined ? {} : { onProgress: input.onProgress },
    };
    if (record.parts === undefined) {
        await downloadArchive(assetUrl(input.baseUrl, record, archive), cached, record, options);
        return cached;
    }
    const slices = [];
    for (const part of record.parts) {
        const slice = join(cacheDir, part.name);
        if (!(await verifyFile(slice, part))) {
            await downloadArchive(assetUrl(input.baseUrl, record, part.name), slice, part, options);
        }
        slices.push(slice);
    }
    input.signal.throwIfAborted();
    await joinParts(slices, cached, record);
    for (const slice of slices)
        await rm(slice, { force: true });
    return cached;
}
/**
 * Make a model available on disk.
 *
 * The archive is verified before it is expanded, and a failed expansion leaves no partial
 * directory that a later run would mistake for a finished install.
 * @param input - model, locations, manifest and cancellation.
 * @returns the model directory.
 */
export async function ensureModel(input) {
    const root = modelRoot(input.dataRoot, input.model);
    if (await isInstalled(root, input.model.family))
        return root;
    const record = assetFor(input.manifest, input.model.archive);
    const cached = archiveCache(input.dataRoot, input.model);
    await mkdir(join(input.dataRoot, '.cache'), { recursive: true });
    if (!(await isInstalled(cached, input.model.family))) {
        await fetchArchive(input, input.model.archive, record);
    }
    input.signal.throwIfAborted();
    await rm(root, { recursive: true, force: true });
    try {
        await extractTarZst(cached, input.dataRoot);
    }
    catch (error) {
        await rm(root, { recursive: true, force: true });
        throw error;
    }
    if (!(await isInstalled(root, input.model.family))) {
        throw new Error(`speech-multi archive ${input.model.archive} did not contain ${input.model.root}`);
    }
    return root;
}
/**
 * Make the shared archives available.
 * @param input - locations, manifest and cancellation.
 * @returns the resolved shared paths; an entry stays undefined when its archive is not published.
 */
export async function ensureShared(input) {
    const vad = join(input.dataRoot, 'vad');
    await mkdir(join(input.dataRoot, '.cache'), { recursive: true });
    const fetch = async (archive, marker) => {
        try {
            await access(join(input.dataRoot, marker));
            return true;
        }
        catch {
            // Not installed yet, or a previous expansion failed half way.
        }
        const record = input.manifest.files[archive];
        if (record === undefined)
            return false;
        const cached = await fetchArchive(input, archive, record);
        await extractTarZst(cached, input.dataRoot);
        return true;
    };
    const vadReady = await fetch(VAD_ARCHIVE, VAD_MARKER);
    return { vad: vadReady ? vad : undefined };
}
//# sourceMappingURL=prepare.js.map