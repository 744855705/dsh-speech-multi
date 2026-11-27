/**
 * Speech-region detection inside the worker.
 *
 * Silero is preferred because it separates speech from music and steady noise, which an energy
 * threshold cannot. The energy detector stays as the fallback for an installation that has not
 * fetched the shared archive yet, so a missing VAD file degrades the block boundaries instead of
 * failing the recording.
 */
import { createRequire } from 'node:module';
import { detectSpeech } from "../vad.js";
const require = createRequire(import.meta.url);
/**
 * Detect speech regions, preferring Silero.
 * @param samples - mono samples.
 * @param sampleRate - samples per second.
 * @param vadModel - Silero model path, or undefined to use the energy fallback.
 * @param options - thresholds shared by both detectors.
 * @returns ascending speech regions.
 */
export function detectRegions(samples, sampleRate, vadModel, options) {
    if (vadModel === undefined)
        return detectSpeech(samples, sampleRate, { minSpeechSeconds: options.minSpeechSeconds });
    let create;
    try {
        const sherpa = require('sherpa-onnx-node');
        create = (config, bufferSeconds) => new sherpa.Vad(config, bufferSeconds);
    }
    catch {
        return detectSpeech(samples, sampleRate, { minSpeechSeconds: options.minSpeechSeconds });
    }
    const vad = create({
        sileroVad: {
            model: vadModel,
            threshold: options.threshold,
            minSilenceDuration: options.minSilenceSeconds,
            minSpeechDuration: options.minSpeechSeconds,
            maxSpeechDuration: options.maxSpeechSeconds,
            windowSize: 512,
        },
        sampleRate,
        numThreads: options.threads,
        provider: 'cpu',
        debug: 0,
        // Silero occasionally closes a region later than its own limit, so the ring buffer is
        // sized well past it; an overflow warns but copies, which is noise we do not want.
    }, Math.max(10, options.maxSpeechSeconds * 2));
    const regions = [];
    const collect = () => {
        while (!vad.isEmpty()) {
            const segment = vad.front(false);
            regions.push({ start: segment.start, end: segment.start + segment.samples.length });
            vad.pop();
        }
    };
    for (let offset = 0; offset < samples.length; offset += 512) {
        vad.acceptWaveform(samples.subarray(offset, offset + 512));
        collect();
    }
    vad.flush();
    collect();
    return regions;
}
//# sourceMappingURL=detect.js.map