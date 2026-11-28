/**
 * The GPU model set: four providers that differ only in model size and weight precision.
 *
 * Everything here was measured on this machine against the 212 s professional-terms recording, so
 * `requiredBytes` is the resident GPU footprint at the 300 s recording ceiling rather than a guess
 * derived from the download size. The audio tower (`mmproj`) runs on the CPU, so it counts against
 * `expectedMemoryBytes` and not against the GPU budget.
 */
/** Weight precision of one GPU model. */
export type GpuQuant = 'bf16' | 'q8_0';
/** One selectable GPU recognizer. */
export interface GpuModelSpec {
    /** Provider id, also the directory the files are installed under. */
    readonly id: string;
    /** Shown in the settings list. */
    readonly label: string;
    /** Published archive holding the model and its audio tower. */
    readonly archive: string;
    /** Text model file name inside the archive. */
    readonly modelFile: string;
    /** Audio tower file name inside the archive. */
    readonly mmprojFile: string;
    /**
     * GPU bytes the weights, KV cache and compute buffers need at the 300 s ceiling.
     *
     * Measured, not estimated: a 65536-token default context inflated the 1.7B model to 13 GB until
     * the context was capped, which is why this number is tied to {@link CONTEXT_LONG}.
     */
    readonly requiredBytes: number;
    /** Bytes the plugin reports as expected resident memory: GPU plus the CPU-side audio tower. */
    readonly expectedMemoryBytes: number;
    /** Bytes on disk once installed. */
    readonly recommendedDiskBytes: number;
}
/**
 * Context the runtime is given.
 *
 * Measured: 300 s of audio needs 8192 and nothing more, so a recording under two minutes is served
 * with half the KV cache. These are the only two values the plugin ever passes.
 */
export declare const CONTEXT_SHORT = 4096;
/** Context for a recording longer than the short threshold. */
export declare const CONTEXT_LONG = 8192;
/** Recording length at or below which {@link CONTEXT_SHORT} is enough. */
export declare const SHORT_RECORDING_SECONDS = 120;
/** The four GPU providers, largest and most precise first. */
export declare const GPU_MODELS: readonly GpuModelSpec[];
/**
 * Pick the context for a recording.
 * @param audioSeconds - decoded recording length.
 * @returns the context size handed to the runtime.
 */
export declare function contextFor(audioSeconds: number): number;
/**
 * Which models a GPU with this much memory can run.
 *
 * The list is offered whole rather than auto-reduced to one entry: measured Q8_0 output matched
 * BF16 character for character, so the choice is the user's, and a machine that can hold a model
 * sees it.
 * @param availableBytes - total GPU memory reported by the driver.
 * @returns the runnable specs, largest first.
 */
export declare function runnableGpuModels(availableBytes: number): readonly GpuModelSpec[];
