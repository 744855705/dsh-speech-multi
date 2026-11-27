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
  it('keeps the light tier to one minute and everything else to two', () => {
    expect(tierPolicy('light').maxRecordingSeconds).toBe(60)
    expect(tierPolicy('standard').maxRecordingSeconds).toBe(120)
    expect(tierPolicy('large').maxRecordingSeconds).toBe(120)
  })

  it('adds Qwen3 before FireRed, because it peaks lower at this ceiling', () => {
    expect(tierPolicy('light').models).toEqual(['multi-xasr', 'multi-funasr'])
    expect(tierPolicy('standard').models).toEqual(['multi-xasr', 'multi-funasr', 'multi-qwen3'])
    expect(tierPolicy('large').models).toHaveLength(4)
    expect(tierPolicy('large').models).toContain('multi-firered')
  })
})

describe('availableModels', () => {
  it('keeps requested order and drops what the tier cannot run', () => {
    expect(availableModels(['multi-firered', 'multi-xasr'], 'standard')).toEqual(['multi-xasr'])
    expect(availableModels(['multi-qwen3', 'multi-xasr'], 'standard')).toEqual(['multi-qwen3', 'multi-xasr'])
  })

  it('falls back to the tier leader when nothing requested fits', () => {
    expect(availableModels(['multi-qwen3'], 'light')).toEqual(['multi-xasr'])
  })
})
