/**
 * Canonical WAV decoding for the private worker.
 *
 * The recorder hands over 16 kHz mono PCM16. Anything else is rejected here rather than being
 * resampled, because a silent resample would change what the models were measured on.
 */
/** Lowest accepted recording length; shorter clips carry no speech to recognize. */
const MIN_DATA_BYTES = 2;
/**
 * Decode a WAV buffer.
 * @param bytes - complete file contents.
 * @returns mono samples and their duration.
 * @throws when the header is not RIFF/WAVE, the codec is not PCM16, or the rate is not 16 kHz.
 */
export function decodeWave(bytes) {
    const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.length < 44)
        throw new Error('speech audio is too short to be a WAV file');
    if (view.toString('ascii', 0, 4) !== 'RIFF' || view.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('speech audio is not a RIFF/WAVE file');
    }
    let offset = 12;
    let sampleRate = 0;
    let channels = 0;
    let bits = 0;
    let dataOffset = -1;
    let dataLength = 0;
    while (offset + 8 <= view.length) {
        const id = view.toString('ascii', offset, offset + 4);
        const size = view.readUInt32LE(offset + 4);
        const body = offset + 8;
        if (id === 'fmt ') {
            if (size < 16 || body + size > view.length)
                throw new Error('speech audio has a truncated fmt chunk');
            const format = view.readUInt16LE(body);
            if (format !== 1)
                throw new Error(`speech audio must be uncompressed PCM, got format ${format}`);
            channels = view.readUInt16LE(body + 2);
            sampleRate = view.readUInt32LE(body + 4);
            bits = view.readUInt16LE(body + 14);
        }
        else if (id === 'data') {
            dataOffset = body;
            dataLength = Math.min(size, view.length - body);
        }
        offset = body + size + (size % 2);
    }
    if (sampleRate === 0 || channels === 0)
        throw new Error('speech audio has no fmt chunk');
    if (sampleRate !== 16000)
        throw new Error(`speech audio must be 16 kHz, got ${sampleRate} Hz`);
    if (channels !== 1)
        throw new Error(`speech audio must be mono, got ${channels} channels`);
    if (bits !== 16)
        throw new Error(`speech audio must be 16-bit PCM, got ${bits}-bit`);
    if (dataOffset < 0)
        throw new Error('speech audio has no data chunk');
    if (dataLength < MIN_DATA_BYTES)
        throw new Error('speech audio carries no samples');
    const count = Math.floor(dataLength / 2);
    const samples = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
        samples[index] = view.readInt16LE(dataOffset + index * 2) / 32768;
    }
    return { samples, sampleRate, seconds: count / sampleRate };
}
//# sourceMappingURL=wav.js.map