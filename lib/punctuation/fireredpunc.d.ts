/** Files this module expects inside the punctuation directory. */
export declare const PUNCTUATION_FILES: readonly ["punc.fp16.onnx", "tokenizer.json"];
/** One punctuation mark and the transcript offset it follows. */
export interface Mark {
    readonly at: number;
    readonly mark: string;
}
/**
 * Insert marks into the original string without touching its characters.
 *
 * Working from the source text rather than a detokenized rebuild is what keeps `COMMIT`, `API`
 * and the spaces around embedded English intact.
 * @param text - original transcript.
 * @param marks - marks keyed by character offset.
 * @returns the transcript with marks inserted.
 */
export declare function applyMarks(text: string, marks: readonly Mark[]): string;
/**
 * Insert punctuation into a transcript.
 * @param directory - prepared punctuation directory.
 * @param text - unpunctuated transcript; the original characters are preserved.
 * @returns the transcript with punctuation, or the input unchanged when nothing is marked.
 */
export declare function punctuate(directory: string, text: string): Promise<string>;
/**
 * Punctuate without ever losing the transcript.
 *
 * Punctuation is a presentation step: a missing or broken model must leave the recognized text
 * exactly as the decoder produced it rather than failing the recording.
 * @param directory - prepared punctuation directory, or undefined when punctuation is off.
 * @param text - unpunctuated transcript.
 * @returns punctuated text, or the input when punctuation is unavailable.
 */
export declare function punctuateOrKeep(directory: string | undefined, text: string): Promise<string>;
/** Release the cached handles; used when the worker shuts down. */
export declare function closePunctuation(): void;
