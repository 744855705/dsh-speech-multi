import z from '@deepseek-ai/schemastery';
import { type ModelId } from './catalog.ts';
import type { GpuBackend } from './gpu/backend.ts';
/** Release that serves the archives listed in `runtime/assets.json`. */
export declare const DEFAULT_RELEASE_BASE_URL = "https://github.com/744855705/dsh-speech-multi/releases/download/models-v1";
/**
 * Resolve the harness home shared by every profile: `$DSH_HOME`, otherwise `~/.dsh`.
 * @param env - environment to read.
 * @param home - operating-system home.
 * @returns the absolute harness home.
 */
export declare function defaultHarnessHome(env?: Record<string, string | undefined>, home?: string): string;
/**
 * Cache root shared by every profile, independent of the profile directory.
 * @param env - environment to read.
 * @param home - operating-system home.
 * @returns the absolute model root.
 */
export declare function defaultDataRoot(env?: Record<string, string | undefined>, home?: string): string;
/**
 * Lock file outside the profile, so a profile refresh cannot remove it.
 * @param env - environment to read.
 * @param home - operating-system home.
 * @returns the absolute lock-file path.
 */
export declare function defaultLockFile(env?: Record<string, string | undefined>, home?: string): string;
/** Tier selection: `auto` reads the machine's memory. */
export type DeviceTierChoice = 'auto' | 'light' | 'standard' | 'large';
/** Runtime settings shared by all four providers. */
export interface Config {
    /** Models to register, in registration order; unknown ids are rejected. */
    enabledModels: string[];
    /** Absolute directory holding verified model files and the download cache. */
    dataRoot: string;
    /** Release base URL serving the archives named by `runtime/assets.json`. */
    releaseBaseUrl: string;
    /** Absolute lock-file path; the plugin only reads it. */
    lockFile: string;
    /** Memory tier, or `auto` to derive it from total system memory. */
    deviceTier: DeviceTierChoice;
    /** CPU intra-operation threads handed to every worker. */
    threads: number;
    /** Silero speech probability threshold. */
    /** Extra hotwords appended to the built-in list. */
    hotwords: string[];
    /** Turns the hotword list off without losing it. */
    hotwordsEnabled: boolean;
    /** Families that receive the hotword list. */
    hotwordsModels: string[];
    vadThreshold: number;
    /** Silence that separates two speech regions. */
    minSilenceSeconds: number;
    /** Shortest speech region kept. */
    minSpeechSeconds: number;
    /** Longest speech region before the detector closes it. */
    maxSpeechSeconds: number;
    /** Overrides the tier's recording ceiling. */
    maxRecordingSeconds?: number | undefined;
    /** Largest WAV accepted from the recorder; 16 MiB covers five minutes of 16 kHz PCM16. */
    maxAudioBytes: number;
    /** Deadline for download, expansion and cold model load. */
    prepareTimeoutMs: number;
    /** Deadline for one recording after the worker is ready. */
    inferenceTimeoutMs: number;
    /** Idle period before the worker stops, four hours by default; zero keeps it warm. */
    idleTimeoutMs: number;
    /** Maximum concurrent transcriptions per model. */
    maxPending: number;
    /** Process termination grace period. */
    graceMs: number;
    /** Maximum retained worker diagnostic bytes. */
    maxLogBytes: number;
    /** Maximum transcript response bytes. */
    maxResponseBytes: number;
    /** Minimum interval between download progress updates. */
    progressIntervalMs: number;
    /** Parallel range requests for a large archive; 1 downloads in a single stream. */
    downloadSegments: number;
    /**
     * Compiler processes used to build the GPU runtime.
     *
     * A HIP build keeps the machine busy for several minutes; using every core finishes it sooner,
     * and the build is a one-off rather than something that runs while the user is typing.
     */
    buildJobs: number;
    /** Registers the GPU providers when a usable device is found. */
    gpuEnabled: boolean;
    /**
     * Directory that already holds the GGUF files, checked before anything is downloaded.
     *
     * This is how a machine reuses a model set it obtained by other means, and how the plugin is
     * tested before a release exists.
     */
    gpuLocalRoot?: string | undefined;
    /** An already-built `llama-mtmd-cli`; setting it skips compiling the runtime. */
    gpuBinary?: string | undefined;
    /** Forces one GPU backend instead of probing in preference order. */
    gpuBackend?: GpuBackend | undefined;
}
/** Schema validated at plugin activation. */
export declare const Config: z<Partial<Config>, Config>;
/**
 * Validate deployment-varying choices before registration.
 * @param config - schema-validated configuration.
 * @throws when a path is relative, a model id is unknown, or the release URL is unusable.
 */
export declare function validateConfig(config: Config): void;
/**
 * Narrow the configured ids to real catalog ids.
 * @param ids - configured ids, already validated.
 * @returns the same list typed as model ids.
 */
export declare function enabledModelIds(ids: readonly string[]): readonly ModelId[];
