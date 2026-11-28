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
     * Run the whole preparation task.
     * @param signal - cancellation.
     */
    private install;
    /**
     * Replace the published state and wake listeners.
     * @param state - the new state; omitted steps are derived from the previous ones.
     */
    private publish;
}
