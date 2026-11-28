/**
 * Where a GPU model's two files come from.
 *
 * Resolution order is deliberate: a configured local directory wins so a machine that already has
 * the files never touches the network, then an installed copy, and only then the release. The same
 * two-file layout is produced by all three, because the runtime takes explicit paths.
 */
import { access, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Config } from '../config.ts'
import { assetFor, type AssetManifest } from '../runtime/assets.ts'
import { fetchArchive } from '../runtime/prepare.ts'
import { extractTarZst } from '../runtime/tar.ts'
import type { GpuModelSpec } from './spec.ts'

/** The two files one GPU model needs. */
export interface GpuFilePaths {
  /** Text model weights. */
  readonly model: string
  /** Audio encoder, run on the CPU by the runtime. */
  readonly mmproj: string
}

/**
 * Whether a file is readable.
 * @param path - absolute path.
 * @returns true when it exists.
 */
async function readable(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Inputs for resolving one model's files. */
export interface GpuFilesInput {
  readonly spec: GpuModelSpec
  readonly config: Config
  readonly manifest: AssetManifest
  readonly signal: AbortSignal
}

/** Where one GPU model is installed. */
export function gpuModelRoot(config: Config, spec: GpuModelSpec): string {
  return join(config.dataRoot, 'gpu', spec.id)
}

/**
 * Resolve the model files, installing them when they are missing.
 * @param input - model, configuration, manifest and cancellation.
 * @returns the model and audio-tower paths.
 * @throws when the files are absent locally and the archive does not provide them.
 */
export async function resolveGpuFiles(input: GpuFilesInput): Promise<GpuFilePaths> {
  const local = input.config.gpuLocalRoot
  if (local !== undefined) {
    const model = join(local, input.spec.modelFile)
    const mmproj = join(local, input.spec.mmprojFile)
    if (await readable(model) && await readable(mmproj)) return { model, mmproj }
  }
  const root = gpuModelRoot(input.config, input.spec)
  const installed = { model: join(root, input.spec.modelFile), mmproj: join(root, input.spec.mmprojFile) }
  if (await readable(installed.model) && await readable(installed.mmproj)) return installed

  const record = assetFor(input.manifest, input.spec.archive)
  await mkdir(join(input.config.dataRoot, '.cache'), { recursive: true })
  const cached = await fetchArchive({
    dataRoot: input.config.dataRoot,
    baseUrl: input.config.releaseBaseUrl,
    manifest: input.manifest,
    signal: input.signal,
    progressIntervalMs: input.config.progressIntervalMs,
    segments: input.config.downloadSegments,
  }, input.spec.archive, record)
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  input.signal.throwIfAborted()
  try {
    await extractTarZst(cached, root)
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
  if (!(await readable(installed.model)) || !(await readable(installed.mmproj))) {
    await rm(root, { recursive: true, force: true })
    throw new Error(`speech-multi archive ${input.spec.archive} did not contain ${input.spec.modelFile} and ${input.spec.mmprojFile}`)
  }
  return installed
}
