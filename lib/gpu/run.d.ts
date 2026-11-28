import type { GpuFilePaths } from './files.ts';
/** Everything one transcription needs. */
export interface LlamaRequest {
    /** Path to `llama-mtmd-cli` inside the built tree. */
    readonly binary: string;
    /** Model and audio tower, already resolved on disk. */
    readonly files: GpuFilePaths;
    /** WAV bytes as received from the Host. */
    readonly audio: Uint8Array;
    /** Decoded length, which selects the context size. */
    readonly audioSeconds: number;
    /** CPU threads; the audio tower runs on the CPU while the text model runs on the GPU. */
    readonly threads: number;
    /** Cancels the process. */
    readonly signal: AbortSignal;
}
/** One transcription result. */
export interface LlamaResult {
    readonly text: string;
    /** Wall time spent inside the runtime, in seconds. */
    readonly inferenceSeconds: number;
}
/**
 * Strip the runtime's own framing from stdout.
 *
 * The model answers with a language tag in front of the transcript — `language Chinese<asr_text>`
 * — which is part of the model's output format rather than the audio, so it never reaches the user.
 * {@link sanitize} also removes the marker tokens and the decoder's other control strings.
 * @param stdout - everything the process wrote to standard output.
 * @returns the transcript.
 */
export declare function parseTranscript(stdout: string): string;
/**
 * Transcribe one recording.
 * @param request - binary, model files, audio and cancellation.
 * @returns the transcript and how long the runtime took.
 * @throws when the process exits non-zero, or when cancellation fired.
 */
export declare function transcribeWithLlama(request: LlamaRequest): Promise<LlamaResult>;
