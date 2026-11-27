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
/** Wrap the speech service so a hard lock rejects selections outside the whitelist. */
function installHardLock(runtime, lock) {
    const speech = runtime.speechToText;
    const allowed = new Set(lock.allow);
    const originalConfigure = speech.configure;
    const originalResolve = speech.resolve;
    const configure = async (patch) => {
        if (patch.providerId !== undefined && !allowed.has(patch.providerId)) {
            throw new Error(`speech-multi provider is locked; ${patch.providerId} is not in the whitelist`);
        }
        await originalConfigure.call(speech, patch);
    };
    const resolve = (request) => originalResolve.call(speech, { ...request, providerId: lock.modelId });
    try {
        speech.configure = configure;
        speech.resolve = resolve;
    }
    catch (error) {
        runtime.logger.warn('speech-multi hard lock is unavailable; falling back to soft lock', error);
        return () => { };
    }
    return () => {
        if (speech.configure === configure)
            speech.configure = originalConfigure;
        if (speech.resolve === resolve)
            speech.resolve = originalResolve;
    };
}
/**
 * Install a soft or hard lock.
 *
 * Soft mode reasserts the target at startup and whenever the catalog changes; hard mode also
 * rejects selections outside the whitelist and forces `resolve` to the target.
 * @param runtime - speech service and logger.
 * @param lock - validated lock.
 * @returns disposer stopping the observer and restoring the wrappers.
 */
export function installLock(runtime, lock) {
    const target = lock.modelId;
    const restore = lock.mode === 'hard' ? installHardLock(runtime, lock) : () => { };
    let disposed = false;
    let inFlight = false;
    let rerun = false;
    const enforce = () => {
        if (disposed)
            return;
        if (inFlight) {
            rerun = true;
            return;
        }
        let current;
        try {
            current = runtime.speechToText.snapshot().selection.providerId;
        }
        catch (error) {
            runtime.logger.warn('speech-multi lock could not read the current selection', error);
            return;
        }
        if (current === target)
            return;
        inFlight = true;
        void runtime.speechToText.configure({ providerId: target })
            .catch((error) => {
            if (!disposed)
                runtime.logger.warn(`speech-multi lock could not select ${target}`, error);
        })
            .finally(() => {
            inFlight = false;
            if (rerun && !disposed) {
                rerun = false;
                enforce();
            }
        });
    };
    const controller = new AbortController();
    const watch = async () => {
        try {
            for await (const snapshot of runtime.speechToText.follow(controller.signal)) {
                if (snapshot.selection.providerId !== target)
                    enforce();
            }
        }
        catch (error) {
            if (!disposed && !controller.signal.aborted) {
                runtime.logger.warn('speech-multi lock lost the speech catalog', error);
            }
        }
    };
    void watch();
    enforce();
    return () => {
        disposed = true;
        controller.abort();
        restore();
    };
}
//# sourceMappingURL=lock.js.map