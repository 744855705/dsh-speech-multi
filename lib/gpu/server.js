/**
 * A resident llama.cpp server for one GPU model.
 *
 * The batch CLI reloads the weights on every invitation, which costs a second or two each time and
 * showed up as the model paging in and out during dictation. `llama-server` keeps them resident, so
 * a recording only pays for the decode. Measured on this machine: one second to become ready,
 * identical transcripts to the CLI, and no `language Chinese<asr_text>` prefix to strip.
 *
 * One process serves exactly one model, so changing models restarts it rather than reloading.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname } from 'node:path';
import { CONTEXT_LONG } from "./spec.js";
/** Lowest port handed to the server; below this the developer stack lives. */
const MIN_SERVER_PORT = 30_000;
/** Highest port considered. */
const MAX_SERVER_PORT = 60_000;
/** Times to look for a free port before giving up. */
const PORT_ATTEMPTS = 8;
/** How long the server may take to answer its health endpoint. */
const START_TIMEOUT_MS = 120_000;
/** Grace before a shutdown escalates to SIGKILL. */
const STOP_GRACE_MS = 5_000;
/**
 * Ask the kernel for a free loopback port in the high range.
 *
 * Binding port zero lets the kernel pick, but the server needs a number in advance, so a throwaway
 * listener finds one and is closed again. The race that leaves is handled by the start retry.
 * @returns a port at or above {@link MIN_SERVER_PORT}.
 */
async function freePort() {
    for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt += 1) {
        const port = await new Promise((resolve, reject) => {
            const probe = createServer();
            probe.once('error', reject);
            probe.listen(0, '127.0.0.1', () => {
                const address = probe.address();
                probe.close();
                if (address === null || typeof address === 'string') {
                    reject(new Error('speech-multi could not inspect a loopback port'));
                    return;
                }
                resolve(address.port);
            });
        });
        if (port >= MIN_SERVER_PORT && port <= MAX_SERVER_PORT)
            return port;
    }
    throw new Error(`speech-multi could not obtain a loopback port at or above ${MIN_SERVER_PORT}`);
}
/**
 * Wait until the server reports itself healthy.
 *
 * The listener accepts connections well before the weights are on the device: `/health` answers 503
 * while the model loads, so a plain TCP probe would hand a request to a server that cannot serve it.
 * @param port - port to probe.
 * @param deadline - epoch milliseconds after which the wait fails.
 * @returns true when the server answered 200 before the deadline.
 */
async function serverReady(port, deadline) {
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
            await response.text().catch(() => '');
            if (response.ok)
                return true;
        }
        catch {
            // Not accepting yet, or still loading.
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
}
/** One resident model server. */
export class LlamaServer {
    options;
    child;
    portNumber;
    tail = '';
    constructor(options) {
        this.options = options;
    }
    /** @returns the port it listens on, when running. */
    get port() {
        return this.portNumber;
    }
    /** @returns true while the process is alive. */
    get running() {
        return this.child !== undefined && this.child.exitCode === null && this.child.signalCode === null;
    }
    /**
     * Start the server and wait until it accepts requests.
     * @param signal - cancellation.
     * @returns the port it listens on.
     * @throws when the process exits, or never becomes ready.
     */
    async start(signal) {
        if (this.running && this.portNumber !== undefined)
            return this.portNumber;
        signal.throwIfAborted();
        const port = await freePort();
        const child = spawn(this.options.binary, [
            '-m', this.options.files.model,
            '--mmproj', this.options.files.mmproj,
            '--host', '127.0.0.1',
            '--port', String(port),
            '-ngl', '99',
            '-c', String(CONTEXT_LONG),
            '-t', String(this.options.threads),
            '--no-webui',
        ], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                LD_LIBRARY_PATH: [dirname(this.options.binary), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
            },
        });
        this.child = child;
        const exited = new Promise((resolve) => {
            child.once('exit', () => {
                resolve();
            });
        });
        const collect = (chunk) => {
            const text = chunk.toString('utf8');
            this.tail = `${this.tail}${text}`.slice(-2000);
            for (const line of text.split('\n')) {
                if (line.trim().length > 0)
                    this.options.onLog?.(line.trimEnd());
            }
        };
        child.stdout?.on('data', collect);
        child.stderr?.on('data', collect);
        const deadline = Date.now() + START_TIMEOUT_MS;
        const ready = Promise.race([
            serverReady(port, deadline),
            exited.then(() => false),
        ]);
        const ok = await ready;
        if (!ok) {
            const reason = this.tail.trim().split('\n').slice(-3).join(' | ');
            await this.stop();
            throw new Error(`speech-multi llama-server did not become ready: ${reason.slice(-400)}`);
        }
        this.portNumber = port;
        return port;
    }
    /**
     * Transcribe one recording over the HTTP API.
     * @param audio - WAV bytes.
     * @param signal - cancellation.
     * @returns the transcript.
     * @throws when the server is not running or answers with an error.
     */
    async transcribe(audio, signal) {
        const port = this.portNumber;
        if (port === undefined || !this.running)
            throw new Error('speech-multi llama-server is not running');
        const boundary = `----dsh${Date.now().toString(16)}`;
        const body = Buffer.concat([
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="recording.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
            Buffer.from(audio),
            Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);
        const response = await fetch(`http://127.0.0.1:${port}/v1/audio/transcriptions`, {
            method: 'POST',
            headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
            body: new Uint8Array(body),
            signal,
        });
        const payload = await response.json().catch(() => undefined);
        if (!response.ok) {
            throw new Error(`speech-multi llama-server answered ${response.status}: ${JSON.stringify(payload).slice(0, 200)}`);
        }
        const text = payload?.text;
        return typeof text === 'string' ? text : '';
    }
    /**
     * Stop the process and release its memory.
     *
     * Terminates politely first: llama.cpp frees the device buffers on SIGTERM, and a forced kill
     * would leave the driver reclaiming them on its own schedule.
     */
    async stop() {
        const child = this.child;
        this.child = undefined;
        this.portNumber = undefined;
        if (child === undefined || child.exitCode !== null || child.signalCode !== null)
            return;
        const exited = new Promise((resolve) => {
            child.once('exit', () => {
                resolve();
            });
        });
        child.kill('SIGTERM');
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
        }, STOP_GRACE_MS);
        await exited;
        clearTimeout(timer);
    }
}
//# sourceMappingURL=server.js.map