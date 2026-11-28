import { describe, expect, it } from 'vitest'
import { availableModels, classifyDevice, tierPolicy } from '../src/device.ts'

const GIB = 1024 ** 3

describe('classifyDevice', () => {
  it('treats an unreadable memory figure as the light tier', () => {
    expect(classifyDevice(0)).toBe('light')
    expect(classifyDevice(Number.NaN)).toBe('light')
  })

  it('splits at 8 and 16 GiB', () => {
    expect(classifyDevice(7 * GIB)).toBe('light')
    expect(classifyDevice(8 * GIB)).toBe('standard')
    expect(classifyDevice(15 * GIB)).toBe('standard')
    expect(classifyDevice(16 * GIB)).toBe('large')
    expect(classifyDevice(64 * GIB)).toBe('large')
  })
})

describe('tierPolicy', () => {
  it('keeps the long-recording ceiling for the largest tier', () => {
    expect(tierPolicy('light').maxRecordingSeconds).toBe(60)
    expect(tierPolicy('standard').maxRecordingSeconds).toBe(120)
    expect(tierPolicy('large').maxRecordingSeconds).toBe(300)
  })

  it('offers the same two decoders on every tier, which differ only by ceiling', () => {
    for (const tier of ['light', 'standard', 'large'] as const) {
      expect(tierPolicy(tier).models).toEqual(['multi-xasr', 'multi-funasr'])
    }
  })
})

describe('availableModels', () => {
  it('keeps requested order and drops unknown ids', () => {
    expect(availableModels(['multi-funasr', 'multi-xasr'], 'standard')).toEqual(['multi-funasr', 'multi-xasr'])
    expect(availableModels(['multi-ghost', 'multi-xasr'], 'light')).toEqual(['multi-xasr'])
  })

  it('falls back to the tier leader when nothing requested fits', () => {
    expect(availableModels(['multi-ghost'], 'light')).toEqual(['multi-xasr'])
  })
})
