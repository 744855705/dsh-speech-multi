/**
 * Minimal reader for the release archives.
 *
 * Node can decompress zstd but has no tar reader, and shelling out to `tar` would break the
 * Windows and Android targets. Only the two entry kinds the packaging produces are handled:
 * directories and regular files. Entry names are validated so an archive can never write
 * outside its destination.
 */
import { createReadStream } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { createZstdDecompress } from 'node:zlib'

const BLOCK = 512
const TYPE_DIR = 0x35
const TYPE_FILE = 0x30
const TYPE_OLD_FILE = 0x00

/** One file currently being written. */
interface Pending {
  readonly target: string
  remaining: number
  padding: number
}

/** Read a NUL-terminated ASCII field. */
function field(header: Buffer, start: number, length: number): string {
  const slice = header.subarray(start, start + length)
  const end = slice.indexOf(0)
  return slice.toString('utf8', 0, end < 0 ? slice.length : end)
}

/** Read an octal size field. */
function octal(header: Buffer, start: number, length: number): number {
  const text = field(header, start, length).trim()
  return text.length === 0 ? 0 : Number.parseInt(text, 8)
}

/** Whether a block is the zero terminator. */
function isZero(block: Buffer): boolean {
  for (const byte of block) if (byte !== 0) return false
  return true
}

/**
 * Expand one `.tar.zst` archive.
 * @param archivePath - archive to read.
 * @param destination - directory entries are written under.
 * @returns after every entry has been written.
 * @throws when an entry escapes the destination.
 */
export async function extractTarZst(archivePath: string, destination: string): Promise<void> {
  const root = resolve(destination)
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  const source = createReadStream(archivePath).pipe(createZstdDecompress())
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  let pending: Pending | undefined
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    for await (const chunk of source) {
      let data = buffer.length === 0 ? (chunk as Buffer) : Buffer.concat([buffer, chunk as Buffer])
      let offset = 0
      for (;;) {
        if (pending !== undefined) {
          const take = Math.min(pending.remaining, data.length - offset)
          if (take > 0) {
            await handle?.write(data, offset, take)
            offset += take
            pending.remaining -= take
          }
          if (pending.remaining > 0) break
          const skip = Math.min(pending.padding, data.length - offset)
          pending.padding -= skip
          offset += skip
          if (pending.padding > 0) break
          await handle?.close()
          handle = undefined
          pending = undefined
          continue
        }
        if (data.length - offset < BLOCK) break
        const header = data.subarray(offset, offset + BLOCK)
        if (isZero(header)) return
        const name = field(header, 0, 100)
        const size = octal(header, 124, 12)
        const type = header[156] ?? TYPE_OLD_FILE
        const padded = Math.ceil(size / BLOCK) * BLOCK
        offset += BLOCK
        if (name.length === 0) continue
        const target = resolve(prefix, name.replace(/\/+$/u, ''))
        if (target !== root && !target.startsWith(prefix)) throw new Error(`archive entry escapes the destination: ${name}`)
        if (type === TYPE_DIR) {
          await mkdir(target, { recursive: true })
          continue
        }
        if (type !== TYPE_FILE && type !== TYPE_OLD_FILE) continue
        await mkdir(dirname(target), { recursive: true })
        handle = await open(target, 'w')
        pending = { target, remaining: size, padding: padded - size }
      }
      buffer = data.subarray(offset) as Buffer<ArrayBufferLike>
    }
  } finally {
    await handle?.close()
    source.destroy()
  }
}
