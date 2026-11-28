/** Deployment configuration for the four local recognizers. */
import { cpus, homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { modelIds } from "./catalog.js";
import { MAX_TIMER_DELAY_MS } from "./deadline.js";
/** Release that serves the archives listed in `runtime/assets.json`. */
export const DEFAULT_RELEASE_BASE_URL = 'https://github.com/744855705/dsh-speech-multi/releases/download/models-v1';
/** Expand a leading `~` against the operating-system home. */
function expandHome(value, home) {
    if (value === '~')
        return home;
    if (value.startsWith('~/') || value.startsWith('~\\'))
        return join(home, value.slice(2));
    return value;
}
/**
 * Resolve the harness home shared by every profile: `$DSH_HOME`, otherwise `~/.dsh`.
 * @param env - environment to read.
 * @param home - operating-system home.
 * @returns the absolute harness home.
 */
export function defaultHarnessHome(env = process.env, home = homedir()) {
    const configured = env.DSH_HOME?.trim();
    return resolve(configured === undefined || configured.length === 0 ? join(home, '.dsh') : expandHome(configured, home));
}
/**
 * Cache root shared by every profile, independent of the profile directory.
 * @param env - environment to read.
 * @param home - operating-system home.
 * @returns the absolute model root.
 */
export function defaultDataRoot(env = process.env, home = homedir()) {
    return join(defaultHarnessHome(env, home), 'speech-to-text', 'multi');
}
/**
 * Lock file outside the profile, so a profile refresh cannot remove it.
 * @param env - environment to read.
 * @param home - operating-system home.
 * @returns the absolute lock-file path.
 */
export function defaultLockFile(env = process.env, home = homedir()) {
    return join(defaultHarnessHome(env, home), 'speech-multi-lock.json');
}
const DEFAULT_MODELS = [...modelIds()];
/** Schema validated at plugin activation. */
export const Config = z.object({
    enabledModels: z.array(z.string().min(1)).default(DEFAULT_MODELS),
    dataRoot: z.string().min(1).default(defaultDataRoot()),
    releaseBaseUrl: z.string().min(1).default(DEFAULT_RELEASE_BASE_URL),
    lockFile: z.string().min(1).default(defaultLockFile()),
    deviceTier: z.union([z.const('auto'), z.const('light'), z.const('standard'), z.const('large')]).default('auto'),
    threads: z.natural().min(1).default(8),
    /** Extra hotwords appended to the built-in developer vocabulary. */
    hotwords: z.array(z.string().min(1)).default([]),
    /** Turns the whole hotword list off, keeping the configuration intact. */
    hotwordsEnabled: z.boolean().default(true),
    /**
     * Families that receive the hotword list. Only Fun-ASR reads them as a prompt; X-ASR would
     * have to switch to beam search to use them, which measured worse than greedy on dictation.
     */
    hotwordsModels: z.array(z.string().min(1)).default(['funasr']),
    vadThreshold: z.number().min(0).max(1).default(0.5),
    minSilenceSeconds: z.number().min(0.01).default(0.8),
    minSpeechSeconds: z.number().min(0).default(0.1),
    maxSpeechSeconds: z.number().min(1).max(120).default(29.45),
    maxRecordingSeconds: z.union([z.natural().min(10), z.const(undefined)]),
    maxAudioBytes: z.natural().min(46).default(16 * 1024 * 1024),
    prepareTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(3_600_000),
    inferenceTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(600_000),
    idleTimeoutMs: z.natural().max(MAX_TIMER_DELAY_MS).default(14_400_000),
    maxPending: z.natural().min(1).default(2),
    graceMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(1000),
    maxLogBytes: z.natural().min(1).default(64 * 1024),
    maxResponseBytes: z.natural().min(1).default(256 * 1024),
    progressIntervalMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(150),
    downloadSegments: z.natural().min(1).max(16).default(8),
    buildJobs: z.natural().min(1).max(64).default(cpus().length),
    gpuEnabled: z.boolean().default(true),
    gpuLocalRoot: z.union([z.string().min(1), z.const(undefined)]),
    gpuBinary: z.union([z.string().min(1), z.const(undefined)]),
    gpuBackend: z.union([z.const('hip'), z.const('cuda'), z.const('vulkan'), z.const(undefined)]),
});
/**
 * Validate deployment-varying choices before registration.
 * @param config - schema-validated configuration.
 * @throws when a path is relative, a model id is unknown, or the release URL is unusable.
 */
export function validateConfig(config) {
    for (const path of [config.dataRoot, config.lockFile]) {
        if (!isAbsolute(path))
            throw new Error(`speech-multi paths must be absolute: ${path}`);
    }
    const known = new Set(modelIds());
    for (const id of config.enabledModels) {
        if (!known.has(id))
            throw new Error(`speech-multi does not register ${id}`);
    }
    if (config.enabledModels.length === 0)
        throw new Error('speech-multi requires at least one model');
    let url;
    try {
        url = new URL(config.releaseBaseUrl);
    }
    catch (error) {
        throw new Error('speech-multi releaseBaseUrl is not a valid URL', { cause: error });
    }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
        throw new Error('speech-multi releaseBaseUrl must be HTTPS without credentials');
    }
}
/**
 * Narrow the configured ids to real catalog ids.
 * @param ids - configured ids, already validated.
 * @returns the same list typed as model ids.
 */
export function enabledModelIds(ids) {
    return ids.filter((id) => modelIds().includes(id));
}
//# sourceMappingURL=config.js.map