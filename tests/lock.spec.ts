import { describe, expect, it } from 'vitest'
import { installLock, parseLock, type LockSpeechService } from '../src/lock.ts'
import type { ModelId } from '../src/catalog.ts'

const ALL: ModelId[] = ['multi-xasr', 'multi-funasr', 'multi-qwen3', 'multi-firered']

/**
 * In-memory speech service that records every selection change.
 *
 * `configure` is the method that reaches the settings service and writes the profile's
 * `cordis.patch.yml`, so the count of calls is the regression signal: a lock that calls it
 * leaves permanent state behind after the plugin is removed.
 */
function fakeService(initial: string): { service: LockSpeechService; calls: string[] } {
  const calls: string[] = []
  let selection = initial
  const service: LockSpeechService = {
    snapshot: () => ({ selection: { providerId: selection } }),
    configure: async (patch) => {
      calls.push(patch.providerId ?? '')
      if (patch.providerId !== undefined) selection = patch.providerId
    },
    resolve: (request) => request,
  }
  return { service, calls }
}

const silent = { warn: () => {} }

describe('parseLock', () => {
  it('accepts schema 2 and defaults the whitelist to every registered model', () => {
    const lock = parseLock({ schema: 2, mode: 'hard', modelId: 'multi-funasr' }, ALL)
    expect(lock).toEqual({ schema: 2, mode: 'hard', modelId: 'multi-funasr', allow: ALL })
  })

  it('narrows the whitelist only when the file lists models', () => {
    const lock = parseLock({ schema: 2, mode: 'hard', modelId: 'multi-xasr', allow: ['multi-xasr'] }, ALL)
    expect(lock?.allow).toEqual(['multi-xasr'])
  })

  it('forces the target into a whitelist that omits it', () => {
    const lock = parseLock({ schema: 2, mode: 'hard', modelId: 'multi-funasr', allow: ['multi-xasr'] }, ALL)
    expect(lock?.allow).toEqual(['multi-funasr', 'multi-xasr'])
  })

  it('drops ids the catalog does not know', () => {
    const lock = parseLock({ schema: 2, modelId: 'multi-xasr', allow: ['multi-xasr', 'multi-ghost'] }, ALL)
    expect(lock?.allow).toEqual(['multi-xasr'])
  })

  it('defaults the mode to soft', () => {
    expect(parseLock({ schema: 2, modelId: 'multi-xasr' }, ALL)?.mode).toBe('soft')
  })

  it('rejects the previous schema', () => {
    expect(parseLock({ providerId: 'firered-local', mode: 'soft' }, ALL)).toBeUndefined()
  })

  it('rejects an unknown target', () => {
    expect(parseLock({ schema: 2, modelId: 'multi-ghost' }, ALL)).toBeUndefined()
  })

  it('rejects a non-object', () => {
    expect(parseLock(['multi-xasr'], ALL)).toBeUndefined()
  })
})

describe('installLock', () => {
  it('never writes a selection, so uninstalling the plugin leaves no trace', () => {
    const { service, calls } = fakeService('multi-qwen3')
    const release = installLock({ speechToText: service, logger: silent }, {
      schema: 2, mode: 'soft', modelId: 'multi-xasr', allow: ['multi-xasr'],
    })
    expect(calls).toEqual([])
    release()
    expect(calls).toEqual([])
  })

  it('reports the locked model without changing the stored selection', () => {
    const { service, calls } = fakeService('multi-qwen3')
    const release = installLock({ speechToText: service, logger: silent }, {
      schema: 2, mode: 'soft', modelId: 'multi-xasr', allow: ['multi-xasr'],
    })
    expect(service.snapshot().selection.providerId).toBe('multi-xasr')
    expect(calls).toEqual([])
    release()
    expect(service.snapshot().selection.providerId).toBe('multi-qwen3')
  })

  it('routes resolution to the locked model', () => {
    const { service } = fakeService('multi-funasr')
    const release = installLock({ speechToText: service, logger: silent }, {
      schema: 2, mode: 'soft', modelId: 'multi-xasr', allow: ['multi-xasr'],
    })
    expect(service.resolve({})).toMatchObject({ providerId: 'multi-xasr' })
    release()
    expect(service.resolve({})).toEqual({})
  })

  it('rejects outside selections in hard mode and restores on release', async () => {
    const { service, calls } = fakeService('multi-xasr')
    const originalConfigure = service.configure
    const release = installLock({ speechToText: service, logger: silent }, {
      schema: 2, mode: 'hard', modelId: 'multi-xasr', allow: ['multi-xasr', 'multi-funasr'],
    })
    await expect(service.configure({ providerId: 'multi-qwen3' })).rejects.toThrow(/whitelist/u)
    expect(calls).toEqual([])
    await expect(service.configure({ providerId: 'multi-funasr' })).resolves.toBeUndefined()
    expect(calls).toEqual(['multi-funasr'])
    release()
    expect(service.configure).toBe(originalConfigure)
    expect(service.snapshot().selection.providerId).toBe('multi-funasr')
  })

  it('is safe to release twice', () => {
    const { service } = fakeService('multi-xasr')
    const release = installLock({ speechToText: service, logger: silent }, {
      schema: 2, mode: 'hard', modelId: 'multi-xasr', allow: ['multi-xasr'],
    })
    release()
    expect(() => release()).not.toThrow()
  })
})
