/**
 * Building llama.cpp on the machine that will run it.
 *
 * The runtime is compiled locally rather than downloaded as a binary: a build compiled here picks
 * the machine's own instruction set and GPU target, and avoids the ABI differences that break a
 * copied binary. The pinned source comes from the same release as the models, so a version bump is
 * one upload rather than a network fetch from a project nobody controls.
 */
import { spawn } from 'node:child_process'
import { access, constants, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Config } from '../config.ts'
import { assetFor, type AssetManifest } from '../runtime/assets.ts'
import { fetchArchive } from '../runtime/prepare.ts'
import type { GpuBackend } from './backend.ts'

/** Pinned runtime source, published beside the models. */
export const LLAMA_SOURCE_ARCHIVE = 'llama.cpp-1.1.0.zip'

/** Prefix of every directory this module owns inside the data root. */
const SOURCE_PREFIX = 'llama.cpp-'

/**
 * Version of the pinned runtime, taken from the archive name.
 *
 * It keys the source tree, the build directory and the shared-build lock, so publishing a newer
 * archive in a later plugin release rebuilds instead of silently reusing the binary built from the
 * previous one.
 * @returns the version found in {@link LLAMA_SOURCE_ARCHIVE}.
 */
export function llamaVersion(): string {
  const match = /llama\.cpp-(.+)\.zip$/u.exec(LLAMA_SOURCE_ARCHIVE)
  if (match?.[1] === undefined) throw new Error(`speech-multi cannot read a version from ${LLAMA_SOURCE_ARCHIVE}`)
  return match[1]
}

/**
 * Directory holding the extracted source for one version.
 * @param config - plugin configuration.
 * @returns the absolute path.
 */
export function sourceDirectory(config: Config): string {
  return join(config.dataRoot, 'gpu', `${SOURCE_PREFIX}${llamaVersion()}`)
}

/** CMake flags per backend. */
const BACKEND_FLAGS: Readonly<Record<GpuBackend, readonly string[]>> = {
  hip: ['-DGGML_HIP=ON'],
  cuda: ['-DGGML_CUDA=ON'],
  vulkan: ['-DGGML_VULKAN=ON'],
}

/** Inputs for resolving the runtime binary. */
export interface BuildInput {
  readonly config: Config
  readonly manifest: AssetManifest
  readonly backend: GpuBackend
  readonly signal: AbortSignal
  /** Reports a human-readable step, so the settings page can show what is happening. */
  readonly onStep?: ((step: string) => void) | undefined
}

/**
 * Where the resident runtime lives for one backend.
 *
 * This is the server, not the batch CLI: the providers keep the weights loaded, and pointing them
 * at the CLI is what silently disabled residency for a whole round of testing.
 * @param config - plugin configuration.
 * @param backend - backend it was compiled for.
 * @returns the absolute path to `llama-server`.
 */
export function builtBinary(config: Config, backend: GpuBackend): string {
  return join(buildDirectory(config, backend), 'bin', 'llama-server')
}

/**
 * Where the batch runtime lives, used when the resident server cannot start.
 * @param config - plugin configuration.
 * @param backend - backend it was compiled for.
 * @returns the absolute path to `llama-mtmd-cli`.
 */
export function batchBinary(config: Config, backend: GpuBackend): string {
  return join(buildDirectory(config, backend), 'bin', 'llama-mtmd-cli')
}

/**
 * Where one version and backend are compiled.
 * @param config - plugin configuration.
 * @param backend - backend the build targets.
 * @returns the absolute path to the CMake binary directory.
 */
export function buildDirectory(config: Config, backend: GpuBackend): string {
  return join(config.dataRoot, 'gpu', `build-${llamaVersion()}-${backend}`)
}

/**
 * Whether a path is executable.
 * @param path - absolute path.
 * @returns true when the file exists and carries the execute bit.
 */
export async function isUsableBinary(path: string): Promise<boolean> {
  try {
    // A build interrupted half way leaves a file behind. Treating mere existence as success would
    // hand that file to the runtime and fail on every transcription instead of rebuilding once.
    await access(path, constants.X_OK)
    const stats = await stat(path)
    return stats.isFile() && stats.size > 0
  } catch {
    return false
  }
}

