import { assertWithinHardCap, planBlocks, quietestCut } from "../chunking.js";
/**
 * Plan the windows for a recording without decoding it.
 * @param request - samples, detected regions and the model's policy.
 * @returns the windows to decode.
 * @throws when a window would exceed the model's hard cap.
 */
export function planRecording(request) {
    const blocks = planBlocks({
        totalSamples: request.samples.length,
        sampleRate: request.sampleRate,
        segments: request.segments,
        policy: request.policy,
        findCut: (from, to) => quietestCut(request.samples, from, to),
    });
    assertWithinHardCap(blocks, request.sampleRate, request.policy, request.modelId);
    return blocks;
}
/**
 * Decode a recording block by block, join the transcripts, then punctuate if asked.
 * @param request - recognizer, samples, regions and policy.
 * @returns joined text with timing.
 */
export async function decodeRecording(request) {
    const started = performance.now();
    const blocks = planRecording(request);
    const parts = [];
    for (const block of blocks) {
        const stream = request.hotwords === undefined
            ? request.recognizer.createStream()
            : request.recognizer.createStream(request.hotwords);
        stream.acceptWaveform({
            sampleRate: request.sampleRate,
            samples: request.samples.subarray(block.start, block.end),
        });
        request.recognizer.decode(stream);
        const piece = request.recognizer.getResult(stream).text.trim();
        if (piece.length > 0)
            parts.push(piece);
    }
    const speechSamples = request.segments.reduce((total, region) => total + Math.max(0, region.end - region.start), 0);
    const joined = parts.join('');
    const text = request.punctuate === undefined ? joined : await request.punctuate(joined);
    return {
        text,
        blocks: blocks.length,
        audioSeconds: request.samples.length / request.sampleRate,
        speechSeconds: Math.min(speechSamples, request.samples.length) / request.sampleRate,
        inferenceSeconds: (performance.now() - started) / 1000,
    };
}
//# sourceMappingURL=decode.js.map