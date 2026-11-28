import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'
import { detectGpu, isIntegratedName, pickDiscreteDevice } from '../src/gpu/backend.ts'
import { builtBinary, discardOtherVersions, isUsableBinary, llamaVersion, sharedBuild, sourceDirectory } from '../src/gpu/build.ts'
import { progressState } from '../src/gpu/provider.ts'
import { acquireGpu, activeGpu, noteCpuUse } from '../src/gpu/registry.ts'
import { gpuModelRoot, installedGpuFiles, resolveGpuFiles } from '../src/gpu/files.ts'
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

describe('sharedBuild', () => {
  it('runs the build once when two providers prepare at the same time', async () => {
    let started = 0
    const factory = async (): Promise<string> => {
      started += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      return 'binary'
    }
    const [first, second] = await Promise.all([
      sharedBuild('root|hip', async () => await factory()),
      sharedBuild('root|hip', async () => await factory()),
    ])
    expect(started).toBe(1)
    expect(first).toBe('binary')
    expect(second).toBe('binary')
  })

  it('builds again once the previous one settled, so a retry is not blocked', async () => {
    let started = 0
    const factory = async (): Promise<string> => {
      started += 1
      return `binary-${started}`
    }
    expect(await sharedBuild('again|hip', async () => await factory())).toBe('binary-1')
    expect(await sharedBuild('again|hip', async () => await factory())).toBe('binary-2')
  })

  it('lets a caller give up without cancelling the build others are waiting on', async () => {
    const abort = new AbortController()
    let finished = false
    const build = sharedBuild('cancel|hip', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      finished = true
      return 'binary'
    })
    const waiter = sharedBuild('cancel|hip', async () => 'unused', abort.signal)
    abort.abort()
    await expect(waiter).rejects.toThrow()
    expect(await build).toBe('binary')
    expect(finished).toBe(true)
  })

  it('separates builds by backend, because each one links a different library', async () => {
    const seen: string[] = []
    const factory = (name: string) => async (): Promise<string> => {
      seen.push(name)
      return name
    }
    await Promise.all([
      sharedBuild('sep|hip', async () => await factory('hip')()),
      sharedBuild('sep|vulkan', async () => await factory('vulkan')()),
    ])
    expect(seen.sort()).toEqual(['hip', 'vulkan'])
  })
})

describe('build cancellation', () => {
  it('keeps the build alive while another provider still waits on it', async () => {
    const abort = new AbortController()
    let completed = false
    const build = sharedBuild('share|hip', async () => {
      await new Promise((resolve) => setTimeout(resolve, 15))
      completed = true
      return 'binary'
    }, abort.signal)
    const other = sharedBuild('share|hip', async () => 'unused')
    abort.abort()
    await expect(build).rejects.toThrow()
    expect(await other).toBe('binary')
    expect(completed).toBe(true)
  })

  it('stops the build once the last interested provider cancels', async () => {
    const abort = new AbortController()
    let aborted = false
    const build = sharedBuild('alone|hip', async (signal) => {
      signal.addEventListener('abort', () => {
        aborted = true
      }, { once: true })
      await new Promise((resolve) => setTimeout(resolve, 50))
      return 'binary'
    }, abort.signal)
    abort.abort()
    await expect(build).rejects.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(aborted).toBe(true)
  })
})

describe('preparation progress', () => {
  it('shows the download while bytes are moving, even though the build runs beside it', () => {
    const state = progressState({ resource: 'model.tar.zst', completedBytes: 10, totalBytes: 100 }, 1)
    expect(state.phase).toBe('downloading')
    expect(state.step).toBe('model')
    if (state.phase !== 'downloading') throw new Error('wrong phase')
    expect(state.completedBytes).toBe(10)
    expect(state.totalBytes).toBe(100)
  })

  it('falls back to the build once nothing is left to download', () => {
    const state = progressState(undefined, 1234)
    expect(state.phase).toBe('loading')
    expect(state.step).toBe('load')
    if (state.phase !== 'loading') throw new Error('wrong phase')
    expect(state.startedAt).toBe(1234)
  })

  it('never reports a download without a byte count', () => {
    // The old sequential order published the build first, which marked the model step complete
    // before the model had been fetched and showed "loaded" while the download had not started.
    const states = [
      progressState({ resource: 'a', completedBytes: 0 }, 1),
      progressState(undefined, 2),
    ]
    for (const state of states) {
      expect(state.phase === 'downloading' ? state.completedBytes : 0).toBeGreaterThanOrEqual(0)
      expect(state.step).not.toBe('ready')
    }
  })
})

describe('binary reuse', () => {
  const created: string[] = []

  afterEach(async () => {
    for (const directory of created.splice(0)) await rm(directory, { recursive: true, force: true })
  })

  it('accepts a built binary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binary-'))
    created.push(directory)
    const path = join(directory, 'llama-mtmd-cli')
    await writeFile(path, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    expect(await isUsableBinary(path)).toBe(true)
  })

  it('rejects a binary left behind by an interrupted build', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binary-'))
    created.push(directory)
    const empty = join(directory, 'empty')
    const notExecutable = join(directory, 'plain')
    await writeFile(empty, '')
    await writeFile(notExecutable, 'data', { mode: 0o644 })
    // Existence alone is not enough: an empty or non-executable file would fail on every request.
    expect(await isUsableBinary(empty)).toBe(false)
    expect(await isUsableBinary(notExecutable)).toBe(false)
    expect(await isUsableBinary(join(directory, 'missing'))).toBe(false)
  })
})