/** One build in progress, shared by every provider that needs it. */
interface RunningBuild {
  /** Settles when the build does; assigned once the factory starts. */
  promise: Promise<string>
  readonly controller: AbortController
  /** Callers still interested; the build is abandoned when this reaches zero. */
  waiters: number
}

/** Builds already under way, keyed by data root and backend. */
const RUNNING = new Map<string, RunningBuild>()

/**
 * Join an in-flight build instead of starting a second one.
 *
 * Several GPU providers share one binary, and preparing two models at once must not extract the
 * source twice or run two compilers over the same build directory. Cancellation is counted rather
 * than forwarded: a provider that gives up stops waiting, and the build itself is only stopped once
 * nobody is waiting for it, so cancelling one preparation cannot destroy another's work.
 * @param key - data root and backend identifying the binary.
 * @param factory - starts the build; receives the signal that governs its lifetime.
 * @param signal - the caller's cancellation.
 * @returns the binary path.
 */
export async function sharedBuild(key: string, factory: (signal: AbortSignal) => Promise<string>,
  signal?: AbortSignal | undefined): Promise<string> {
  let running = RUNNING.get(key)
  if (running === undefined) {
    const controller = new AbortController()
    const created: RunningBuild = { controller, waiters: 0, promise: Promise.resolve('') }
    created.promise = factory(controller.signal).finally(() => {
      RUNNING.delete(key)
    })
    RUNNING.set(key, created)
    running = created
  }
  const joined = running
  joined.waiters += 1
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    joined.waiters -= 1
    if (joined.waiters <= 0 && !joined.controller.signal.aborted) joined.controller.abort()
  }
  if (signal === undefined) {
    try {
      return await joined.promise
    } finally {
      release()
    }
  }
  return await new Promise<string>((resolve, reject) => {
    const abort = (): void => {
      release()
      reject(new Error('speech-multi build cancelled'))
    }
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    joined.promise.then((value) => {
      signal.removeEventListener('abort', abort)
      release()
      resolve(value)
    }, (error: unknown) => {
      signal.removeEventListener('abort', abort)
      release()
      reject(error)
    })
  })
}

/**
 * Resolve the runtime binary, compiling it when needed.
 * @param input - configuration, manifest, backend and cancellation.
 * @returns the absolute path to `llama-mtmd-cli`.
 * @throws when the source is missing, the toolchain rejects the build, or cancellation fired.
 */
export async function ensureLlamaBinary(input: BuildInput): Promise<string> {
  const key = `${input.config.dataRoot}|${input.backend}|${llamaVersion()}`
  return await sharedBuild(key, async (signal) => await buildOnce({ ...input, signal }), input.signal)
}

/**
 * Perform one build.
 * @param input - configuration, manifest, backend and cancellation.
 * @returns the absolute path to `llama-mtmd-cli`.
 */
async function buildOnce(input: BuildInput): Promise<string> {
  if (input.config.gpuBinary !== undefined) return input.config.gpuBinary
  const binary = builtBinary(input.config, input.backend)
  const batch = batchBinary(input.config, input.backend)
  if ((await isUsableBinary(binary)) && (await isUsableBinary(batch))) return binary
  input.signal.throwIfAborted()

  const root = join(input.config.dataRoot, 'gpu')
  await mkdir(root, { recursive: true })
  // The archive is cached under the data root, and this path builds before any model has created it.
  await mkdir(join(input.config.dataRoot, '.cache'), { recursive: true })
  const source = sourceDirectory(input.config)
  if (!(await exists(join(source, 'CMakeLists.txt')))) {
    input.onStep?.('download')
    const record = assetFor(input.manifest, LLAMA_SOURCE_ARCHIVE)
    const archive = await fetchArchive({
      dataRoot: input.config.dataRoot,
      baseUrl: input.config.releaseBaseUrl,
      manifest: input.manifest,
      signal: input.signal,
      progressIntervalMs: input.config.progressIntervalMs,
      segments: input.config.downloadSegments,
    }, LLAMA_SOURCE_ARCHIVE, record)
    input.onStep?.('extract')
    await rm(source, { recursive: true, force: true })
    await extractZip(archive, root)
    await adoptSource(root, source)
  }

  input.signal.throwIfAborted()
  input.onStep?.('compile')
  const build = buildDirectory(input.config, input.backend)
  await run('cmake', [
    '-S', source,
    '-B', build,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DLLAMA_CURL=OFF',
    ...BACKEND_FLAGS[input.backend],
  ], input.signal)
  // Both targets are built: the server is what runs, and the CLI is the fallback used when it
  // cannot start, so neither may be missing from a finished build.
  await run('cmake', ['--build', build, '-j', String(input.config.buildJobs), '--target', 'llama-server', 'llama-mtmd-cli'], input.signal)
  if (!(await isUsableBinary(binary))) throw new Error(`llama.cpp build finished without producing ${binary}`)
  await discardOtherVersions(input.config)
  return binary
}

