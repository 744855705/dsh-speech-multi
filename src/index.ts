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
import { detectGpu } from './gpu/backend.ts'
import { GpuProvider, gpuProviderInfo } from './gpu/provider.ts'
import { runnableGpuModels } from './gpu/spec.ts'
import { loadManifest, type AssetManifest } from './runtime/assets.ts'

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
  const gpu = enabledGpuProviders(ctx, config, manifest)
  const lock = readLock(config.lockFile, ctx.logger, runnable)
  ctx.effect(() => {
    const gpuRegistrations = gpu.map((provider) => ctx.speechToText.register({
      info: gpuProviderInfo(provider.spec),
      preparation: provider,
      transcribe: async (input, signal) => await provider.transcribe(input, signal),
    }))
    for (const provider of gpu) provider.inspect()
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
      const removals = [...gpuRegistrations, ...unregisters].map((unregister) => unregister())
      await Promise.all(providers.map(async (provider) => await provider.dispose()))
      await Promise.all(removals)
    }
  })
}

/**
 * Register the GPU providers this machine can run.
 *
 * A provider only appears when a backend is installed and the device has room for the model, so a
 * machine without a usable GPU simply never sees them. Registration is skipped entirely when the
 * feature is turned off, which also keeps the compilation step from ever running.
 * @param ctx - host registry and logger.
 * @param config - validated configuration.
 * @param manifest - published assets.
 * @returns one provider per runnable model, largest first.
 */
function enabledGpuProviders(ctx: Context, config: Config, manifest: AssetManifest): GpuProvider[] {
  if (!config.gpuEnabled) return []
  const device = detectGpu(config.gpuBackend)
  if (device === undefined) return []
  const runnable = runnableGpuModels(device.vramBytes)
  if (runnable.length === 0) {
    ctx.logger.warn(`speech-multi found ${device.name} with ${(device.vramBytes / 1e9).toFixed(1)} GB, too small for any GPU model`)
    return []
  }
  ctx.logger.info(`speech-multi gpu: ${device.name} via ${device.backend}, ${(device.vramBytes / 1e9).toFixed(1)} GB, ${runnable.length} model(s) offered`)
  return runnable.map((spec) => new GpuProvider(ctx, config, spec, device, manifest))
}
