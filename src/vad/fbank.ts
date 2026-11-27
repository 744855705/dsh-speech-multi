/**
 * Kaldi-compatible log-mel frontend shared by both VAD detectors.
 *
 * The two models were trained on 80-bin fbank computed from 16 kHz audio whose samples carry
 * int16 scale, not the `[-1, 1]` range a WAV decoder hands back. Feeding the normalised range
 * shifts every log-mel value by about -18.9, which does not fail loudly: FireRedVAD keeps
 * returning probabilities, they just sit at 0.001 everywhere. Hence {@link INT16_SCALE}.
 *
 * Frame geometry matches Kaldi's defaults — 25 ms window, 10 ms shift, Povey window, 512-point
 * FFT, 80 mel bins from 20 Hz to Nyquist — because that is what the reference implementation
 * used when the CER numbers were measured.
 */

/** Samples per second the models expect. */
export const FEATURE_SAMPLE_RATE = 16_000
/** Mel bins per frame. */
export const FEATURE_DIM = 80
/** Window length in samples (25 ms). */
const FRAME_LENGTH = 400
/** Hop length in samples (10 ms). */
const FRAME_SHIFT = 160
/** Real FFT size; must be a power of two. */
const FFT_SIZE = 512
/** Bin count of the one-sided spectrum. */
const BINS = FFT_SIZE / 2 + 1
/** Lowest mel band centre, in Hz. */
const LOW_FREQ = 20
/** Energy floor before the logarithm, matching the reference implementation. */
const LOG_FLOOR = 1e-10
/** The scale the training data carried: full-range 16-bit samples. */
const INT16_SCALE = 32_768

/** http://www.fftw.org/ or any radix-2 complex FFT, in place. */
function fft(real: Float64Array, imag: Float64Array): void {
  const n = real.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const swapReal = real[i]!
      const swapImag = imag[i]!
      real[i] = real[j]!
      imag[i] = imag[j]!
      real[j] = swapReal
      imag[j] = swapImag
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length
    const half = length >> 1
    const wReal = Math.cos(angle)
    const wImag = Math.sin(angle)
    for (let start = 0; start < n; start += length) {
      let curReal = 1
      let curImag = 0
      for (let k = 0; k < half; k++) {
        const a = start + k
        const b = a + half
        const tReal = real[b]! * curReal - imag[b]! * curImag
        const tImag = real[b]! * curImag + imag[b]! * curReal
        real[b] = real[a]! - tReal
        imag[b] = imag[a]! - tImag
        real[a] = real[a]! + tReal
        imag[a] = imag[a]! + tImag
        const nextReal = curReal * wReal - curImag * wImag
        curImag = curReal * wImag + curImag * wReal
        curReal = nextReal
      }
    }
  }
}

/** Triangular mel filters, built once per process. */
let filters: Float64Array | undefined

/**
 * Build the mel filterbank matrix.
 * @param sampleRate - audio rate in Hz.
 * @returns `FEATURE_DIM` rows of `BINS` weights.
 */
function melFilters(sampleRate: number): Float64Array {
  if (filters !== undefined) return filters
  const hzToMel = (hz: number): number => 1127 * Math.log1p(hz / 700)
  const melToHz = (mel: number): number => 700 * Math.expm1(mel / 1127)
  const lowMel = hzToMel(LOW_FREQ)
  const highMel = hzToMel(sampleRate / 2)
  const points = new Float64Array(FEATURE_DIM + 2)
  for (let i = 0; i < points.length; i++) {
    points[i] = melToHz(lowMel + ((highMel - lowMel) * i) / (FEATURE_DIM + 1))
  }
  const matrix = new Float64Array(FEATURE_DIM * BINS)
  const frequencies = new Float64Array(BINS)
  for (let bin = 0; bin < BINS; bin++) frequencies[bin] = (bin * sampleRate) / FFT_SIZE
  for (let i = 0; i < FEATURE_DIM; i++) {
    const left = points[i]!
    const centre = points[i + 1]!
    const right = points[i + 2]!
    for (let bin = 0; bin < BINS; bin++) {
      const frequency = frequencies[bin]!
      const rising = (frequency - left) / (centre - left)
      const falling = (right - frequency) / (right - centre)
      matrix[i * BINS + bin] = Math.max(0, Math.min(rising, falling))
    }
  }
  filters = matrix
  return matrix
}

/** Povey window, as used by the reference frontend. */
const WINDOW = (() => {
  const window = new Float64Array(FRAME_LENGTH)
  for (let i = 0; i < FRAME_LENGTH; i++) {
    const raised = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_LENGTH - 1))
    window[i] = Math.pow(raised, 0.85)
  }
  return window
})()

