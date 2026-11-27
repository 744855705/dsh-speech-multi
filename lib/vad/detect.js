/**
 * Neural voice-activity detection, replacing sherpa's Silero wrapper.
 *
 * Two detectors share the {@link logMel} frontend:
 *
 * - FSMN-VAD is the default. It is a DFSMN over 400-dim LFR frames and needs four recurrent
 *   caches threaded through the utterance.
 * - FireRedVAD is the fallback for when the primary model is missing or throws. It is stateless
 *   and takes the plain 80-dim frames, so it shares everything except the normalisation.
 *
 * Both output a per-frame probability; the two differ in what that probability means, which is
 * the reason each caller passes {@link Detector.invert}. Measured on a 212 s recording with a
 * matching transcript, FSMN scored 4.23–4.61 % CER and FireRedVAD 4.73–5.85 %, against 6.10–7.60 %
 * for the Silero detector this replaces.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { applyMeanScale, applyShiftScale, FEATURE_DIM, FEATURE_SAMPLE_RATE, lfr, logMel } from "./fbank.js";
const require = createRequire(import.meta.url);
/** Frame advance of the shared frontend. */
const FRAME_SECONDS = 0.01;
/** FSMN recurrent cache width. */
const FSMN_CACHE_DIM = 19;
/** Frames per inference call; keeps the recurrent state small and the graph happy. */
const FSMN_CHUNK = 200;
let runtime;
/**
 * Load the WebAssembly backend once per process.
 *
 * The trailing separator on `wasmPaths` is load-bearing: the runtime concatenates the asset name
 * directly, so a bare directory resolves to `distort-wasm-simd-threaded.mjs`.
 * @returns the runtime handles.
 */
async function ort() {
    if (runtime === undefined) {
        runtime = (async () => {
            const module = await import('onnxruntime-web');
            const packageDirectory = dirname(require.resolve('onnxruntime-web'));
            module.env.wasm.wasmPaths = packageDirectory.endsWith(sep) ? packageDirectory : `${packageDirectory}${sep}`;
            // A single thread keeps this inside the worker subprocess without a second pool.
            module.env.wasm.numThreads = 1;
            return module;
        })();
    }
    return await runtime;
}
const sessions = new Map();
/**
 * Create or reuse a session for one model file.
 * @param path - absolute model path.
 * @returns the session.
 */
async function session(path) {
    let pending = sessions.get(path);
    if (pending === undefined) {
        const module = await ort();
        pending = module.InferenceSession.create(readFileSync(path), { executionProviders: ['wasm'] });
        sessions.set(path, pending);
    }
    return await pending;
}
/**
 * Read FunASR's `vad.mvn`, which stores add-shift and rescale vectors as bracketed lists.
 * @param text - file contents.
 * @returns the two vectors, both 400 wide.
 */
export function parseMvn(text) {
    const grab = (tag) => {
        const at = text.indexOf(`<${tag}>`);
        if (at < 0)
            throw new Error(`vad.mvn is missing <${tag}>`);
        const open = text.indexOf('[', at);
        const close = text.indexOf(']', open);
        if (open < 0 || close < 0)
            throw new Error(`vad.mvn has no values after <${tag}>`);
        const values = text.slice(open + 1, close).trim().split(/\s+/).map(Number);
        return Float32Array.from(values);
    };
    return { shift: grab('AddShift'), scale: grab('Rescale') };
}
/**
 * Turn a per-frame speech flag into sample spans.
 *
 * Shared by both detectors so their thresholds mean the same thing: a region closes only after
 * `minSilenceSeconds` of silence, opens only after `minSpeechSeconds` of speech, and is cut at
 * `maxSpeechSeconds` because the downstream models cannot take an unbounded block.
 * @param speech - one flag per frame.
 * @param options - detection thresholds.
 * @returns ascending spans in samples.
 */
