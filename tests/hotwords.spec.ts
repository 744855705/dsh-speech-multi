import { describe, expect, it } from 'vitest'
import { BUILTIN_HOTWORDS, mergeHotwords, phrasesFor, promptFor } from '../src/hotwords.ts'

describe('mergeHotwords', () => {
  it('carries the built-in developer vocabulary', () => {
    expect(BUILTIN_HOTWORDS.length).toBeGreaterThan(100)
    expect(mergeHotwords()).toContain('Kubernetes')
    expect(mergeHotwords()).toContain('微调')
  })

  it('appends caller terms and drops blank ones', () => {
    const merged = mergeHotwords([' 飞书 ', '', '   '])
    expect(merged.at(-1)).toBe('飞书')
    expect(merged).not.toContain('')
  })

  it('lets a caller correct the spelling of a built-in term', () => {
    const merged = mergeHotwords(['MySQL'])
    expect(merged.filter((term) => term.toLowerCase() === 'mysql')).toEqual(['MySQL'])
  })
})

describe('promptFor', () => {
  it('joins with an enumeration comma so the model reads it as a list', () => {
    expect(promptFor(['commit', '索引'])).toBe('commit、索引')
  })

  it('is empty when there is nothing to add', () => {
    expect(promptFor([])).toBe('')
  })
})

describe('phrasesFor', () => {
  it('separates phrases with a slash, the sherpa convention', () => {
    expect(phrasesFor(['commit', 'merge'])).toBe('commit/merge')
  })

  it('drops a term that would break the separator', () => {
    expect(phrasesFor(['a/b', 'commit'])).toBe('commit')
  })
})
