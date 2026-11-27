import { type Server } from 'node:http';
/** Reply shape returned by the worker. */
export interface WorkerReply {
    readonly text: string;
    readonly blocks: number;
    readonly audioSeconds: number;
    readonly inferenceSeconds: number;
}
/** Handler the server delegates to. */
export type WorkerHandler = (audio: Buffer) => WorkerReply | Promise<WorkerReply>;
/**
 * Start the loopback listener.
 * @param token - per-process bearer secret.
 * @param maxAudioBytes - largest accepted request body.
 * @param handle - synchronous decode owned by this process.
 * @returns the listening server and its port.
 */
export declare function startServer(token: string, maxAudioBytes: number, handle: WorkerHandler): Promise<{
    server: Server;
    port: number;
}>;
