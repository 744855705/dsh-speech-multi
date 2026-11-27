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
  it('shortens the recording ceiling as memory shrinks', () => {
    expect(tierPolicy('light').maxRecordingSeconds).toBe(60)
    expect(tierPolicy('standard').maxRecordingSeconds).toBe(120)
    expect(tierPolicy('large').maxRecordingSeconds).toBe(300)
  })

  it('offers every model only on the largest tier', () => {
    expect(tierPolicy('large').models).toHaveLength(4)
    expect(tierPolicy('light').models).toEqual(['multi-xasr', 'multi-funasr'])
  })
})

describe('availableModels', () => {
  it('keeps requested order and drops what the tier cannot run', () => {
    expect(availableModels(['multi-qwen3', 'multi-xasr'], 'standard')).toEqual(['multi-xasr'])
  })

  it('falls back to the tier leader when nothing requested fits', () => {
    expect(availableModels(['multi-qwen3'], 'light')).toEqual(['multi-xasr'])
  })
})
