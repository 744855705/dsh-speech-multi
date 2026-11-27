/**
 * One registered provider: the model's preparation state, its private worker, and its
 * transcription path.
 *
 * Each model owns its own worker process so a crash in one recognizer cannot take the others
 * down, and so the idle reclaimer frees exactly the memory that model used.
 */
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { withDeadline } from "./deadline.js";
import { checkTranscript, sanitize } from "./health.js";
import { ensureModel, ensureShared, isInstalled, isSharedInstalled, modelRoot } from "./runtime/prepare.js";
import { decodeWave } from "./runtime/wav.js";
const replySchema = z.object({
    text: z.string(),
    blocks: z.number().int().nonnegative(),
    audioSeconds: z.number().nonnegative(),
    speechSeconds: z.number().nonnegative(),
    inferenceSeconds: z.number().nonnegative(),
}).strict();
/**
 * Where the shared assets sit once installed.
 * @param dataRoot - model root.
 * @returns the Silero and punctuation paths the preparation step also produces.
 */
function sharedPaths(dataRoot) {
    return {
        vad: join(dataRoot, 'vad', 'silero_vad.onnx'),
        punctuation: join(dataRoot, 'punctuation', 'fireredpunc'),
    };
}
/** Path of the worker entry: TypeScript while running from source, JavaScript once built. */
function workerEntry() {
    const fromSource = import.meta.url.endsWith('.ts');
    const url = new URL(fromSource ? './worker/entry.ts' : './worker/entry.js', import.meta.url);
    return { path: fileURLToPath(url), argv: fromSource ? ['--import', 'tsx/esm'] : [] };
}
/** Build the `info` block a provider registers. */
export function providerInfo(model) {
    return {
        id: model.id,
        name: model.displayName,
        location: 'host-local',
        languages: model.languages,
        setupEstimate: {
            recommendedDiskBytes: model.recommendedDiskBytes,
            expectedMemoryBytes: model.expectedMemoryBytes,
            minimumMinutes: 1,
            maximumMinutes: 20,
        },
    };
}
/** One recognizer provider. */
export class ModelProvider {
    ctx;
    config;
    model;
    shared;
    worker;
    tail = Promise.resolve();
    pending = 0;
    lifetime = new AbortController();
    idle;
    root;
    assets = { vad: undefined, punctuation: undefined };
    state;
    listeners = new Set();
    preparing;
    lastProgressAt = 0;
    failures = 0;
    constructor(ctx, config, model, shared) {
        this.ctx = ctx;
        this.config = config;
        this.model = model;
        this.shared = shared;
        const kinds = ['check', 'model', 'verify', 'load'];
        this.state = { phase: 'unprepared', steps: kinds.map((kind) => ({ kind, status: 'pending' })) };
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
    /** Number of transcripts this model rejected; exposed for diagnostics. */
    get rejected() {
        return this.failures;
    }
    publish(state) {
        if (this.preparing !== undefined && ['ready', 'standby', 'unprepared', 'failed', 'cancelled'].includes(state.phase)) {
            this.preparing.completed = true;
        }
        const previous = this.state;
        const steps = state.steps ?? previous.steps?.map((item) => {
            if (state.phase === 'ready')
                return { ...item, status: 'complete' };
            if (state.step === item.kind) {
                return item.status === 'running' ? item : { kind: item.kind, status: 'running', startedAt: Date.now() };
            }
            if (item.status !== 'running')
                return item;
            if (state.phase === 'standby')
                return { ...item, status: 'cancelled' };
            if (state.phase === 'failed' || state.phase === 'cancelled')
                return { ...item, status: state.phase };
            return state.step === undefined ? item : { ...item, status: 'complete' };
        });
        this.state = { ...state, ...steps === undefined ? {} : { steps } };
        const now = performance.now();
        if (state.phase === 'downloading' && previous.phase === 'downloading'
            && state.completedBytes !== previous.completedBytes
            && now - this.lastProgressAt < this.config.progressIntervalMs)
            return;
        this.lastProgressAt = now;
        for (const listener of this.listeners)
            listener();
    }
    /**
     * Install the model archive and the shared assets, reporting progress as it goes.
     * @param signal - cancellation and deadline.
     * @param onProgress - progress sink for the download state.
     * @returns the model directory and the shared asset paths.
     */
    async install(signal, onProgress) {
        const common = {
            dataRoot: this.config.dataRoot,
            baseUrl: this.config.releaseBaseUrl,
            manifest: this.shared.manifest,
            signal,
            progressIntervalMs: this.config.progressIntervalMs,
            onProgress,
        };
        const root = await ensureModel({ ...common, model: this.model });
        const assets = await ensureShared(common);
        return { root, assets };
    }
    /** Inspect the cache at activation; a complete model enters standby without starting a worker. */
    /**
     * Probe the cache at activation. This must never download: activation happens as soon as the
     * plugin loads, so a probe that fetched missing files would pull every registered model the
     * first time the settings page opened, before the user asked for any of them.
     */
    inspect() {
        this.runPreparation(async (signal) => {
            this.publish({ phase: 'checking', step: 'check', startedAt: Date.now() });
            const root = modelRoot(this.config.dataRoot, this.model);
            const installed = await isInstalled(root, this.model.family);
            signal.throwIfAborted();
            if (!installed) {
                this.root = undefined;
                this.assets = { vad: undefined, punctuation: undefined };
                this.publish({
                    phase: 'unprepared',
                    steps: (this.state.steps ?? []).map(({ kind }) => ({ kind, status: kind === 'check' ? 'complete' : 'pending' })),
                });
                return;
            }
            this.root = root;
            this.assets = (await isSharedInstalled(this.config.dataRoot))
                ? sharedPaths(this.config.dataRoot)
                : { vad: undefined, punctuation: undefined };
            this.publish({
                phase: 'standby',
                steps: (this.state.steps ?? []).map(({ kind }) => ({ kind, status: kind === 'load' ? 'pending' : 'complete' })),
            });
        });
    }
    /** Start or join preparation. */
    prepare(options = {}) {
        if (options.downloadSource !== undefined)
            throw new Error('speech-multi download source is unavailable');
        this.runPreparation(async (signal) => {
            await this.start(signal);
        });
    }
    runPreparation(run) {
        if (this.preparing !== undefined || this.worker !== undefined)
            return;
        this.lifetime.signal.throwIfAborted();
        const abort = new AbortController();
        const task = { abort, settled: Promise.resolve(), completed: false };
        this.preparing = task;
        task.settled = this.enqueue(run, abort.signal)
            .catch((error) => {
            if (this.lifetime.signal.aborted)
                return;
            this.publish(abort.signal.aborted
                ? { phase: 'cancelled' }
                : { phase: 'failed', message: error instanceof Error ? error.message : String(error) });
        })
            .finally(() => {
            this.preparing = undefined;
        });
    }
    /** Cancel unfinished preparation; completed readiness is retained. */
    async cancel() {
        const task = this.preparing;
        if (task === undefined)
            return;
        if (!task.completed) {
            this.publish({ phase: 'cancelling', startedAt: Date.now() });
            task.abort.abort(new Error('speech-multi preparation cancelled'));
        }
        await task.settled;
    }
    /**
     * Decode one recording.
     * @param input - WAV bytes and language hint.
     * @param signal - caller cancellation.
     * @returns the transcript, or a rejection when the result fails inspection.
     */
    async transcribe(input, signal) {
        return await this.enqueue(async (combined) => await this.execute(input, combined), signal);
    }
    async enqueue(run, signal) {
        const combined = AbortSignal.any([signal, this.lifetime.signal]);
        combined.throwIfAborted();
        if (this.pending >= this.config.maxPending)
            throw new Error(`speech-multi queue for ${this.model.id} is full`);
        clearTimeout(this.idle);
        this.pending += 1;
        const job = this.tail.then(async () => {
            combined.throwIfAborted();
            return await run(combined);
        });
        this.tail = job.then(() => undefined, () => undefined).finally(() => {
            this.pending -= 1;
            if (this.pending === 0 && !this.lifetime.signal.aborted && this.config.idleTimeoutMs > 0) {
                this.idle = setTimeout(() => {
                    this.tail = this.tail.then(async () => {
                        await this.stop();
                    });
                    void this.tail.catch((error) => {
                        this.ctx.logger.warn('speech-multi idle cleanup failed', error);
                    });
                }, this.config.idleTimeoutMs);
            }
        });
        return await job;
    }
    async start(signal) {
        if (this.worker?.closed === true)
            await this.stop();
        if (this.worker !== undefined)
            return this.worker;
        const setup = withDeadline(signal, this.config.prepareTimeoutMs);
        const cached = this.root !== undefined;
        if (!cached)
            this.publish({ phase: 'checking', step: 'check', startedAt: Date.now() });
        let root = this.root;
        if (root === undefined) {
            const installed = await this.install(setup, (progress) => {
                this.publish({
                    phase: 'downloading',
                    step: 'model',
                    resource: this.model.archive,
                    completedBytes: progress.completedBytes,
                    ...progress.totalBytes === undefined ? {} : { totalBytes: progress.totalBytes },
                });
            });
            root = installed.root;
            this.assets = installed.assets;
        }
        this.root = root;
        setup.throwIfAborted();
        this.publish({ phase: cached ? 'waking' : 'loading', step: 'load', startedAt: Date.now() });
        await mkdir(this.config.dataRoot, { recursive: true });
        const token = randomBytes(32).toString('hex');
        const entry = workerEntry();
        const handle = this.ctx.subprocess.spawn({
            argv: [
                process.execPath,
                ...entry.argv,
                entry.path,
                JSON.stringify({
                    modelId: this.model.id,
                    family: this.model.family,
                    root,
                    threads: this.config.threads,
                    maxAudioBytes: this.config.maxAudioBytes,
                    chunking: this.model.chunking,
                    ...this.assets.vad === undefined ? {} : { vadModel: this.assets.vad },
                    ...this.assets.punctuation === undefined || !this.config.punctuation
                        ? {} : { punctuationDirectory: this.assets.punctuation },
                    detection: {
                        threshold: this.config.vadThreshold,
                        minSilenceSeconds: this.config.minSilenceSeconds,
                        minSpeechSeconds: this.config.minSpeechSeconds,
                        maxSpeechSeconds: this.config.maxSpeechSeconds,
                    },
                }),
            ],
            cwd: this.config.dataRoot,
            graceMs: this.config.graceMs,
            env: { DSH_SPEECH_TOKEN: token, ELECTRON_RUN_AS_NODE: '1' },
            stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: this.config.maxLogBytes } },
        });
        try {
            const port = await this.readPort(handle, setup);
            const worker = { handle, url: `http://127.0.0.1:${port}`, token, closed: false };
            this.worker = worker;
            this.publish({ phase: 'ready' });
            const exited = () => {
                if (!worker.closed) {
                    worker.closed = true;
                    this.publish({ phase: 'standby' });
                }
            };
            void handle.done.then(exited, exited);
            return worker;
        }
        catch (error) {
            handle.terminate();
            await handle.waitForExit();
            throw error;
        }
    }
    /** Read the single readiness line, bounded and deadline-guarded. */
    async readPort(handle, signal) {
        const stdout = handle.stdout;
        if (stdout == null)
            throw new Error('speech-multi worker stdout is unavailable');
        const limit = this.config.maxLogBytes;
        let text = '';
        const ready = Promise.withResolvers();
        const onData = (chunk) => {
            text += chunk.toString('utf8');
            if (Buffer.byteLength(text) > limit) {
                ready.reject(new Error('speech-multi worker readiness exceeded its byte limit'));
                return;
            }
            const end = text.indexOf('\n');
            if (end < 0)
                return;
            try {
                ready.resolve(z.object({ port: z.number().int().min(1).max(65535) }).strict().parse(JSON.parse(text.slice(0, end))).port);
            }
            catch (error) {
                ready.reject(new Error('invalid speech-multi worker readiness', { cause: error }));
            }
        };
        stdout.on('data', onData);
        stdout.on('error', ready.reject);
        void handle.done.then(() => {
            ready.reject(new Error(`speech-multi worker exited before readiness: ${handle.collected.stderr?.readFrom(0).text ?? ''}`));
        }, ready.reject);
        try {
            const abort = () => {
                ready.reject(signal.reason instanceof Error ? signal.reason : new Error('speech-multi worker startup cancelled'));
            };
            signal.addEventListener('abort', abort, { once: true });
            try {
                return await ready.promise;
            }
            finally {
                signal.removeEventListener('abort', abort);
            }
        }
        finally {
            stdout.off('data', onData);
            stdout.off('error', ready.reject);
            stdout.resume();
        }
    }
    async execute(input, signal) {
        const phase = this.state.phase;
        if (phase !== 'ready' && phase !== 'standby')
            throw new Error(`prepare ${this.model.id} before recording`);
        const wave = decodeWave(input.audio);
        if (wave.seconds > this.shared.maxRecordingSeconds) {
            throw new Error(`speech-multi accepts at most ${this.shared.maxRecordingSeconds}s on this device tier; got ${wave.seconds.toFixed(1)}s`);
        }
        try {
            const worker = await this.start(signal);
            const call = withDeadline(signal, this.config.inferenceTimeoutMs);
            const response = await fetch(`${worker.url}/transcribe`, {
                method: 'POST',
                headers: { authorization: `Bearer ${worker.token}`, 'content-type': 'audio/wav' },
                body: Buffer.from(input.audio),
                signal: call,
            });
            const payload = await this.readReply(response);
            call.throwIfAborted();
            const text = sanitize(payload.text);
            const verdict = checkTranscript({
                text,
                audioSeconds: payload.audioSeconds,
                speechSeconds: payload.speechSeconds,
            });
            if (!verdict.ok) {
                this.failures += 1;
                this.ctx.logger.warn(`speech-multi rejected a ${this.model.id} transcript (${verdict.check}): ${verdict.detail}`);
                throw new Error(`speech-multi rejected the ${this.model.id} transcript (${verdict.check}): ${verdict.detail}`);
            }
            return { text, audioSeconds: payload.audioSeconds, inferenceSeconds: payload.inferenceSeconds };
        }
        catch (error) {
            await this.stop();
            this.publish({ phase: 'standby' });
            throw error;
        }
    }
    /** Read a bounded JSON reply and surface worker-side rejections as caller errors. */
    async readReply(response) {
        if (response.body === null)
            throw new Error('speech-multi worker returned no response');
        const reader = response.body.getReader();
        const chunks = [];
        let length = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                length += value.length;
                if (length > this.config.maxResponseBytes)
                    throw new Error('speech-multi response exceeded its byte limit');
                chunks.push(value);
            }
        }
        finally {
            await reader.cancel();
            reader.releaseLock();
        }
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!response.ok) {
            const failure = z.object({ error: z.string() }).parse(parsed);
            throw new Error(failure.error);
        }
        return replySchema.parse(parsed);
    }
    async stop() {
        const worker = this.worker;
        if (worker === undefined)
            return;
        worker.closed = true;
        worker.handle.terminate();
        await worker.handle.waitForExit();
        this.worker = undefined;
        this.publish({ phase: 'standby' });
    }
    /** Stop the worker and settle every accepted job. */
    async dispose() {
        this.listeners.clear();
        this.lifetime.abort(new Error('speech-multi provider disposed'));
        clearTimeout(this.idle);
        try {
            await this.tail;
        }
        finally {
            await this.stop();
        }
        await this.preparing?.settled;
    }
}
//# sourceMappingURL=provider.js.map