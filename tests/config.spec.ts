import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_RELEASE_BASE_URL, defaultDataRoot, validateConfig } from '../src/config.ts'
import { modelIds } from '../src/catalog.ts'

/** Build a validated configuration with overrides applied on top of the schema defaults. */
function config(overrides: Record<string, unknown> = {}) {
  return Config({ ...overrides }) as ReturnType<typeof Config> extends never ? never : any
}

describe('release URL', () => {
  it('points at an HTTPS release without credentials', () => {
    const url = new URL(DEFAULT_RELEASE_BASE_URL)
    expect(url.protocol).toBe('https:')
    expect(url.username).toBe('')
    expect(url.password).toBe('')
    expect(url.pathname.endsWith('/models-v1')).toBe(true)
  })

  it('rejects a plain-HTTP release URL', () => {
    expect(() => validateConfig(config({ releaseBaseUrl: 'http://example.test/releases/models-v1' })))
      .toThrow(/HTTPS/u)
  })
})

describe('validateConfig', () => {
  it('accepts the defaults', () => {
    expect(() => validateConfig(config())).not.toThrow()
  })

  it('registers every model by default, best first', () => {
    expect(config().enabledModels).toEqual([...modelIds()])
  })

  it('rejects a relative data root', () => {
    expect(() => validateConfig(config({ dataRoot: 'relative/path' }))).toThrow(/absolute/u)
  })

  it('rejects an unknown model id', () => {
    expect(() => validateConfig(config({ enabledModels: ['multi-ghost'] }))).toThrow(/does not register/u)
  })

  it('rejects an empty model list', () => {
    expect(() => validateConfig(config({ enabledModels: [] }))).toThrow(/at least one model/u)
  })

  it('keeps an idle worker for two hours by default', () => {
    expect(config().idleTimeoutMs).toBe(7_200_000)
  })

  it('resolves the shared cache under the harness home', () => {
    expect(defaultDataRoot({ DSH_HOME: '/tmp/harness' }, '/home/x')).toBe('/tmp/harness/speech-to-text/multi')
  })
})
