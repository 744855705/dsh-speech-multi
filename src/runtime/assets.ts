/**
 * Release manifest.
 *
 * Every archive's digest is compiled in rather than fetched, so a rewritten release asset or a
 * dropped-in file is rejected instead of installed. The base URL is configuration because the
 * release lives in the user's own repository.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/** One slice of an archive published in pieces. */
export interface AssetPart {
  /** File name of the slice inside its release. */
  readonly name: string
  /** Lowercase hex SHA-256 of the slice. */
  readonly sha256: string
  /** Exact slice length in bytes. */
  readonly bytes: number
}

/** One published archive. */
export interface AssetRecord {
  /** Lowercase hex SHA-256 of the archive, or of the reassembled archive when it ships in parts. */
  readonly sha256: string
  /** Exact archive length in bytes, or the sum of the parts. */
  readonly bytes: number
  /**
   * Release tag holding the file, when it is not the default release.
   *
   * The model set outgrew one release: the CPU archives stay where they were published and the
   * GPU ones live under a later tag, so the manifest has to say which tag each file belongs to.
   */
  readonly release?: string | undefined
  /**
   * Ordered slices of an archive larger than the host's per-file ceiling.
   *
   * GitHub refuses release assets over 2 GB, so the 1.7B archives are split and reassembled after
   * every slice has been verified individually.
   */
  readonly parts?: readonly AssetPart[] | undefined
}

/** Parsed manifest. */
export interface AssetManifest {
  readonly version: number
  readonly files: Readonly<Record<string, AssetRecord>>
}

const hex64 = z.string().regex(/^[a-f0-9]{64}$/u)

const partSchema = z.object({
  name: z.string().min(1),
  sha256: hex64,
  bytes: z.number().int().positive(),
}).strict()

const recordSchema = z.object({
  sha256: hex64,
  bytes: z.number().int().positive(),
  release: z.string().min(1).optional(),
  parts: z.array(partSchema).min(1).optional(),
}).strict()

const manifestSchema = z.object({
  version: z.number().int().positive(),
  files: z.record(z.string().min(1), recordSchema),
}).strict()

/** Manifest path, resolved relative to this module so it works from `src` and `lib` alike. */
const MANIFEST_URL = new URL('../../runtime/assets.json', import.meta.url)

/**
 * Read and validate the shipped manifest.
 * @returns the parsed manifest.
 * @throws when the file is missing or malformed, which is a packaging defect rather than a user error.
 */
export function loadManifest(): AssetManifest {
  const raw: unknown = JSON.parse(readFileSync(fileURLToPath(MANIFEST_URL), 'utf8'))
  return manifestSchema.parse(raw)
}

/**
 * Look up one archive's record.
 * @param manifest - parsed manifest.
 * @param archive - archive file name from the catalog.
 * @returns the digest and length.
 * @throws when the archive is not published, which means the catalog and manifest disagree.
 */
export function assetFor(manifest: AssetManifest, archive: string): AssetRecord {
  const record = manifest.files[archive]
  if (record === undefined) throw new Error(`speech-multi manifest does not list ${archive}`)
  return record
}

/**
 * Build the download URL for one archive.
 * @param baseUrl - release base URL without a trailing slash.
 * @param archive - archive file name.
 * @returns the absolute HTTPS URL.
 */
export function archiveUrl(baseUrl: string, archive: string): string {
  return `${baseUrl.replace(/\/+$/u, '')}/${encodeURIComponent(archive)}`
}

/**
 * Build the download URL for one file of a manifest entry.
 *
 * @param baseUrl - release base URL, ending in the default release tag.
 * @param record - the entry that may name a different release.
 * @param file - archive name, or one part's file name.
 * @returns the absolute HTTPS URL.
 */
export function assetUrl(baseUrl: string, record: AssetRecord | undefined, file: string): string {
  const trimmed = baseUrl.replace(/\/+$/u, '')
  const release = record?.release
  if (release === undefined) return archiveUrl(trimmed, file)
  const base = trimmed.replace(/\/[^/]+$/u, `/${encodeURIComponent(release)}`)
  return `${base}/${encodeURIComponent(file)}`
}