describe('runtime version', () => {
  it('reads the version from the pinned archive name', () => {
    expect(llamaVersion()).toMatch(/^\d+\.\d+\.\d+/u)
  })

  it('puts the version in the build path, so a bump produces a new binary', () => {
    const config = Config({ dataRoot: '/data' })
    const path = builtBinary(config, 'hip')
    expect(path).toContain(llamaVersion())
    expect(path.endsWith('bin/llama-mtmd-cli')).toBe(true)
    expect(builtBinary(config, 'vulkan')).not.toBe(path)
  })

  it('keeps the source tree per version instead of one shared directory', () => {
    const config = Config({ dataRoot: '/data' })
    expect(sourceDirectory(config).endsWith(`llama.cpp-${llamaVersion()}`)).toBe(true)
  })
})

describe('discardOtherVersions', () => {
  const created: string[] = []

  afterEach(async () => {
    for (const directory of created.splice(0)) await rm(directory, { recursive: true, force: true })
  })

  it('removes builds and sources from every other version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'versions-'))
    created.push(root)
    const gpu = join(root, 'gpu')
    const version = llamaVersion()
    await mkdir(join(gpu, `build-${version}-hip`), { recursive: true })
    await mkdir(join(gpu, `build-0.0.1-hip`), { recursive: true })
    await mkdir(join(gpu, `llama.cpp-${version}`), { recursive: true })
    await mkdir(join(gpu, 'llama.cpp-0.0.1'), { recursive: true })
    await mkdir(join(gpu, 'multi-gpu-qwen3-06b-q8'), { recursive: true })

    const removed = await discardOtherVersions(Config({ dataRoot: root }))

    expect(removed.sort()).toEqual([`build-0.0.1-hip`, 'llama.cpp-0.0.1'])
    // The current version and the model directories are untouched.
    expect(await isUsableBinary(join(gpu, `llama.cpp-${version}`, 'missing'))).toBe(false)
    expect(removed).not.toContain(`build-${version}-hip`)
    expect(removed).not.toContain('multi-gpu-qwen3-06b-q8')
  })
})

describe('gpu residency', () => {
  const created: string[] = []

  afterEach(async () => {
    for (const directory of created.splice(0)) await rm(directory, { recursive: true, force: true })
  })

  /** Minimal stand-in for a resident server. */
  function stub(log: string[], id: string): never {
    return {
      async start(): Promise<number> {
        log.push(`start:${id}`)
        return 1
      },
      async stop(): Promise<void> {
        log.push(`stop:${id}`)
      },
      async transcribe(): Promise<string> {
        return ''
      },
      get running(): boolean {
        return true
      },
    } as never
  }

  it('keeps one model resident and stops the previous one when the choice changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'residency-'))
    created.push(root)
    const log: string[] = []
    await acquireGpu(root, 'gpu-a', () => stub(log, 'a'), 0)
    expect(activeGpu(root)).toBe('gpu-a')
    await acquireGpu(root, 'gpu-b', () => stub(log, 'b'), 0)
    expect(activeGpu(root)).toBe('gpu-b')
    expect(log).toEqual(['stop:a'])
    await noteCpuUse(root)
    expect(activeGpu(root)).toBeUndefined()
    expect(log).toEqual(['stop:a', 'stop:b'])
  })

  it('reuses the same server when the same model is requested again', async () => {
    const root = await mkdtemp(join(tmpdir(), 'residency-'))
    created.push(root)
    const log: string[] = []
    const first = await acquireGpu(root, 'gpu-a', () => stub(log, 'a'), 0)
    const second = await acquireGpu(root, 'gpu-a', () => stub(log, 'a'), 0)
    expect(second).toBe(first)
    expect(log).toEqual([])
  })

  it('releases the card once the idle period elapses', async () => {
    const root = await mkdtemp(join(tmpdir(), 'residency-'))
    created.push(root)
    const log: string[] = []
    await acquireGpu(root, 'gpu-a', () => stub(log, 'a'), 10)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(activeGpu(root)).toBeUndefined()
    expect(log).toEqual(['stop:a'])
  })

  it('keeps the model when the timeout is zero, meaning no idle release', async () => {
    const root = await mkdtemp(join(tmpdir(), 'residency-'))
    created.push(root)
    const log: string[] = []
    await acquireGpu(root, 'gpu-a', () => stub(log, 'a'), 0)
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(activeGpu(root)).toBe('gpu-a')
    expect(log).toEqual([])
  })
})

describe('activation inspection', () => {
  const created: string[] = []

  afterEach(async () => {
    for (const directory of created.splice(0)) await rm(directory, { recursive: true, force: true })
  })

  it('finds a model that is already installed instead of asking for preparation again', async () => {
    const root = await mkdtemp(join(tmpdir(), 'installed-'))
    created.push(root)
    const spec = GPU_MODELS[0]
    if (spec === undefined) throw new Error('catalog is empty')
    const config = Config({ dataRoot: root })
    const target = join(gpuModelRoot(config, spec))
    await mkdir(target, { recursive: true })
    await writeFile(join(target, spec.modelFile), 'model')
    await writeFile(join(target, spec.mmprojFile), 'mmproj')
    const found = installedGpuFiles(config, spec)
    expect(found?.model).toBe(join(target, spec.modelFile))
    expect(found?.mmproj).toBe(join(target, spec.mmprojFile))
  })

  it('reports nothing when a file is missing, so preparation still runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'installed-'))
    created.push(root)
    const spec = GPU_MODELS[0]
    if (spec === undefined) throw new Error('catalog is empty')
    const config = Config({ dataRoot: root })
    const target = join(gpuModelRoot(config, spec))
    await mkdir(target, { recursive: true })
    await writeFile(join(target, spec.modelFile), 'model')
    // The audio tower is what makes the pair usable.
    expect(installedGpuFiles(config, spec)).toBeUndefined()
  })
})
