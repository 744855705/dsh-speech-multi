/**
 * The GPU providers: one per model and precision, all driven through the same llama.cpp binary.
 *
 * There is no worker process here, unlike the CPU providers. The runtime is a batch tool that loads
 * the model, answers, and exits, so a request is one child process and there is nothing to keep warm
 * or reclaim; the preparation phase is what costs time, because it compiles the runtime once.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SpeechPreparation, SpeechPreparationOptions, SpeechPreparationState, SpeechProviderInfo, SpeechInput, Transcript } from '@deepseek-ai/dsh-experimental-speech-to-text/types';
import type { Config } from '../config.ts';
import type { GpuDevice } from './backend.ts';
import type { GpuModelSpec } from './spec.ts';
import type { AssetManifest } from '../runtime/assets.ts';
/**
 * Turn the two concurrent jobs into one preparation state.
 *
 * The page has a single progress line, so the download owns it whenever bytes are moving; the build
 * only takes over once nothing is left to download. Publishing the build first would mark the model
 * step complete before the model had been fetched, which reads as "loaded" while the download has
 * not started.
 * @param download - the transfer in flight, if any.
 * @param buildStartedAt - when the build began, for the spinner.
 * @returns the state to publish.
 */
export declare function progressState(download: {
    readonly resource: string;
    readonly completedBytes: number;
    readonly totalBytes?: number | undefined;
} | undefined, buildStartedAt: number): SpeechPreparationState;
/** Info the settings page renders for one GPU model. */
export declare function gpuProviderInfo(spec: GpuModelSpec): SpeechProviderInfo;
/** One GPU-backed recognizer. */
export declare class GpuProvider implements SpeechPreparation {
    private readonly ctx;
    private readonly config;
    readonly spec: GpuModelSpec;
    readonly device: GpuDevice;
    private readonly manifest;
    private state;
    private readonly listeners;
    private binary;
    private files;
    /** Download in flight, so the page can show bytes while the build runs beside it. */
    private download;
    /** When the current build phase started, for the spinning indicator. */
    private buildStartedAt;
    private running;
    constructor(ctx: Context, config: Config, spec: GpuModelSpec, device: GpuDevice, manifest: AssetManifest);
    /** @returns the current Host-owned preparation state. */
    snapshot(): SpeechPreparationState;
    /** @param listener - invalidation callback. @returns its disposer. */
    subscribe(listener: () => void): () => void;
    /**
     * Report whether everything the provider needs is already on disk.
     *
     * Nothing is downloaded or compiled here: a provider that needs work stays `unprepared` until the
     * user asks for it, exactly like the CPU providers.
     */
    inspect(): void;
    /**
     * Build the runtime and fetch the model.
     * @param _options - task-local download selection; a GPU model has a single fixed source.
     */
    prepare(_options?: SpeechPreparationOptions): void;
    /** Cancel preparation and wait for the runtime to settle. */
    cancel(): Promise<void>;
    /**
     * Transcribe one recording on the GPU.
     * @param input - WAV bytes and language hint.
     * @param signal - caller cancellation.
     * @returns the transcript.
     * @throws when the provider is not prepared, or the runtime rejects the audio.
     */
    transcribe(input: SpeechInput, signal: AbortSignal): Promise<Transcript>;
    /**
     * Transcribe through the resident server, falling back to the batch CLI.
     *
     * The server keeps the weights loaded, so consecutive recordings pay only for the decode. If it
     * cannot start — no room on the device, a runtime that rejects the flags — the batch path still
     * produces a transcript instead of failing the invitation.
     * @param binary - runtime binary.
     * @param files - model and audio tower.
     * @param input - recording.
     * @param audioSeconds - decoded length.
     * @param signal - caller cancellation.
     * @returns the transcript and how long it took.
     */
    private run;
    /**
     * Re-check the disk when the shared runtime becomes available.
     *
     * Called through {@link onRuntimeAvailable}: the runtime is shared by every GPU model, so the
     * provider that prepared first also finished the work for the others.
     */
    refresh(): void;
    /**
     * Run the whole preparation task.
     * @param signal - cancellation.
     */
    /**
     * Build the runtime and fetch the model, both at once.
     *
     * The two jobs touch different files and neither needs the other, so running them in sequence
     * would add the download to the end of a build that already takes minutes. Whatever has byte
     * progress is what the page shows; when only the build is left it reports a spinning step instead
     * of a download sitting at zero.
     * @param signal - cancellation.
     */
    private install;
    /** Report whichever job has something to say right now. */
    private report;
    /**
     * Replace the published state and wake listeners.
     * @param state - the new state; omitted steps are derived from the previous ones.
     */
    private publish;
}
