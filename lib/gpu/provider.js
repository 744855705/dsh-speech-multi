import { decodeWave } from "../runtime/wav.js";
import { checkTranscript, trimShortTrailingMarks } from "../health.js";
import { LLAMA_SOURCE_ARCHIVE, ensureLlamaBinary } from "./build.js";
import { resolveGpuFiles } from "./files.js";
import { transcribeWithLlama } from "./run.js";
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
export function progressState(download, buildStartedAt) {
    if (download !== undefined) {
        return {
            phase: 'downloading',
            resource: download.resource,
            completedBytes: download.completedBytes,
            ...download.totalBytes === undefined ? {} : { totalBytes: download.totalBytes },
            step: 'model',
        };
    }
    return { phase: 'loading', startedAt: buildStartedAt, step: 'load' };
}
/** Longest recording a GPU provider accepts when the tier sets no ceiling. */
const LONGEST_RECORDING_SECONDS = 300;
/** Preparation steps shown while the runtime is built and the model fetched. */
const STEP_KINDS = ['check', 'model', 'verify', 'load'];
/** Info the settings page renders for one GPU model. */
export function gpuProviderInfo(spec) {
    return {
        id: spec.id,
        name: spec.label,
        location: 'host-local',
        languages: ['auto', 'zh', 'en'],
        setupEstimate: {
            recommendedDiskBytes: spec.recommendedDiskBytes,
            expectedMemoryBytes: spec.expectedMemoryBytes,
            minimumMinutes: 5,
            maximumMinutes: 40,
        },
    };
}
/** One GPU-backed recognizer. */
export class GpuProvider {
    ctx;
    config;
    spec;
    device;
    manifest;
    state;
    listeners = new Set();
    binary;
    files;
    /** Download in flight, so the page can show bytes while the build runs beside it. */
    download;
    /** When the current build phase started, for the spinning indicator. */
    buildStartedAt = Date.now();
    running;
    constructor(ctx, config, spec, device, manifest) {
        this.ctx = ctx;
        this.config = config;
        this.spec = spec;
        this.device = device;
        this.manifest = manifest;
        this.state = { phase: 'unprepared', steps: STEP_KINDS.map((kind) => ({ kind, status: 'pending' })) };
    }
    /** @returns the current Host-owned preparation state. */
    snapshot() {
        return this.state;
    }
    /** @param listener - invalidation callback. @returns its disposer. */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    /**
     * Report whether everything the provider needs is already on disk.
     *
     * Nothing is downloaded or compiled here: a provider that needs work stays `unprepared` until the
     * user asks for it, exactly like the CPU providers.
     */
    inspect() {
        if (this.running !== undefined)
            return;
        this.publish({
            phase: 'unprepared',
            steps: (this.state.steps ?? []).map(({ kind }) => ({ kind, status: kind === 'check' ? 'complete' : 'pending' })),
        });
    }
    /**
     * Build the runtime and fetch the model.
     * @param _options - task-local download selection; a GPU model has a single fixed source.
     */
    prepare(_options) {
        if (this.running !== undefined)
            return;
        const abort = new AbortController();
        const task = this.install(abort.signal).finally(() => {
            this.running = undefined;
        });
        this.running = { abort, task };
    }
    /** Cancel preparation and wait for the runtime to settle. */
    async cancel() {
        this.running?.abort.abort();
        await this.running?.task.catch(() => { });
        this.running = undefined;
        if (this.state.phase === 'downloading' || this.state.phase === 'loading') {
            this.publish({ phase: 'cancelled' });
        }
    }
    /**
     * Transcribe one recording on the GPU.
     * @param input - WAV bytes and language hint.
     * @param signal - caller cancellation.
     * @returns the transcript.
     * @throws when the provider is not prepared, or the runtime rejects the audio.
     */
    async transcribe(input, signal) {
        const binary = this.binary;
        const files = this.files;
        if (binary === undefined || files === undefined) {
            throw new Error(`speech-multi provider ${this.spec.id} is not prepared`);
        }
        const wave = decodeWave(input.audio);
        const ceiling = this.config.maxRecordingSeconds ?? LONGEST_RECORDING_SECONDS;
        if (wave.seconds > ceiling) {
            throw new Error(`speech-multi accepts at most ${ceiling}s; got ${wave.seconds.toFixed(1)}s`);
        }
        const result = await transcribeWithLlama({
            binary,
            files,
            audio: input.audio,
            audioSeconds: wave.seconds,
            threads: this.config.threads,
            signal,
        });
        const verdict = checkTranscript({
            text: result.text,
            audioSeconds: wave.seconds,
            speechSeconds: wave.seconds,
        });
        if (!verdict.ok) {
            this.ctx.logger.warn(`speech-multi gpu ${this.spec.id} rejected a transcript: ${verdict.detail}`);
        }
        // The same short-utterance rule the CPU providers apply: a fragment of a few characters reads
        // better without the sentence mark the model appended.
        return { text: trimShortTrailingMarks(result.text), audioSeconds: wave.seconds, inferenceSeconds: result.inferenceSeconds };
    }
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
    async install(signal) {
        try {
            this.publish({ phase: 'loading', startedAt: Date.now(), step: 'check' });
            const build = ensureLlamaBinary({
                config: this.config,
                manifest: this.manifest,
                backend: this.device.backend,
                signal,
                onStep: (step) => {
                    if (step === 'download')
                        this.download = { resource: LLAMA_SOURCE_ARCHIVE, completedBytes: 0 };
                    this.report();
                },
            });
            const files = resolveGpuFiles({
                spec: this.spec,
                config: this.config,
                manifest: this.manifest,
                signal,
                onProgress: (progress) => {
                    this.download = { resource: this.spec.archive, completedBytes: progress.completedBytes, ...progress.totalBytes === undefined ? {} : { totalBytes: progress.totalBytes } };
                    this.report();
                },
            });
            const [binary, paths] = await Promise.all([build, files]);
            this.binary = binary;
            this.files = paths;
            this.download = undefined;
            this.publish({ phase: 'ready' });
            this.ctx.logger.info(`speech-multi gpu ${this.spec.id} ready on ${this.device.backend} (${this.device.name})`);
        }
        catch (error) {
            if (signal.aborted) {
                this.publish({ phase: 'cancelled' });
                return;
            }
            this.publish({ phase: 'failed', message: String(error) });
            this.ctx.logger.warn(`speech-multi gpu ${this.spec.id} preparation failed: ${String(error)}`);
        }
    }
    /** Report whichever job has something to say right now. */
    report() {
        this.publish(progressState(this.download, this.buildStartedAt));
    }
    /**
     * Replace the published state and wake listeners.
     * @param state - the new state; omitted steps are derived from the previous ones.
     */
    publish(state) {
        const previous = this.state;
        const steps = state.steps ?? (previous.steps ?? []).map((item) => {
            if (state.phase === 'ready')
                return { ...item, status: 'complete' };
            if (state.step === item.kind) {
                return item.status === 'running' ? item : { kind: item.kind, status: 'running', startedAt: Date.now() };
            }
            if (item.status !== 'running')
                return item;
            if (state.phase === 'cancelled')
                return { ...item, status: 'cancelled' };
            if (state.phase === 'failed')
                return { ...item, status: 'failed' };
            return state.step === undefined ? item : { ...item, status: 'complete' };
        });
        this.state = { ...state, ...steps === undefined ? {} : { steps } };
        for (const listener of this.listeners)
            listener();
    }
}
//# sourceMappingURL=provider.js.map