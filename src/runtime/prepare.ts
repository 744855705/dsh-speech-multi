/** Model acquisition: inspect what is on disk, then download, verify and expand what is missing. */
import { access, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { FamilyId, ModelDescriptor } from '../catalog.ts'
import { archiveUrl, assetFor, type AssetManifest } from './assets.ts'
import { downloadArchive, type DownloadProgress } from './download.ts'
import { extractTarZst } from './tar.ts'

/** Archive holding the punctuation model, used by the one model that does not punctuate itself. */
export const PUNCTUATION_ARCHIVE = 'punctuation.tar.zst'

/** Archive holding both voice-activity detectors, shared by every model. */
export const VAD_ARCHIVE = 'vad.tar.zst'

/** File whose presence proves the punctuation archive finished expanding. */
const PUNCTUATION_MARKER = join('punctuation', 'fireredpunc', 'punc.fp16.onnx')

/** File whose presence proves the VAD archive finished expanding. */
const VAD_MARKER = join('vad', 'fsmn.onnx')

/** File whose presence proves an expansion finished, keyed by family. */
const MARKERS: Readonly<Record<FamilyId, string>> = {
  xasr: 'tokens.txt',
  funasr: 'llm.int8.onnx',
  qwen3: 'encoder.int8.onnx',
  firered: 'tokens.txt',
}

/** Where one model's files live. */
export function modelRoot(dataRoot: string, model: ModelDescriptor): string {
  return join(dataRoot, model.root)
}

/** Where archives are cached before expansion. */
export function archiveCache(dataRoot: string, model: ModelDescriptor): string {
  return join(dataRoot, '.cache', model.archive)
}

/**
 * Whether a model is already installed.
 * @param root - expected model directory.
 * @param family - family whose marker file proves completeness.
 * @returns true when the marker file is readable.
 */
export async function isInstalled(root: string, family: FamilyId): Promise<boolean> {
  try {
    await access(join(root, MARKERS[family]))
    return true
  } catch {
    return false
  }
}

/** Shared asset locations resolved for one model. */
export interface SharedPaths {
  /** Silero VAD model, when the shared archive is installed. */
  readonly vad: string | undefined
  /** FireRedPunc directory, when the shared archive is installed. */
  readonly punctuation: string | undefined
}

/**
 * Check the shared archive independently of any model.
 * @param dataRoot - model root.
 * @returns true when the VAD file is readable.
 */
export async function isSharedInstalled(dataRoot: string): Promise<boolean> {
  try {
    await access(join(dataRoot, PUNCTUATION_MARKER))
    await access(join(dataRoot, VAD_MARKER))
    return true
  } catch {
    return false
  }
}

/** Inputs for one preparation. */
export interface PrepareInput {
  readonly model: ModelDescriptor
  readonly dataRoot: string
  readonly baseUrl: string
  readonly manifest: AssetManifest
  readonly signal: AbortSignal
  readonly progressIntervalMs: number
  readonly onProgress?: ((progress: DownloadProgress) => void) | undefined
}

/**
 * Make a model available on disk.
 *
 * The archive is verified before it is expanded, and a failed expansion leaves no partial
 * directory that a later run would mistake for a finished install.
 * @param input - model, locations, manifest and cancellation.
 * @returns the model directory.
 */
export async function ensureModel(input: PrepareInput): Promise<string> {
  const root = modelRoot(input.dataRoot, input.model)
  if (await isInstalled(root, input.model.family)) return root
  const record = assetFor(input.manifest, input.model.archive)
  const cached = archiveCache(input.dataRoot, input.model)
  await mkdir(join(input.dataRoot, '.cache'), { recursive: true })
  if (!(await isInstalled(cached, input.model.family))) {
    await downloadArchive(archiveUrl(input.baseUrl, input.model.archive), cached, record, {
      signal: input.signal,
      progressIntervalMs: input.progressIntervalMs,
      ...input.onProgress === undefined ? {} : { onProgress: input.onProgress },
    })
  }
  input.signal.throwIfAborted()
  await rm(root, { recursive: true, force: true })
  try {
    await extractTarZst(cached, input.dataRoot)
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
  if (!(await isInstalled(root, input.model.family))) {
    throw new Error(`speech-multi archive ${input.model.archive} did not contain ${input.model.root}`)
  }
  return root
}


/**
 * Make the shared archives available.
 *
 * Punctuation is needed by exactly one model, the VAD by all of them, and they ship separately so
 * replacing a detector does not force a re-download of the 248 MB punctuation archive.
 * @param input - locations, manifest and cancellation.
 * @returns the resolved shared paths; an entry stays undefined when its archive is not published.
 */
export async function ensureShared(input: Omit<PrepareInput, 'model'>): Promise<SharedPaths> {
  const punctuation = join(input.dataRoot, 'punctuation', 'fireredpunc')
  const vad = join(input.dataRoot, 'vad')
  await mkdir(join(input.dataRoot, '.cache'), { recursive: true })
  const fetch = async (archive: string, marker: string): Promise<boolean> => {
    try {
      await access(join(input.dataRoot, marker))
      return true
    } catch {
      // Not installed yet, or a previous expansion failed half way.
    }
    const record = input.manifest.files[archive]
    if (record === undefined) return false
    const cached = join(input.dataRoot, '.cache', archive)
    await downloadArchive(archiveUrl(input.baseUrl, archive), cached, record, {
      signal: input.signal,
      progressIntervalMs: input.progressIntervalMs,
      ...input.onProgress === undefined ? {} : { onProgress: input.onProgress },
    })
    await extractTarZst(cached, input.dataRoot)
    return true
  }
  const punctuationReady = await fetch(PUNCTUATION_ARCHIVE, PUNCTUATION_MARKER)
  const vadReady = await fetch(VAD_ARCHIVE, VAD_MARKER)
  return { vad: vadReady ? vad : undefined, punctuation: punctuationReady ? punctuation : undefined }
}
