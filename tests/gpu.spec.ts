import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'
import { detectGpu, isIntegratedName, pickDiscreteDevice } from '../src/gpu/backend.ts'
import { resolveGpuFiles } from '../src/gpu/files.ts'
import { parseTranscript } from '../src/gpu/run.ts'
import { CONTEXT_LONG, CONTEXT_SHORT, GPU_MODELS, contextFor, runnableGpuModels } from '../src/gpu/spec.ts'
import { loadManifest } from '../src/runtime/assets.ts'

const GB = 1_000_000_000

describe('gpu model set', () => {
  it('offers four models, the largest first', () => {
    expect(GPU_MODELS.map((spec) => spec.id)).toEqual([
      'multi-gpu-qwen3-1.7b-bf16',
      'multi-gpu-qwen3-1.7b-q8',
      'multi-gpu-qwen3-06b-bf16',
      'multi-gpu-qwen3-06b-q8',
    ])
  })

  it('orders them by the memory they need, not by disk size', () => {
    const required = GPU_MODELS.map((spec) => spec.requiredBytes)
    expect([...required].sort((left, right) => right - left)).toEqual(required)
  })

  it('publishes an archive for every model', () => {
    const manifest = loadManifest()
    for (const spec of GPU_MODELS) {
      expect(manifest.files[spec.archive], `missing archive for ${spec.id}`).toBeDefined()
    }
  })

  it('names the files the archive actually contains', () => {
    // The packaged archives hold the GGUF files at their root under exactly these names.
    for (const spec of GPU_MODELS) {
      expect(spec.modelFile.endsWith('.gguf')).toBe(true)
      expect(spec.mmprojFile.startsWith('mmproj-')).toBe(true)
    }
  })
})

describe('runnableGpuModels', () => {
  it('offers only what fits', () => {
    expect(runnableGpuModels(2.0 * GB)).toEqual([])
    expect(runnableGpuModels(2.2 * GB).map((spec) => spec.id)).toEqual(['multi-gpu-qwen3-06b-q8'])
    expect(runnableGpuModels(4 * GB).map((spec) => spec.id)).toEqual([
      'multi-gpu-qwen3-1.7b-q8',
      'multi-gpu-qwen3-06b-bf16',
      'multi-gpu-qwen3-06b-q8',
    ])
    expect(runnableGpuModels(24 * GB)).toHaveLength(4)
  })

  it('keeps the precision choice when both fit', () => {
    // Q8_0 output measured identical to BF16, so neither is hidden behind the other.
    const runnable = runnableGpuModels(24 * GB).map((spec) => spec.id)
    expect(runnable).toContain('multi-gpu-qwen3-1.7b-bf16')
    expect(runnable).toContain('multi-gpu-qwen3-1.7b-q8')
  })
})

describe('contextFor', () => {
  it('halves the context for a short recording', () => {
    expect(contextFor(60)).toBe(CONTEXT_SHORT)
    expect(contextFor(120)).toBe(CONTEXT_SHORT)
    expect(contextFor(121)).toBe(CONTEXT_LONG)
    expect(contextFor(300)).toBe(CONTEXT_LONG)
  })
})

describe('parseTranscript', () => {
  it('drops the language tag the model prefixes', () => {
    expect(parseTranscript('\nlanguage Chinese<asr_text>我这边在排查一个线上的性能问题。\n\n')).toBe('我这边在排查一个线上的性能问题。')
  })

  it('keeps a transcript that carries no framing', () => {
    expect(parseTranscript('我这边在排查一个线上的性能问题。\n')).toBe('我这边在排查一个线上的性能问题。')
  })

  it('returns an empty string when the runtime said nothing', () => {
    expect(parseTranscript('\n\n')).toBe('')
  })
})

