/**
 * The GPU model set: four providers that differ only in model size and weight precision.
 *
 * Everything here was measured on this machine against the 212 s professional-terms recording, so
 * `requiredBytes` is the resident GPU footprint at the 300 s recording ceiling rather than a guess
 * derived from the download size. The audio tower (`mmproj`) runs on the CPU, so it counts against
 * `expectedMemoryBytes` and not against the GPU budget.
 */
/**
 * Context the runtime is given.
 *
 * Measured: 300 s of audio needs 8192 and nothing more, so a recording under two minutes is served
 * with half the KV cache. These are the only two values the plugin ever passes.
 */
export const CONTEXT_SHORT = 4096;
/** Context for a recording longer than the short threshold. */
export const CONTEXT_LONG = 8192;
/** Recording length at or below which {@link CONTEXT_SHORT} is enough. */
export const SHORT_RECORDING_SECONDS = 120;
/** The four GPU providers, largest and most precise first. */
export const GPU_MODELS = [
    {
        id: 'multi-gpu-qwen3-1.7b-bf16',
        label: 'Qwen3-ASR 1.7B BF16 (GPU)',
        archive: 'qwen3-asr-1.7b-bf16.tar.zst',
        modelFile: 'Qwen3-ASR-1.7B-BF16.gguf',
        mmprojFile: 'mmproj-Qwen3-ASR-1.7B-BF16.gguf',
        requiredBytes: 4_630_000_000,
        expectedMemoryBytes: 5_200_000_000,
        recommendedDiskBytes: 4_710_000_000,
    },
    {
        id: 'multi-gpu-qwen3-1.7b-q8',
        label: 'Qwen3-ASR 1.7B Q8_0 (GPU)',
        archive: 'qwen3-asr-1.7b-q8_0.tar.zst',
        modelFile: 'Qwen3-ASR-1.7B-Q8_0.gguf',
        mmprojFile: 'mmproj-Qwen3-ASR-1.7B-Q8_0.gguf',
        requiredBytes: 3_120_000_000,
        expectedMemoryBytes: 3_500_000_000,
        recommendedDiskBytes: 2_520_000_000,
    },
    {
        id: 'multi-gpu-qwen3-06b-bf16',
        label: 'Qwen3-ASR 0.6B BF16 (GPU)',
        archive: 'qwen3-asr-06b-bf16.tar.zst',
        modelFile: 'Qwen3-ASR-0.6B-BF16.gguf',
        mmprojFile: 'mmproj-Qwen3-ASR-0.6B-BF16.gguf',
        requiredBytes: 2_530_000_000,
        expectedMemoryBytes: 2_850_000_000,
        recommendedDiskBytes: 1_890_000_000,
    },
    {
        id: 'multi-gpu-qwen3-06b-q8',
        label: 'Qwen3-ASR 0.6B Q8_0 (GPU)',
        archive: 'qwen3-asr-06b-q8_0.tar.zst',
        modelFile: 'Qwen3-ASR-0.6B-Q8_0.gguf',
        mmprojFile: 'mmproj-Qwen3-ASR-0.6B-Q8_0.gguf',
        requiredBytes: 2_010_000_000,
        expectedMemoryBytes: 2_200_000_000,
        recommendedDiskBytes: 1_020_000_000,
    },
];
/**
 * Pick the context for a recording.
 * @param audioSeconds - decoded recording length.
 * @returns the context size handed to the runtime.
 */
export function contextFor(audioSeconds) {
    return audioSeconds <= SHORT_RECORDING_SECONDS ? CONTEXT_SHORT : CONTEXT_LONG;
}
/**
 * Which models a GPU with this much memory can run.
 *
 * The list is offered whole rather than auto-reduced to one entry: measured Q8_0 output matched
 * BF16 character for character, so the choice is the user's, and a machine that can hold a model
 * sees it.
 * @param availableBytes - total GPU memory reported by the driver.
 * @returns the runnable specs, largest first.
 */
export function runnableGpuModels(availableBytes) {
    return GPU_MODELS.filter((spec) => spec.requiredBytes <= availableBytes);
}
//# sourceMappingURL=spec.js.map