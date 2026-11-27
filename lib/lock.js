/**
 * Selection lock backed by a JSON file outside the profile.
 *
 * The file is user-managed and read-only for this plugin: never created, written, watched, or
 * locked. Every read, decode or parse failure degrades to "unlocked" so a malformed file can
 * never stop the plugin from starting.
 *
 * Schema 2 adds a whitelist. `allow` defaults to every model this plugin registers, so a lock
 * without an explicit list permits switching among the plugin's own models; narrowing the list
 * by hand is what restricts it further.
 */
import { readFileSync } from 'node:fs';
import { TextDecoder } from 'node:util';
import { isModelId, modelIds } from "./catalog.js";
/**
 * Decode a lock file that Windows editors may have written as UTF-16.
 * @param bytes - complete file contents.
 * @returns decoded text.
 */
function decodeLock(bytes) {
    const [first, second] = bytes;
    if (first === 0xff && second === 0xfe)
        return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (first === 0xfe && second === 0xff) {
        const swapped = Buffer.from(bytes.subarray(2));
        swapped.swap16();
        return new TextDecoder('utf-16le').decode(swapped);
    }
    return new TextDecoder('utf-8').decode(bytes);
}
/**
 * Validate already-parsed lock contents.
 * @param value - parsed JSON value.
 * @param allowed - model ids this plugin registers.
 * @returns the validated lock, or undefined when the shape is not usable.
 */
export function parseLock(value, allowed = modelIds()) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return undefined;
    const record = value;
    if (record.schema !== 2)
        return undefined;
    const mode = record.mode ?? 'soft';
    if (mode !== 'soft' && mode !== 'hard')
        return undefined;
    const target = record.modelId;
    if (typeof target !== 'string' || !isModelId(target) || !allowed.includes(target))
        return undefined;
    const declared = record.allow;
    const whitelist = declared === undefined
        ? [...allowed]
        : allowed.filter((id) => Array.isArray(declared) && declared.includes(id));
    if (!whitelist.includes(target))
        whitelist.unshift(target);
    return { schema: 2, mode, modelId: target, allow: whitelist };
}
/**
 * Read the optional lock file. Absence means unlocked; every failure is logged once and treated
 * as unlocked.
 * @param path - absolute lock-file path.
 * @param logger - host logger.
 * @param allowed - model ids this plugin registers.
 * @returns the validated lock, or undefined.
 */
export function readLock(path, logger, allowed = modelIds()) {
    let bytes;
    try {
        bytes = readFileSync(path);
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            logger.warn(`speech-multi lock file could not be read: ${path}`, error);
        }
        return undefined;
    }
    try {
        const text = decodeLock(bytes).replace(/^\uFEFF/u, '').trim();
        const lock = parseLock(JSON.parse(text), allowed);
        if (lock === undefined)
            logger.warn(`speech-multi lock file is not usable: ${path}`);
        return lock;
    }
    catch (error) {
        logger.warn(`speech-multi lock file is not valid JSON: ${path}`, error);
        return undefined;
    }
}
/**
 * Apply the lock by intercepting reads, never by changing the selection.
 *
 * The obvious implementation — reassert the target through `configure()` — looks harmless but
 * persists: `configure()` reaches the settings service, which writes the value into the
 * profile's `cordis.patch.yml`. A lock that does that survives its own plugin's uninstall and
 * leaves the profile pointing at a provider that no longer exists, which disables speech
 * entirely. Reporting the target from `snapshot()` and forcing it in `resolve()` gives the same
 * user-visible behaviour with no disk write, so removing the plugin restores the previous
 * selection.
 * @param runtime - speech service and logger.
 * @param lock - validated lock.
 * @returns disposer restoring every intercepted method.
 */
export function installLock(runtime, lock) {
    const speech = runtime.speechToText;
    const target = lock.modelId;
    const allowed = new Set(lock.allow);
    const originalSnapshot = speech.snapshot;
    const originalConfigure = speech.configure;
    const originalResolve = speech.resolve;
    const snapshot = () => {
        const current = originalSnapshot.call(speech);
        if (current.selection.providerId === target)
            return current;
        return { ...current, selection: { ...current.selection, providerId: target } };
    };
    const resolve = (request) => originalResolve.call(speech, { ...request, providerId: target });
    const configure = lock.mode === 'hard'
        ? async (patch) => {
            if (patch.providerId !== undefined && !allowed.has(patch.providerId)) {
                throw new Error(`speech-multi provider is locked; ${patch.providerId} is not in the whitelist`);
            }
            await originalConfigure.call(speech, patch);
        }
        : undefined;
    try {
        speech.snapshot = snapshot;
        speech.resolve = resolve;
        if (configure !== undefined)
            speech.configure = configure;
    }
    catch (error) {
        runtime.logger.warn('speech-multi lock could not intercept the speech service', error);
        if (speech.snapshot === snapshot)
            speech.snapshot = originalSnapshot;
        if (speech.resolve === resolve)
            speech.resolve = originalResolve;
        if (configure !== undefined && speech.configure === configure)
            speech.configure = originalConfigure;
        return () => { };
    }
    return () => {
        if (speech.snapshot === snapshot)
            speech.snapshot = originalSnapshot;
        if (speech.resolve === resolve)
            speech.resolve = originalResolve;
        if (configure !== undefined && speech.configure === configure)
            speech.configure = originalConfigure;
    };
}
//# sourceMappingURL=lock.js.map