/** Deployment configuration for the four local recognizers. */
import { cpus, homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { modelIds, type ModelId } from './catalog.ts'
import { MAX_TIMER_DELAY_MS } from './deadline.ts'
import type { GpuBackend } from './gpu/backend.ts'

/** Release that serves the archives listed in `runtime/assets.json`. */
export const DEFAULT_RELEASE_BASE_URL = 'https://github.com/744855705/dsh-speech-multi/releases/download/models-v1'

/** Expand a leading `~` against the operating-system home. */
function expandHome(value: string, home: string): string {
  if (value === '~') return home
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(home, value.slice(2))
  return value
}

/**
 * Resolve the harness home shared by every profile: `$DSH_HOME`, otherwise `~/.dsh`.
 * @param env - environment to read.
 * @param home - operating-system home.
 * @returns the absolute harness home.
 */
export function defaultHarnessHome(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  const configured = env.DSH_HOME?.trim()
  return resolve(configured === undefined || configured.length === 0 ? join(home, '.dsh') : expandHome(configured, home))
}

/**
 * Cache root shared by every profile, independent of the profile directory.
 * @param env - environment to read.
 * @param home - operating-system home.
 * @returns the absolute model root.
 */
export function defaultDataRoot(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return join(defaultHarnessHome(env, home), 'speech-to-text', 'multi')
}

/**
 * Lock file outside the profile, so a profile refresh cannot remove it.
 * @param env - environment to read.
 * @param home - operating-system home.
 * @returns the absolute lock-file path.
 */
export function defaultLockFile(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return join(defaultHarnessHome(env, home), 'speech-multi-lock.json')
}

/** Tier selection: `auto` reads the machine's memory. */
export type DeviceTierChoice = 'auto' | 'light' | 'standard' | 'large'

/** Runtime settings shared by all four providers. */
export interface Config {
  /** Models to register, in registration order; unknown ids are rejected. */
  enabledModels: string[]
  /** Absolute directory holding verified model files and the download cache. */
  dataRoot: string
  /** Release base URL serving the archives named by `runtime/assets.json`. */
  releaseBaseUrl: string
  /** Absolute lock-file path; the plugin only reads it. */
  lockFile: string
  /** Memory tier, or `auto` to derive it from total system memory. */
  deviceTier: DeviceTierChoice
  /** CPU intra-operation threads handed to every worker. */
  threads: number
  /** Silero speech probability threshold. */
  /** Extra hotwords appended to the built-in list. */
  hotwords: string[]
  /** Turns the hotword list off without losing it. */
  hotwordsEnabled: boolean
  /** Families that receive the hotword list. */
  hotwordsModels: string[]
  vadThreshold: number
  /** Silence that separates two speech regions. */
  minSilenceSeconds: number
  /** Shortest speech region kept. */
  minSpeechSeconds: number
  /** Longest speech region before the detector closes it. */
  maxSpeechSeconds: number
  /** Overrides the tier's recording ceiling. */
  maxRecordingSeconds?: number | undefined
  /** Largest WAV accepted from the recorder; 16 MiB covers five minutes of 16 kHz PCM16. */
  maxAudioBytes: number
  /** Deadline for download, expansion and cold model load. */
  prepareTimeoutMs: number
  /** Deadline for one recording after the worker is ready. */
  inferenceTimeoutMs: number
  /** Idle period before the worker stops, four hours by default; zero keeps it warm. */
  idleTimeoutMs: number
  /** Maximum concurrent transcriptions per model. */
  maxPending: number
  /** Process termination grace period. */
  graceMs: number
  /** Maximum retained worker diagnostic bytes. */
  maxLogBytes: number
  /** Maximum transcript response bytes. */
  maxResponseBytes: number
  /** Minimum interval between download progress updates. */
  progressIntervalMs: number
  /** Parallel range requests for a large archive; 1 downloads in a single stream. */
  downloadSegments: number
  /**
   * Compiler processes used to build the GPU runtime.
   *
   * A HIP build keeps the machine busy for several minutes; using every core finishes it sooner,
   * and the build is a one-off rather than something that runs while the user is typing.
   */
  buildJobs: number
  /** Registers the GPU providers when a usable device is found. */
  gpuEnabled: boolean
  /**
   * Directory that already holds the GGUF files, checked before anything is downloaded.
   *
   * This is how a machine reuses a model set it obtained by other means, and how the plugin is
   * tested before a release exists.
   */
  gpuLocalRoot?: string | undefined
  /** An already-built `llama-mtmd-cli`; setting it skips compiling the runtime. */
  gpuBinary?: string | undefined
  /** Forces one GPU backend instead of probing in preference order. */
  gpuBackend?: GpuBackend | undefined
}

const DEFAULT_MODELS: string[] = [...modelIds()]

/** Schema validated at plugin activation. */
export const Config: z<Partial<Config>, Config> = z.object({
  enabledModels: z.array(z.string().min(1)).default(DEFAULT_MODELS),
  dataRoot: z.string().min(1).default(defaultDataRoot()),
  releaseBaseUrl: z.string().min(1).default(DEFAULT_RELEASE_BASE_URL),
  lockFile: z.string().min(1).default(defaultLockFile()),
  deviceTier: z.union([z.const('auto'), z.const('light'), z.const('standard'), z.const('large')]).default('auto'),
  threads: z.natural().min(1).default(8),
  /** Extra hotwords appended to the built-in developer vocabulary. */
  hotwords: z.array(z.string().min(1)).default([]),
  /** Turns the whole hotword list off, keeping the configuration intact. */
  hotwordsEnabled: z.boolean().default(true),
  /**
   * Families that receive the hotword list. Only Fun-ASR reads them as a prompt; X-ASR would
   * have to switch to beam search to use them, which measured worse than greedy on dictation.
   */
  hotwordsModels: z.array(z.string().min(1)).default(['funasr']),
  vadThreshold: z.number().min(0).max(1).default(0.5),
  minSilenceSeconds: z.number().min(0.01).default(0.8),
  minSpeechSeconds: z.number().min(0).default(0.1),
  maxSpeechSeconds: z.number().min(1).max(120).default(29.45),
  maxRecordingSeconds: z.union([z.natural().min(10), z.const(undefined)]),
  maxAudioBytes: z.natural().min(46).default(16 * 1024 * 1024),
  prepareTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(3_600_000),
  inferenceTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(600_000),
  idleTimeoutMs: z.natural().max(MAX_TIMER_DELAY_MS).default(14_400_000),
  maxPending: z.natural().min(1).default(2),
  graceMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(1000),
  maxLogBytes: z.natural().min(1).default(64 * 1024),
  maxResponseBytes: z.natural().min(1).default(256 * 1024),
  progressIntervalMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(150),
  downloadSegments: z.natural().min(1).max(16).default(8),
  buildJobs: z.natural().min(1).max(64).default(cpus().length),
  gpuEnabled: z.boolean().default(true),
  gpuLocalRoot: z.union([z.string().min(1), z.const(undefined)]),
  gpuBinary: z.union([z.string().min(1), z.const(undefined)]),
  gpuBackend: z.union([z.const('hip'), z.const('cuda'), z.const('vulkan'), z.const(undefined)]),
})

/**
 * Validate deployment-varying choices before registration.
 * @param config - schema-validated configuration.
 * @throws when a path is relative, a model id is unknown, or the release URL is unusable.
 */
export function validateConfig(config: Config): void {
  for (const path of [config.dataRoot, config.lockFile]) {
    if (!isAbsolute(path)) throw new Error(`speech-multi paths must be absolute: ${path}`)
  }
  const known = new Set<string>(modelIds())
  for (const id of config.enabledModels) {
    if (!known.has(id)) throw new Error(`speech-multi does not register ${id}`)
  }
  if (config.enabledModels.length === 0) throw new Error('speech-multi requires at least one model')
  let url: URL
  try {
    url = new URL(config.releaseBaseUrl)
  } catch (error) {
    throw new Error('speech-multi releaseBaseUrl is not a valid URL', { cause: error })
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error('speech-multi releaseBaseUrl must be HTTPS without credentials')
  }
}

/**
 * Narrow the configured ids to real catalog ids.
 * @param ids - configured ids, already validated.
 * @returns the same list typed as model ids.
 */
export function enabledModelIds(ids: readonly string[]): readonly ModelId[] {
  return ids.filter((id): id is ModelId => modelIds().includes(id as ModelId))
}
