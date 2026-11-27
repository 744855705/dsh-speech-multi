import { type ModelId } from './catalog.ts';
/** Lock behaviour: `soft` reasserts the target, `hard` also blocks other selections. */
export type LockMode = 'soft' | 'hard';
/** Validated lock file. */
export interface ProviderLock {
    readonly schema: 2;
    readonly mode: LockMode;
    /** Model the lock reasserts. */
    readonly modelId: ModelId;
    /** Models a hard lock still allows. */
    readonly allow: readonly ModelId[];
}
/** Minimal logger; `ctx.logger` satisfies it. */
export interface LockLogger {
    warn(message: string, error?: unknown): void;
}
/** The slice of the speech service the lock touches; the real service satisfies it. */
export interface LockSpeechService {
    snapshot(): {
        selection: {
            providerId: string;
        };
    };
    configure(patch: {
        providerId?: string;
    }): Promise<void>;
    resolve(request: {
        providerId?: string;
    }): unknown;
}
/** Host-owned dependencies for the installer. */
export interface LockRuntime {
    readonly speechToText: LockSpeechService;
    readonly logger: LockLogger;
}
/**
 * Validate already-parsed lock contents.
 * @param value - parsed JSON value.
 * @param allowed - model ids this plugin registers.
 * @returns the validated lock, or undefined when the shape is not usable.
 */
export declare function parseLock(value: unknown, allowed?: readonly ModelId[]): ProviderLock | undefined;
/**
 * Read the optional lock file. Absence means unlocked; every failure is logged once and treated
 * as unlocked.
 * @param path - absolute lock-file path.
 * @param logger - host logger.
 * @param allowed - model ids this plugin registers.
 * @returns the validated lock, or undefined.
 */
export declare function readLock(path: string, logger: LockLogger, allowed?: readonly ModelId[]): ProviderLock | undefined;
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
export declare function installLock(runtime: LockRuntime, lock: ProviderLock): () => void;
