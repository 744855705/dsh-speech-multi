/** X-ASR: streaming Zipformer transducer exported for offline use, with native punctuation. */
import { join } from 'node:path'
import type { FamilyStrategy } from './family.ts'

/**
 * X-ASR keeps its encoder frozen at 1000 output frames, so a window longer than
 * `hardCapSeconds` makes the native layer abort the process instead of returning an error.
 * Greedy search matches the upstream reference and measured the same error rate as beam search
 * while running a quarter faster.
 */
export const xasr: FamilyStrategy = {
  family: 'xasr',
  engine: (paths, options) => {
    const root = paths.root
    const hotwords = options.hotwords
    return {
      modelConfig: {
        // Biasing phrases are ordinary words only when the BPE vocabulary is supplied;
        // without it sherpa expects a space-separated token sequence instead.
        ...hotwords.length === 0 ? {} : { modelingUnit: 'cjkchar' },
        transducer: {
          encoder: join(root, 'encoder-epoch-99-avg-1.int8.onnx'),
          decoder: join(root, 'decoder-epoch-99-avg-1.onnx'),
          joiner: join(root, 'joiner-epoch-99-avg-1.int8.onnx'),
        },
        numThreads: options.threads,
        provider: 'cpu',
        debug: 0,
      },
      // Contextual biasing is implemented for `modified_beam_search` only, and that mode also
      // produces better text on its own; greedy stays for the case where no hotwords are set.
      options: { decodingMethod: hotwords.length === 0 ? 'greedy_search' : 'modified_beam_search', maxActivePaths: 4 },
      tokens: join(root, 'tokens.txt'),
    }
  },
}
