/**
 * FireRedASR2-AED: attention encoder-decoder with no punctuation and no language token.
 *
 * Its English recall falls apart once a window passes roughly a minute, which is why the
 * catalog caps it lower than the tag-along token budget would allow.
 */
import { join } from 'node:path'
import type { FamilyStrategy } from './family.ts'

export const firered: FamilyStrategy = {
  family: 'firered',
  engine: (paths, options) => {
    const root = paths.root
    return {
      modelConfig: {
        fireRedAsr: {
          encoder: join(root, 'encoder.int8.onnx'),
          decoder: join(root, 'decoder.int8.onnx'),
        },
        numThreads: options.threads,
        provider: 'cpu',
        debug: 0,
      },
      options: {},
      tokens: join(root, 'tokens.txt'),
    }
  },
}
