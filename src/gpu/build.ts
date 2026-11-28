/**
 * Building llama.cpp on the machine that will run it.
 *
 * The runtime is compiled locally rather than downloaded as a binary: a build compiled here picks
 * the machine's own instruction set and GPU target, and avoids the ABI differences that break a
 * copied binary. The pinned source comes from the same release as the models, so a version bump is
 * one upload rather than a network fetch from a project nobody controls.
 */
import { spawn } from 'node:child_process'
import { access, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Config } from '../config.ts'
import { assetFor, type AssetManifest } from '../runtime/assets.ts'
import { fetchArchive } from '../runtime/prepare.ts'
import type { GpuBackend } from './backend.ts'

/** Pinned runtime source, published beside the models. */
export const LLAMA_SOURCE_ARCHIVE = 'llama.cpp-1.1.0.zip'

/** Directory holding the extracted source inside the plugin's data root. */
const SOURCE_DIR = 'llama.cpp'

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
 * Where a built binary lives for one backend.
 * @param config - plugin configuration.
 * @param backend - backend it was compiled for.
 * @returns the absolute path to `llama-mtmd-cli`.
 */
export function builtBinary(config: Config, backend: GpuBackend): string {
  return join(config.dataRoot, 'gpu', `build-${backend}`, 'bin', 'llama-mtmd-cli')
}

/**
 * Whether a path is executable.
 * @param path - absolute path.
 * @returns true when the file exists and carries the execute bit.
 */
async function executable(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the runtime binary, compiling it when needed.
 * @param input - configuration, manifest, backend and cancellation.
 * @returns the absolute path to `llama-mtmd-cli`.
 * @throws when the source is missing, the toolchain rejects the build, or cancellation fired.
 */
export async function ensureLlamaBinary(input: BuildInput): Promise<string> {
  if (input.config.gpuBinary !== undefined) return input.config.gpuBinary
  const binary = builtBinary(input.config, input.backend)
  if (await executable(binary)) return binary
  input.signal.throwIfAborted()

  const root = join(input.config.dataRoot, 'gpu')
  await mkdir(root, { recursive: true })
  // The archive is cached under the data root, and this path builds before any model has created it.
  await mkdir(join(input.config.dataRoot, '.cache'), { recursive: true })
  const source = join(root, SOURCE_DIR)
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
  const build = join(root, `build-${input.backend}`)
  await run('cmake', [
    '-S', source,
    '-B', build,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DLLAMA_CURL=OFF',
    ...BACKEND_FLAGS[input.backend],
  ], input.signal)
  await run('cmake', ['--build', build, '-j', String(input.config.threads), '--target', 'llama-mtmd-cli'], input.signal)
  if (!(await executable(binary))) throw new Error(`llama.cpp build finished without producing ${binary}`)
  return binary
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