/**
 * Remove builds and sources left over from a previous version.
 *
 * Each version owns its own directories, so a bump would otherwise leave the previous compiler
 * output on disk forever. Deletion happens only after the new binary is proven usable, so a failed
 * upgrade still has the old tree to fall back on.
 * @param config - plugin configuration.
 * @returns the entries removed.
 */
export async function discardOtherVersions(config: Config): Promise<string[]> {
  const root = join(config.dataRoot, 'gpu')
  const keep = new Set([`${SOURCE_PREFIX}${llamaVersion()}`, ...(['hip', 'cuda', 'vulkan'] as const).map((backend) => `build-${llamaVersion()}-${backend}`)])
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const removed: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const owned = entry.name.startsWith(SOURCE_PREFIX) || entry.name.startsWith('build-')
    if (!owned || keep.has(entry.name)) continue
    await rm(join(root, entry.name), { recursive: true, force: true })
    removed.push(entry.name)
  }
  return removed
}

/**
 * Check a path exists.
 * @param path - absolute path.
 * @returns true when it is present.
 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Move the unpacked source tree to the directory the build expects.
 *
 * The archive wraps its contents in one directory whose name carries the version, and a plain rename
 * is not safe here: if the destination already exists the rename degrades into copying the source
 * *inside* it, which leaves no CMakeLists.txt at the top and turns a recoverable install into a
 * confusing build error. So the directory that actually holds CMakeLists.txt is found first, its
 * contents are copied to the destination, and the unpacked tree is removed.
 * @param root - directory the archive was expanded into.
 * @param source - destination the build will use.
 * @throws when no directory in the archive contains CMakeLists.txt.
 */
async function adoptSource(root: string, source: string): Promise<void> {
  const { cp } = await import('node:fs/promises')
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = join(root, entry.name)
    if (!(await exists(join(candidate, 'CMakeLists.txt')))) continue
    await rm(source, { recursive: true, force: true })
    await cp(candidate, source, { recursive: true })
    await rm(candidate, { recursive: true, force: true })
    return
  }
  throw new Error(`${LLAMA_SOURCE_ARCHIVE} did not contain a directory with CMakeLists.txt`)
}

/**
 * Expand a zip archive using the system tool.
 * @param archive - zip file.
 * @param destination - directory to unpack into.
 * @throws when `unzip` is unavailable.
 */
async function extractZip(archive: string, destination: string): Promise<void> {
  await run('unzip', ['-q', '-o', archive, '-d', destination], new AbortController().signal)
}

/**
 * Run a build command, surfacing the tail of its output on failure.
 * @param command - executable name.
 * @param argv - arguments.
 * @param signal - cancellation.
 * @throws when the command exits non-zero.
 */
async function run(command: string, argv: readonly string[], signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...argv], { stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    const abort = (): void => {
      child.kill('SIGTERM')
    }
    signal.addEventListener('abort', abort, { once: true })
    const collect = (chunk: Buffer): void => {
      tail = `${tail}${chunk.toString('utf8')}`.slice(-4000)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', (error) => {
      signal.removeEventListener('abort', abort)
      reject(new Error(`speech-multi could not run ${command}: ${String(error)}`))
    })
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) {
        reject(new Error(`speech-multi ${command} cancelled`))
        return
      }
      if (code !== 0) {
        reject(new Error(`speech-multi ${command} ${argv.slice(0, 3).join(' ')} failed: ${tail.trim().slice(-600)}`))
        return
      }
      resolve()
    })
  })
}
