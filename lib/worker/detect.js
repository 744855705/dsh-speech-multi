import { detectSpeech } from "../vad.js";
import { fireRed, fsmn } from "../vad/detect.js";
/**
 * Detect speech regions, preferring FSMN and degrading to FireRedVAD then to energy.
 * @param samples - mono samples.
 * @param sampleRate - samples per second.
 * @param vadDirectory - directory holding both VAD models, or undefined to use the energy fallback.
 * @param options - thresholds shared by every detector.
 * @returns ascending speech regions.
 */
export async function detectRegions(samples, sampleRate, vadDirectory, options) {
    const energy = () => detectSpeech(samples, sampleRate, { minSpeechSeconds: options.minSpeechSeconds });
    if (vadDirectory === undefined || sampleRate !== 16_000)
        return energy();
    for (const detector of [fsmn, fireRed]) {
        try {
            const regions = await detector.detect(vadDirectory, samples, options);
            if (regions.length > 0)
                return regions;
        }
        catch {
            // The next detector is tried; the energy fallback comes last.
        }
    }
    return energy();
}
//# sourceMappingURL=detect.js.map