export function spansFromFlags(speech, options) {
    const minSilenceFrames = Math.max(1, Math.round(options.minSilenceSeconds / FRAME_SECONDS));
    const minSpeechFrames = Math.max(1, Math.round(options.minSpeechSeconds / FRAME_SECONDS));
    const maxFrames = Math.max(1, Math.round(options.maxSpeechSeconds / FRAME_SECONDS));
    const regions = [];
    let start = -1;
    let silence = 0;
    const push = (from, to) => {
        if (to - from < minSpeechFrames)
            return;
        let begin = from;
        while (to - begin > maxFrames) {
            regions.push({ start: begin * 160, end: (begin + maxFrames) * 160 });
            begin += maxFrames;
        }
        regions.push({ start: begin * 160, end: to * 160 });
    };
    for (let frame = 0; frame < speech.length; frame++) {
        if (speech[frame]) {
            if (start < 0)
                start = frame;
            silence = 0;
        }
        else if (start >= 0) {
            silence++;
            if (silence >= minSilenceFrames) {
                push(start, frame - silence + 1);
                start = -1;
                silence = 0;
            }
        }
    }
    if (start >= 0)
        push(start, speech.length);
    return regions;
}
/** FSMN-VAD: LFR-stacked frames, four recurrent caches, speech when the silence score is low. */
export const fsmn = {
    async detect(directory, samples, options) {
        const module = await ort();
        const net = await session(join(directory, 'fsmn.onnx'));
        const { shift, scale } = parseMvn(readFileSync(join(directory, 'vad.mvn'), 'utf8'));
        const { data, frames } = logMel(samples, FEATURE_SAMPLE_RATE);
        if (frames === 0)
            return [];
        const stacked = lfr(data, frames, shift.length / FEATURE_DIM);
        applyShiftScale(stacked, shift, scale);
        const width = shift.length;
        const caches = {};
        for (const name of net.inputNames) {
            if (!name.startsWith('in_cache'))
                continue;
            caches[name] = new module.Tensor('float32', new Float32Array(128 * FSMN_CACHE_DIM), [1, 128, FSMN_CACHE_DIM, 1]);
        }
        const silence = [];
        for (let offset = 0; offset < frames; offset += FSMN_CHUNK) {
            const take = Math.min(FSMN_CHUNK, frames - offset);
            const chunk = stacked.subarray(offset * width, (offset + take) * width);
            const output = await net.run({ speech: new module.Tensor('float32', chunk, [1, take, width]), ...caches });
            const logits = output[net.outputNames[0]];
            const stride = logits.dims[2] ?? 1;
            for (let frame = 0; frame < take; frame++)
                silence.push(logits.data[frame * stride]);
            for (let index = 0; index < 8; index++) {
                const next = output[`out_cache${index}`];
                if (next !== undefined)
                    caches[`in_cache${index}`] = next;
            }
        }
        // The first logit is the silence score, so speech is where it stays below the threshold.
        return spansFromFlags(silence.map((value) => value < options.threshold), options);
    },
};
/** FireRedVAD: stateless, one pass over the whole utterance, speech when the score is high. */
export const fireRed = {
    async detect(directory, samples, options) {
        const module = await ort();
        const net = await session(join(directory, 'firered.onnx'));
        const stats = JSON.parse(readFileSync(join(directory, 'cmvn.json'), 'utf8'));
        const { data, frames } = logMel(samples, FEATURE_SAMPLE_RATE);
        if (frames === 0)
            return [];
        applyMeanScale(data, Float32Array.from(stats.means), Float32Array.from(stats.inverse_std_variances));
        const inputName = net.inputNames[0];
        const output = await net.run({
            [inputName]: new module.Tensor('float32', data, [1, frames, FEATURE_DIM]),
        });
        const scores = output[net.outputNames[0]];
        const stride = scores.dims[2] ?? 1;
        const speech = [];
        for (let frame = 0; frame < frames; frame++)
            speech.push(scores.data[frame * stride] > options.threshold);
        return spansFromFlags(speech, options);
    },
};
//# sourceMappingURL=detect.js.map