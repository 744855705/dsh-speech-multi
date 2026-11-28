import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assetFor, assetUrl, loadManifest } from '../src/runtime/assets.ts'
import { MIN_SEGMENTED_BYTES } from '../src/runtime/download.ts'
import { joinParts } from '../src/runtime/prepare.ts'

const BASE = 'https://github.com/owner/repo/releases/download/models-v1'

describe('assetUrl', () => {
  it('keeps the default release when the entry names none', () => {
    expect(assetUrl(BASE, { sha256: 'a'.repeat(64), bytes: 1 }, 'vad.tar.zst'))
      .toBe(`${BASE}/vad.tar.zst`)
  })

  it('swaps in the entry release, so one manifest can span two releases', () => {
    expect(assetUrl(BASE, { sha256: 'a'.repeat(64), bytes: 1, release: 'models-v2' }, 'x.tar.zst'))
      .toBe('https://github.com/owner/repo/releases/download/models-v2/x.tar.zst')
  })

  it('builds a part URL from the part name', () => {
    const record = {
      sha256: 'a'.repeat(64),
      bytes: 10,
      release: 'models-v2',
      parts: [{ name: 'x.tar.zst.part1', sha256: 'b'.repeat(64), bytes: 10 }],
    }
    expect(assetUrl(BASE, record, 'x.tar.zst.part1'))
      .toBe('https://github.com/owner/repo/releases/download/models-v2/x.tar.zst.part1')
  })

  it('tolerates a trailing slash on the configured base', () => {
    expect(assetUrl(`${BASE}/`, undefined, 'vad.tar.zst')).toBe(`${BASE}/vad.tar.zst`)
  })
})

describe('shipped manifest', () => {
  const manifest = loadManifest()

  it('splits an archive only when its parts add up to the published length', () => {
    for (const [name, record] of Object.entries(manifest.files)) {
      if (record.parts === undefined) continue
      const total = record.parts.reduce((sum, part) => sum + part.bytes, 0)
      expect(total, `${name} parts must sum to the archive length`).toBe(record.bytes)
    }
  })

  it('keeps every part inside the release asset ceiling', () => {
    const ceiling = 2 * 1024 ** 3
    for (const record of Object.values(manifest.files)) {
      for (const part of record.parts ?? []) {
        expect(part.bytes).toBeLessThan(ceiling)
      }
    }
  })

  it('publishes the GPU archives under their own release', () => {
    const gpu = Object.entries(manifest.files).filter(([name]) => name.startsWith('qwen3-asr-'))
    expect(gpu.length).toBe(4)
    for (const [name, record] of gpu) {
      expect(record.release, `${name} must not be fetched from the CPU release`).toBe('models-v2')
    }
  })

  it('lists the pinned llama.cpp source next to the models', () => {
    expect(assetFor(manifest, 'llama.cpp-1.1.0.zip').release).toBe('models-v2')
  })
})

describe('joinParts', () => {
  const created: string[] = []

  afterEach(async () => {
    for (const directory of created.splice(0)) await rm(directory, { recursive: true, force: true })
  })

  it('rebuilds an archive from its slices and accepts the published digest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'parts-'))
    created.push(directory)
    const slices = ['first-half', 'second-half'].map((name, index) => join(directory, `${index}.part`))
    await writeFile(slices[0] as string, 'first-half')
    await writeFile(slices[1] as string, 'second-half')
    const whole = Buffer.from('first-halfsecond-half')
    const destination = join(directory, 'joined.tar.zst')
    await joinParts(slices, destination, {
      sha256: createHash('sha256').update(whole).digest('hex'),
      bytes: whole.length,
    })
    expect(await readFile(destination, 'utf8')).toBe('first-halfsecond-half')
  })

  it('rejects a join whose digest does not match, leaving nothing behind', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'parts-'))
    created.push(directory)
    const slice = join(directory, '0.part')
    await writeFile(slice, 'truncated')
    const destination = join(directory, 'joined.tar.zst')
    await expect(joinParts([slice], destination, { sha256: 'a'.repeat(64), bytes: 9 })).rejects.toThrow()
    await expect(readFile(destination, 'utf8')).rejects.toThrow()
  })
})

describe('segmented download planning', () => {
  it('only splits archives large enough to gain from it', () => {
    // The threshold lives in the module so the rule is visible next to the code that applies it.
    expect(MIN_SEGMENTED_BYTES).toBe(64 * 1024 * 1024)
  })
})
