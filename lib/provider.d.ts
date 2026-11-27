import type { Context } from '@deepseek-ai/cordis';
import type { SpeechPreparation, SpeechPreparationOptions, SpeechPreparationState, SpeechProviderInfo, SpeechInput, Transcript } from '@deepseek-ai/dsh-experimental-speech-to-text/types';
import type { ModelDescriptor } from './catalog.ts';
import type { Config } from './config.ts';
import type { AssetManifest } from './runtime/assets.ts';
/** Facts shared by every provider of one plugin instance. */
export interface SharedRuntime {
    readonly manifest: AssetManifest;
    readonly deviceTier: string;
    readonly maxRecordingSeconds: number;
}
/** Build the `info` block a provider registers. */
export declare function providerInfo(model: ModelDescriptor): SpeechProviderInfo;
/** One recognizer provider. */
export declare class ModelProvider implements SpeechPreparation {
    private readonly ctx;
    private readonly config;
    readonly model: ModelDescriptor;
    private readonly shared;
    private worker;
    private tail;
    private pending;
    private readonly lifetime;
    private idle;
    private root;
    private assets;
    private state;
    private readonly listeners;
    private preparing;
    private lastProgressAt;
    private failures;
    constructor(ctx: Context, config: Config, model: ModelDescriptor, shared: SharedRuntime);
    /** @returns the current Host-owned preparation state. */
    snapshot(): SpeechPreparationState;
    /** @param listener - invalidation callback. @returns its disposer. */
    subscribe(listener: () => void): () => void;
    /** Number of transcripts this model rejected; exposed for diagnostics. */
    get rejected(): number;
    private publish;
    /**
     * Install the model archive and the shared assets, reporting progress as it goes.
     * @param signal - cancellation and deadline.
     * @param onProgress - progress sink for the download state.
     * @returns the model directory and the shared asset paths.
     */
    private install;
    /** Inspect the cache at activation; a complete model enters standby without starting a worker. */
    /**
     * Probe the cache at activation. This must never download: activation happens as soon as the
     * plugin loads, so a probe that fetched missing files would pull every registered model the
     * first time the settings page opened, before the user asked for any of them.
     */
    inspect(): void;
    /** Start or join preparation. */
    prepare(options?: SpeechPreparationOptions): void;
    private runPreparation;
    /** Cancel unfinished preparation; completed readiness is retained. */
    cancel(): Promise<void>;
    /**
     * Decode one recording.
     * @param input - WAV bytes and language hint.
     * @param signal - caller cancellation.
     * @returns the transcript, or a rejection when the result fails inspection.
     */
    transcribe(input: SpeechInput, signal: AbortSignal): Promise<Transcript>;
    private enqueue;
    /**
     * Make sure the shared archives are on disk, degrading instead of failing the recording.
     * @param signal - preparation deadline.
     * @returns the shared paths; an entry stays undefined when its archive is unavailable.
     */
    private refreshShared;
    private start;
    /** Read the single readiness line, bounded and deadline-guarded. */
    private readPort;
    private execute;
    /** Read a bounded JSON reply and surface worker-side rejections as caller errors. */
    private readReply;
    private stop;
    /** Stop the worker and settle every accepted job. */
    dispose(): Promise<void>;
}
