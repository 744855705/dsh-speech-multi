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
    follow(caller: AbortSignal): AsyncIterable<{
        selection: {
            providerId: string;
        };
    }>;
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
 * Install a soft or hard lock.
 *
 * Soft mode reasserts the target at startup and whenever the catalog changes; hard mode also
 * rejects selections outside the whitelist and forces `resolve` to the target.
 * @param runtime - speech service and logger.
 * @param lock - validated lock.
 * @returns disposer stopping the observer and restoring the wrappers.
 */
export declare function installLock(runtime: LockRuntime, lock: ProviderLock): () => void;
