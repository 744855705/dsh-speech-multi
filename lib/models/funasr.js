/**
 * Fun-ASR-Nano: an encoder adaptor feeding a Qwen3-0.6B language decoder.
 *
 * Two properties are load-bearing. The token budget is baked into the exported graph
 * (`max_total_len=1024`), so only the 1024-context export is usable past ~15 s per window.
 * And sherpa-onnx validates a token table for every family, but this family never reads one,
 * so the tokenizer vocabulary stands in as a file that exists.
 */
import { join } from 'node:path';
import { promptFor } from "../hotwords.js";
export const funasr = {
    family: 'funasr',
    engine: (paths, options) => {
        const root = paths.root;
        const tokenizer = join(root, 'tokenizer');
        return {
            modelConfig: {
                funasrNano: {
                    encoderAdaptor: join(root, 'encoder_adaptor.int8.onnx'),
                    llm: join(root, 'llm.int8.onnx'),
                    embedding: join(root, 'embedding.int8.onnx'),
                    tokenizer,
                    // Hotwords reach this family as prompt text, so they spend the export's fixed
                    // 1024-token budget rather than adding a separate biasing graph.
                    ...options.hotwords.length === 0 ? {} : { hotwords: promptFor(options.hotwords) },
                },
                numThreads: options.threads,
                provider: 'cpu',
                debug: 0,
            },
            options: {},
            tokens: join(tokenizer, 'merges.txt'),
        };
    },
};
//# sourceMappingURL=funasr.js.map