/**
 * Registers one local provider per enabled model.
 *
 * Activation resolves the device tier, reads the lock file, and inspects each model's cache.
 * It never downloads and never loads a model: a model that is not on disk stays `unprepared`
 * until the user prepares exactly that provider.
 */
import { totalmem } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type {} from '@deepseek-ai/dsh-subprocess'
import { findModel, type ModelDescriptor } from './catalog.ts'
import { Config, enabledModelIds, validateConfig } from './config.ts'
import { availableModels, classifyDevice, tierPolicy, type DeviceTier } from './device.ts'
import { installLock, readLock } from './lock.ts'
import { ModelProvider, providerInfo, type SharedRuntime } from './provider.ts'
import { loadManifest } from './runtime/assets.ts'

export { Config } from './config.ts'
export const name = 'dsh-speech-multi'
export const inject = ['speechToText', 'subprocess']

/**
 * Resolve the tier, honouring an explicit choice over the machine's memory.
 * @param config - validated configuration.
 * @returns the tier this installation runs.
 */
function resolveTier(config: Config): DeviceTier {
  return config.deviceTier === 'auto' ? classifyDevice(totalmem()) : config.deviceTier
}

/**
 * Register the enabled models as separate providers and install the selection lock.
 * @param ctx - host registry, subprocess owner and logger.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  validateConfig(config)
  const manifest = loadManifest()
  const tier = resolveTier(config)
  const policy = tierPolicy(tier)
  const enabled = enabledModelIds(config.enabledModels)
  const runnable = availableModels(enabled, tier)
  const skipped = enabled.filter((id) => !runnable.includes(id))
  if (skipped.length > 0) {
    ctx.logger.warn(`speech-multi skipped ${skipped.join(', ')} on the ${tier} device tier`)
  }
  const maxRecordingSeconds = config.maxRecordingSeconds ?? policy.maxRecordingSeconds
  const shared: SharedRuntime = { manifest, deviceTier: tier, maxRecordingSeconds }
  const providers = runnable.flatMap((id) => {
    const model: ModelDescriptor | undefined = findModel(id)
    return model === undefined ? [] : [new ModelProvider(ctx, config, model, shared)]
  })
  const lock = readLock(config.lockFile, ctx.logger, runnable)
  ctx.effect(() => {
    const unregisters = providers.map((provider) => ctx.speechToText.register({
      info: providerInfo(provider.model),
      preparation: provider,
      transcribe: async (input, signal) => await provider.transcribe(input, signal),
    }))
    for (const provider of providers) provider.inspect()
    if (lock !== undefined) {
      ctx.logger.info(`speech-multi lock active (${lock.mode}): ${lock.modelId} via ${config.lockFile}`)
    }
    const releaseLock = lock === undefined ? () => {} : installLock({
      speechToText: ctx.speechToText as never,
      logger: ctx.logger,
    }, lock)
    return async () => {
      releaseLock()
      const removals = unregisters.map((unregister) => unregister())
      await Promise.all(providers.map(async (provider) => await provider.dispose()))
      await Promise.all(removals)
    }
  })
}
