/**
 * Qwen3-ASR 0.6B: convolution frontend plus a Qwen3 decoder.
 *
 * The decoder shares one token budget between prompt, audio and output, and audio costs about
 * 13 tokens per second. The default budget (512) silently truncates anything past ~28 s, so the
 * budget is derived from the recording length on every request. `maxNewTokens` stays at the
 * exporter's recommendation; smaller values truncate the text instead of the audio.
 */
import { join } from 'node:path'
import type { FamilyStrategy } from './family.ts'

/** Audio tokens per second, measured on this export. */
const TOKENS_PER_SECOND = 13

/** Room reserved for the prompt and the generated transcript. */
const TOKEN_HEADROOM = 1024

/** Largest budget the exported graph accepts. */
const MAX_TOTAL_LEN = 8192

/**
 * Size the shared context budget for one recording.
 * @param audioSeconds - decoded recording length.
 * @returns a token budget between the graph minimum and its ceiling.
 */
export function totalLenFor(audioSeconds: number): number {
  const needed = Math.ceil(TOKENS_PER_SECOND * Math.max(0, audioSeconds)) + TOKEN_HEADROOM
  return Math.min(MAX_TOTAL_LEN, Math.max(1024, needed))
}

export const qwen3: FamilyStrategy = {
  family: 'qwen3',
  engine: (paths, options) => {
    const root = paths.root
    const tokenizer = join(root, 'tokenizer')
    return {
      modelConfig: {
        qwen3Asr: {
          convFrontend: join(root, 'conv_frontend.onnx'),
          encoder: join(root, 'encoder.int8.onnx'),
          decoder: join(root, 'decoder.int8.onnx'),
          tokenizer,
          maxTotalLen: totalLenFor(options.audioSeconds),
          maxNewTokens: 1024,
        },
        numThreads: options.threads,
        provider: 'cpu',
        debug: 0,
      },
      options: {},
      tokens: join(tokenizer, 'merges.txt'),
    }
  },
}
