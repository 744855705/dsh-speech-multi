/**
 * Registers one local provider per enabled model.
 *
 * Activation resolves the device tier, reads the lock file, and inspects each model's cache.
 * It never downloads and never loads a model: a model that is not on disk stays `unprepared`
 * until the user prepares exactly that provider.
 */
import { totalmem } from 'node:os';
import { findModel } from "./catalog.js";
import { enabledModelIds, validateConfig } from "./config.js";
import { availableModels, classifyDevice, tierPolicy } from "./device.js";
import { installLock, readLock } from "./lock.js";
import { ModelProvider, providerInfo } from "./provider.js";
import { loadManifest } from "./runtime/assets.js";
export { Config } from "./config.js";
export const name = 'dsh-speech-multi';
export const inject = ['speechToText', 'subprocess'];
/**
 * Resolve the tier, honouring an explicit choice over the machine's memory.
 * @param config - validated configuration.
 * @returns the tier this installation runs.
 */
function resolveTier(config) {
    return config.deviceTier === 'auto' ? classifyDevice(totalmem()) : config.deviceTier;
}
/**
 * Register the enabled models as separate providers and install the selection lock.
 * @param ctx - host registry, subprocess owner and logger.
 * @param config - validated configuration.
 */
export function apply(ctx, config) {
    validateConfig(config);
    const manifest = loadManifest();
    const tier = resolveTier(config);
    const policy = tierPolicy(tier);
    const enabled = enabledModelIds(config.enabledModels);
    const runnable = availableModels(enabled, tier);
    const skipped = enabled.filter((id) => !runnable.includes(id));
    if (skipped.length > 0) {
        ctx.logger.warn(`speech-multi skipped ${skipped.join(', ')} on the ${tier} device tier`);
    }
    const maxRecordingSeconds = config.maxRecordingSeconds ?? policy.maxRecordingSeconds;
    const shared = { manifest, deviceTier: tier, maxRecordingSeconds };
    const providers = runnable.flatMap((id) => {
        const model = findModel(id);
        return model === undefined ? [] : [new ModelProvider(ctx, config, model, shared)];
    });
    const lock = readLock(config.lockFile, ctx.logger, runnable);
    ctx.effect(() => {
        const unregisters = providers.map((provider) => ctx.speechToText.register({
            info: providerInfo(provider.model),
            preparation: provider,
            transcribe: async (input, signal) => await provider.transcribe(input, signal),
        }));
        for (const provider of providers)
            provider.inspect();
        if (lock !== undefined) {
            ctx.logger.info(`speech-multi lock active (${lock.mode}): ${lock.modelId} via ${config.lockFile}`);
        }
        const releaseLock = lock === undefined ? () => { } : installLock({
            speechToText: ctx.speechToText,
            logger: ctx.logger,
        }, lock);
        return async () => {
            releaseLock();
            const removals = unregisters.map((unregister) => unregister());
            await Promise.all(providers.map(async (provider) => await provider.dispose()));
            await Promise.all(removals);
        };
    });
}
//# sourceMappingURL=index.js.map