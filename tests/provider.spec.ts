import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findModel } from '../src/catalog.ts'
import { Config } from '../src/config.ts'
import { ModelProvider } from '../src/provider.ts'
import { loadManifest } from '../src/runtime/assets.ts'

/** Minimal host context: the probe must never reach the subprocess or the network. */
function fakeContext() {
  const warnings: string[] = []
  return {
    warnings,
    ctx: {
      logger: {
        info: () => {},
        warn: (message: string) => { warnings.push(message) },
      },
      subprocess: {
        spawn: () => { throw new Error('the probe must not start a worker') },
      },
    } as never,
  }
}

/** Wait for the provider to settle out of the checking phase. */
async function settle(provider: ModelProvider, limitMs = 3000): Promise<string> {
  const started = Date.now()
  for (;;) {
    const phase = provider.snapshot().phase
    if (phase !== 'checking') return phase
    if (Date.now() - started > limitMs) throw new Error(`provider stayed in ${phase}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

let dataRoot: string

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'speech-multi-probe-'))
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
})

describe('activation probe', () => {
  it('reports unprepared without downloading anything', async () => {
    const { ctx } = fakeContext()
    // An unreachable release host: any attempt to fetch would surface as a failure.
    const config = Config({ dataRoot, releaseBaseUrl: 'https://127.0.0.1:9/releases/models-v1' })
    const model = findModel('multi-xasr')
    if (model === undefined) throw new Error('catalog is missing multi-xasr')
    const provider = new ModelProvider(ctx, config, model, {
      manifest: loadManifest(),
      deviceTier: 'large',
      maxRecordingSeconds: 300,
    })
    provider.inspect()
    await expect(settle(provider)).resolves.toBe('unprepared')
    expect(provider.snapshot().phase).not.toBe('failed')
    expect(await readdir(dataRoot)).toEqual([])
    await provider.dispose()
  })

  it('stays unprepared for every registered model', async () => {
    const { ctx } = fakeContext()
    const config = Config({ dataRoot, releaseBaseUrl: 'https://127.0.0.1:9/releases/models-v1' })
    const providers = ['multi-xasr', 'multi-funasr', 'multi-qwen3', 'multi-firered'].map((id) => {
      const model = findModel(id)
      if (model === undefined) throw new Error(`catalog is missing ${id}`)
      return new ModelProvider(ctx, config, model, {
        manifest: loadManifest(),
        deviceTier: 'large',
        maxRecordingSeconds: 300,
      })
    })
    for (const provider of providers) provider.inspect()
    for (const provider of providers) await expect(settle(provider)).resolves.toBe('unprepared')
    expect(await readdir(dataRoot)).toEqual([])
    for (const provider of providers) await provider.dispose()
  })
})
