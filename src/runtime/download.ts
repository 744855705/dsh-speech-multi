/**
 * Archive download with digest verification.
 *
 * The digest comes from the shipped manifest, so a release asset that was replaced after
 * packaging is rejected. Nothing is kept unless the bytes match, which keeps a partial or
 * tampered download from being mistaken for an installed model.
 */
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { open, rm } from 'node:fs/promises'
import type { AssetRecord } from './assets.ts'

/** What a caller learns while bytes arrive. */
export interface DownloadProgress {
  readonly completedBytes: number
  /** Present only when the server sent a content length. */
  readonly totalBytes?: number
}

/** Options for one download. */
export interface DownloadOptions {
  /** Cancels the transfer. */
  readonly signal: AbortSignal
  /** Progress callback, already throttled by the caller. */
  readonly onProgress?: ((progress: DownloadProgress) => void) | undefined
  /** Minimum interval between progress callbacks. */
  readonly progressIntervalMs?: number
}

/**
 * Verify a file against the manifest.
 * @param path - file to read.
 * @param record - expected digest and length.
 * @returns true when both length and digest match.
 */
export async function verifyFile(path: string, record: AssetRecord): Promise<boolean> {
  const handle = await open(path, 'r').catch(() => undefined)
  if (handle === undefined) return false
  try {
    const stats = await handle.stat()
    if (stats.size !== record.bytes) return false
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let position = 0
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    return hash.digest('hex') === record.sha256
  } finally {
    await handle.close()
  }
}

/**
 * Stream one archive to disk and verify it.
 * @param url - absolute HTTPS URL.
 * @param destination - file to create; removed when verification fails.
 * @param record - expected digest and length.
 * @param options - cancellation and progress.
 * @returns after the file is proven to match.
 * @throws when the response fails, the length differs, or the digest differs.
 */
export async function downloadArchive(url: string, destination: string, record: AssetRecord,
  options: DownloadOptions): Promise<void> {
  const response = await fetch(url, { signal: options.signal, redirect: 'follow' })
  if (!response.ok) throw new Error(`speech-multi download failed with HTTP ${response.status} from ${url}`)
  if (response.body === null) throw new Error(`speech-multi download from ${url} returned no body`)
  const declared = Number(response.headers.get('content-length'))
  const totalBytes = Number.isSafeInteger(declared) && declared > 0 ? declared : undefined
  if (totalBytes !== undefined && totalBytes !== record.bytes) {
    throw new Error(`speech-multi download size ${totalBytes} does not match the published ${record.bytes}`)
  }
  const hash = createHash('sha256')
  const sink = createWriteStream(destination)
  const interval = options.progressIntervalMs ?? 100
  let completedBytes = 0
  let lastReport = 0
  try {
    for await (const chunk of response.body) {
      const bytes = chunk as Buffer
      completedBytes += bytes.length
      if (completedBytes > record.bytes) throw new Error('speech-multi download exceeded the published size')
      hash.update(bytes)
      if (!sink.write(bytes)) await new Promise<void>((resolve) => sink.once('drain', resolve))
      const now = Date.now()
      if (options.onProgress !== undefined && now - lastReport >= interval) {
        lastReport = now
        options.onProgress({ completedBytes, ...totalBytes === undefined ? {} : { totalBytes } })
      }
    }
    await new Promise<void>((resolve, reject) => { sink.end(() => { resolve() }); sink.once('error', reject) })
    if (completedBytes !== record.bytes) throw new Error(`speech-multi download stopped at ${completedBytes} of ${record.bytes} bytes`)
    if (hash.digest('hex') !== record.sha256) throw new Error('speech-multi download does not match the published digest')
    options.onProgress?.({ completedBytes, ...totalBytes === undefined ? {} : { totalBytes } })
  } catch (error) {
    sink.destroy()
    await rm(destination, { force: true })
    throw error
  }
}