describe('resolveGpuFiles', () => {
  const created: string[] = []

  afterEach(async () => {
    for (const directory of created.splice(0)) await rm(directory, { recursive: true, force: true })
  })

  it('prefers a configured local directory and never downloads', async () => {
    const local = await mkdtemp(join(tmpdir(), 'gpu-local-'))
    created.push(local)
    const spec = GPU_MODELS[0]
    if (spec === undefined) throw new Error('catalog is empty')
    await writeFile(join(local, spec.modelFile), 'model')
    await writeFile(join(local, spec.mmprojFile), 'mmproj')
    const config = Config({ dataRoot: local, gpuLocalRoot: local, releaseBaseUrl: 'https://127.0.0.1:9/releases/models-v2' })
    const files = await resolveGpuFiles({ spec, config, manifest: loadManifest(), signal: new AbortController().signal })
    expect(files.model).toBe(join(local, spec.modelFile))
    expect(files.mmproj).toBe(join(local, spec.mmprojFile))
  })

  it('falls back to the release when the local directory is incomplete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gpu-root-'))
    created.push(root)
    const local = join(root, 'local')
    created.push(local)
    await writeFile(join(root, 'placeholder'), '')
    const spec = GPU_MODELS[0]
    if (spec === undefined) throw new Error('catalog is empty')
    const config = Config({ dataRoot: root, gpuLocalRoot: root, releaseBaseUrl: 'https://127.0.0.1:9/releases/models-v2' })
    await expect(resolveGpuFiles({ spec, config, manifest: loadManifest(), signal: new AbortController().signal }))
      .rejects.toThrow()
  })
})

describe('discrete GPU selection', () => {
  it('recognises an APU reported under the CPU product name', () => {
    expect(isIntegratedName('AMD Ryzen 7 9700X 8-Core Processor')).toBe(true)
    expect(isIntegratedName('AMD Radeon(TM) Graphics')).toBe(true)
    expect(isIntegratedName('AMD Radeon Vega 8 Graphics')).toBe(true)
  })

  it('accepts discrete product names', () => {
    expect(isIntegratedName('AMD Radeon RX 7900 XTX')).toBe(false)
    expect(isIntegratedName('AMD Radeon RX 580 Series')).toBe(false)
    expect(isIntegratedName('NVIDIA GeForce RTX 4090')).toBe(false)
    expect(isIntegratedName('AMD Radeon PRO W6800')).toBe(false)
  })

  it('never selects the integrated device even when its shared memory is larger', () => {
    const chosen = pickDiscreteDevice([
      { name: 'AMD Ryzen 7 9700X 8-Core Processor', vramBytes: 32_000_000_000 },
      { name: 'AMD Radeon RX 7900 XTX', vramBytes: 25_000_000_000 },
    ])
    expect(chosen?.name).toBe('AMD Radeon RX 7900 XTX')
  })

  it('honours the driver device class over the name', () => {
    const chosen = pickDiscreteDevice([
      { name: 'Some Accelerator', vramBytes: 40_000_000_000, integrated: true },
      { name: 'Some Accelerator', vramBytes: 8_000_000_000, integrated: false },
    ])
    expect(chosen?.vramBytes).toBe(8_000_000_000)
  })

  it('reports no device when only integrated ones exist', () => {
    expect(pickDiscreteDevice([{ name: 'AMD Ryzen 7 9700X 8-Core Processor', vramBytes: 2_000_000_000 }])).toBeUndefined()
  })

  it('picks the roomier card when the machine has two', () => {
    const chosen = pickDiscreteDevice([
      { name: 'AMD Radeon RX 6600', vramBytes: 8_000_000_000 },
      { name: 'AMD Radeon RX 7900 XTX', vramBytes: 25_000_000_000 },
    ])
    expect(chosen?.name).toBe('AMD Radeon RX 7900 XTX')
  })

  it('finds this machine\'s discrete card, not its APU', () => {
    const device = detectGpu()
    // The host running the suite has both; a machine without a discrete GPU skips the assertion.
    if (device === undefined) return
    expect(isIntegratedName(device.name)).toBe(false)
  })
})
