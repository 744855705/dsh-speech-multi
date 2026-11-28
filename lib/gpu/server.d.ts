import type { GpuFilePaths } from './files.ts';
/** Where a resident server listens. */
export interface ServerOptions {
    /** Path to `llama-server` inside the built tree. */
    readonly binary: string;
    /** Model and audio tower. */
    readonly files: GpuFilePaths;
    /** CPU threads for the audio tower and prompt work. */
    readonly threads: number;
    /** Receives diagnostic lines; the caller decides where they go. */
    readonly onLog?: ((line: string) => void) | undefined;
}
/** One resident model server. */
export declare class LlamaServer {
    private readonly options;
    private child;
    private portNumber;
    private tail;
    constructor(options: ServerOptions);
    /** @returns the port it listens on, when running. */
    get port(): number | undefined;
    /** @returns true while the process is alive. */
    get running(): boolean;
    /**
     * Start the server and wait until it accepts requests.
     * @param signal - cancellation.
     * @returns the port it listens on.
     * @throws when the process exits, or never becomes ready.
     */
    start(signal: AbortSignal): Promise<number>;
    /**
     * Transcribe one recording over the HTTP API.
     * @param audio - WAV bytes.
     * @param signal - cancellation.
     * @returns the transcript.
     * @throws when the server is not running or answers with an error.
     */
    transcribe(audio: Uint8Array, signal: AbortSignal): Promise<string>;
    /**
     * Stop the process and release its memory.
     *
     * Terminates politely first: llama.cpp frees the device buffers on SIGTERM, and a forced kill
     * would leave the driver reclaiming them on its own schedule.
     */
    stop(): Promise<void>;
}
