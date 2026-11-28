/**
 * Which GPU model is resident, and for how long.
 *
 * Only one model may hold device memory at a time. A card that kept every prepared model loaded
 * would reserve several gigabytes for models nobody is using, and the user asked for the opposite:
 * switching models unloads the old weights at once, and switching to a CPU model stops the GPU
 * runtime entirely.
 *
 * Residency is therefore decided by use rather than by the settings page: whichever provider is
 * asked to transcribe is the one that stays, and the others are stopped before the new one starts.
 */
import type { LlamaServer } from './server.ts';
/** How long a model may sit unused before its memory is released. */
export declare const DEFAULT_IDLE_TIMEOUT_MS: number;
/** A server the registry can stop without knowing which model it belongs to. */
export interface ResidentServer {
    readonly id: string;
    readonly server: LlamaServer;
}
/**
 * Stop whatever holds the card.
 * @param dataRoot - plugin data directory.
 */
export declare function releaseAll(dataRoot: string): Promise<void>;
/**
 * Mark a CPU provider as the one in use.
 *
 * The reported order matters: a CPU model cannot share the device, so the GPU runtime is stopped
 * immediately rather than left to idle out.
 * @param dataRoot - plugin data directory.
 * @returns after the card has been released.
 */
export declare function noteCpuUse(dataRoot: string): Promise<void>;
/**
 * Make one GPU model the resident one.
 *
 * The caller supplies a factory so the registry can stop the previous model before anything new is
 * loaded: starting first would need memory for both, which is exactly the situation this avoids.
 * @param dataRoot - plugin data directory.
 * @param id - provider id of the model being used.
 * @param create - builds the server for that model.
 * @param idleTimeoutMs - how long it may stay unused.
 * @returns the resident server.
 */
export declare function acquireGpu(dataRoot: string, id: string, create: () => LlamaServer, idleTimeoutMs: number): Promise<LlamaServer>;
/**
 * Restart the idle countdown for the model in use.
 * @param dataRoot - plugin data directory.
 * @param idleTimeoutMs - how long it may stay unused.
 */
export declare function touchGpu(dataRoot: string, idleTimeoutMs: number): void;
/**
 * Stop everything this module started.
 * @param dataRoot - plugin data directory, or undefined for all of them.
 */
export declare function shutdownGpu(dataRoot?: string | undefined): Promise<void>;
/**
 * Report the resident model, for tests and diagnostics.
 * @param dataRoot - plugin data directory.
 * @returns the provider id, or undefined when nothing holds the card.
 */
export declare function activeGpu(dataRoot: string): string | undefined;
