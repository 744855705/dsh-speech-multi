/** Model acquisition: inspect what is on disk, then download, verify and expand what is missing. */
import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { archiveUrl, assetFor } from "./assets.js";
import { downloadArchive } from "./download.js";
import { extractTarZst } from "./tar.js";
/** Archive holding assets shared by every model: the Silero VAD and the punctuation model. */
export const SHARED_ARCHIVE = 'punctuation.tar.zst';
/** File whose presence proves the shared archive finished expanding. */
const SHARED_MARKER = join('vad', 'silero_vad.onnx');
/** File whose presence proves an expansion finished, keyed by family. */
const MARKERS = {
    xasr: 'tokens.txt',
    funasr: 'llm.int8.onnx',
    qwen3: 'encoder.int8.onnx',
    firered: 'tokens.txt',
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
        await access(join(dataRoot, SHARED_MARKER));
        return true;
    }
    catch {
        return false;
    }
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
        await downloadArchive(archiveUrl(input.baseUrl, input.model.archive), cached, record, {
            signal: input.signal,
            progressIntervalMs: input.progressIntervalMs,
            ...input.onProgress === undefined ? {} : { onProgress: input.onProgress },
        });
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
 * Make the shared archive available: Silero VAD for every model, punctuation for the one model
 * that does not punctuate itself.
 * @param input - locations, manifest and cancellation.
 * @returns the resolved shared paths; `vad` stays undefined when the archive is not published.
 */
export async function ensureShared(input) {
    const vad = join(input.dataRoot, SHARED_MARKER);
    const punctuation = join(input.dataRoot, 'punctuation', 'fireredpunc');
    if (await isSharedInstalled(input.dataRoot))
        return { vad, punctuation };
    const record = input.manifest.files[SHARED_ARCHIVE];
    if (record === undefined)
        return { vad: undefined, punctuation: undefined };
    const cached = join(input.dataRoot, '.cache', SHARED_ARCHIVE);
    await mkdir(join(input.dataRoot, '.cache'), { recursive: true });
    if (!(await isSharedInstalled(input.dataRoot))) {
        await downloadArchive(archiveUrl(input.baseUrl, SHARED_ARCHIVE), cached, record, {
            signal: input.signal,
            progressIntervalMs: input.progressIntervalMs,
            ...input.onProgress === undefined ? {} : { onProgress: input.onProgress },
        });
        await extractTarZst(cached, input.dataRoot);
    }
    const installed = await isSharedInstalled(input.dataRoot);
    return { vad: installed ? vad : undefined, punctuation: installed ? punctuation : undefined };
}
//# sourceMappingURL=prepare.js.map