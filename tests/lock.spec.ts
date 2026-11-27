import { describe, expect, it } from 'vitest'
import { installLock, parseLock, type LockSpeechService } from '../src/lock.ts'
import type { ModelId } from '../src/catalog.ts'

const ALL: ModelId[] = ['multi-xasr', 'multi-funasr', 'multi-qwen3', 'multi-firered']

/** In-memory speech service that records selection changes. */
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
    follow: async function* () {
      return
    },
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

  it('keeps a declared whitelist and forces the target into it', () => {
    const lock = parseLock({ schema: 2, mode: 'hard', modelId: 'multi-qwen3', allow: ['multi-xasr'] }, ALL)
    expect(lock?.allow).toEqual(['multi-qwen3', 'multi-xasr'])
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
  it('leaves a matching selection alone', () => {
    const { service, calls } = fakeService('multi-xasr')
    const release = installLock({ speechToText: service, logger: silent }, {
      schema: 2, mode: 'soft', modelId: 'multi-xasr', allow: ['multi-xasr'],
    })
    expect(calls).toEqual([])
    release()
  })

  it('reasserts the locked model when another one is selected', () => {
    const { service, calls } = fakeService('multi-qwen3')
    const release = installLock({ speechToText: service, logger: silent }, {
      schema: 2, mode: 'soft', modelId: 'multi-xasr', allow: ['multi-xasr'],
    })
    expect(calls).toEqual(['multi-xasr'])
    release()
  })

  it('rejects selections outside the whitelist in hard mode and restores on release', async () => {
    const { service } = fakeService('multi-xasr')
    const original = service.configure
    const release = installLock({ speechToText: service, logger: silent }, {
      schema: 2, mode: 'hard', modelId: 'multi-xasr', allow: ['multi-xasr', 'multi-funasr'],
    })
    await expect(service.configure({ providerId: 'multi-qwen3' })).rejects.toThrow(/whitelist/u)
    await expect(service.configure({ providerId: 'multi-funasr' })).resolves.toBeUndefined()
    expect(service.resolve({})).toMatchObject({ providerId: 'multi-xasr' })
    release()
    expect(service.configure).toBe(original)
  })
})