/**
 * Compute log-mel frames.
 *
 * The samples are expected in the `[-1, 1]` range, exactly as the WAV decoder returns them;
 * scaling to int16 happens here so no caller has to remember it.
 * @param samples - mono samples in `[-1, 1]`.
 * @param sampleRate - audio rate in Hz.
 * @returns `frames * FEATURE_DIM` values, frame-major.
 */
export function logMel(samples: Float32Array, sampleRate: number): { data: Float32Array; frames: number } {
  const frames = samples.length < FRAME_LENGTH ? 0 : 1 + Math.floor((samples.length - FRAME_LENGTH) / FRAME_SHIFT)
  const data = new Float32Array(frames * FEATURE_DIM)
  if (frames === 0) return { data, frames }
  const matrix = melFilters(sampleRate)
  const real = new Float64Array(FFT_SIZE)
  const imag = new Float64Array(FFT_SIZE)
  const power = new Float64Array(BINS)
  const emphasised = new Float64Array(samples.length)
  emphasised[0] = samples[0]! * INT16_SCALE
  for (let i = 1; i < samples.length; i++) {
    emphasised[i] = (samples[i]! * INT16_SCALE) - 0.97 * (samples[i - 1]! * INT16_SCALE)
  }
  for (let frame = 0; frame < frames; frame++) {
    const start = frame * FRAME_SHIFT
    let mean = 0
    for (let i = 0; i < FRAME_LENGTH; i++) mean += emphasised[start + i]!
    mean /= FRAME_LENGTH
    for (let i = 0; i < FRAME_LENGTH; i++) {
      real[i] = (emphasised[start + i]! - mean) * WINDOW[i]!
      imag[i] = 0
    }
    for (let i = FRAME_LENGTH; i < FFT_SIZE; i++) {
      real[i] = 0
      imag[i] = 0
    }
    fft(real, imag)
    for (let bin = 0; bin < BINS; bin++) power[bin] = real[bin]! * real[bin]! + imag[bin]! * imag[bin]!
    for (let mel = 0; mel < FEATURE_DIM; mel++) {
      let energy = 0
      const row = mel * BINS
      for (let bin = 0; bin < BINS; bin++) energy += power[bin]! * matrix[row + bin]!
      data[frame * FEATURE_DIM + mel] = Math.log(Math.max(energy, LOG_FLOOR))
    }
  }
  return { data, frames }
}

/**
 * Normalise with a mean/inverse-deviation pair, in place.
 * @param data - frame-major features.
 * @param means - per-dimension means.
 * @param scales - per-dimension multipliers.
 */
export function applyMeanScale(data: Float32Array, means: Float32Array, scales: Float32Array): void {
  for (let offset = 0; offset < data.length; offset += FEATURE_DIM) {
    for (let i = 0; i < FEATURE_DIM; i++) data[offset + i] = (data[offset + i]! - means[i]!) * scales[i]!
  }
}

/**
 * Normalise by shift and scale, the form FunASR's `vad.mvn` uses.
 * @param data - frame-major features, already stacked for LFR.
 * @param shift - per-dimension addend (typically negative).
 * @param scales - per-dimension multiplier.
 */
export function applyShiftScale(data: Float32Array, shift: Float32Array, scales: Float32Array): void {
  const dim = shift.length
  for (let offset = 0; offset < data.length; offset += dim) {
    for (let i = 0; i < dim; i++) data[offset + i] = (data[offset + i]! + shift[i]!) * scales[i]!
  }
}

/**
 * Stack `lfrM` consecutive frames into one, keeping every frame in order.
 *
 * FunASR's LFR repeats the first frame `(lfrM - 1) / 2` times at the front so the output keeps
 * the input frame count.
 * @param data - frame-major features.
 * @param frames - input frame count.
 * @param lfrM - frames to stack.
 * @returns stacked features of `frames * FEATURE_DIM * lfrM` values.
 */
export function lfr(data: Float32Array, frames: number, lfrM: number): Float32Array {
  const pad = Math.floor((lfrM - 1) / 2)
  const out = new Float32Array(frames * FEATURE_DIM * lfrM)
  for (let frame = 0; frame < frames; frame++) {
    const base = frame * FEATURE_DIM * lfrM
    for (let slot = 0; slot < lfrM; slot++) {
      const source = frame + slot - pad
      const clamped = source < 0 ? 0 : Math.min(source, frames - 1)
      out.set(data.subarray(clamped * FEATURE_DIM, (clamped + 1) * FEATURE_DIM), base + slot * FEATURE_DIM)
    }
  }
  return out
}
