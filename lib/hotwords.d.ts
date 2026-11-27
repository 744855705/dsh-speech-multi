/**
 * Domain vocabulary handed to the recognizers that accept it.
 *
 * Two families can use these, in different ways. Fun-ASR-Nano takes them as prompt text, so the
 * list costs context from its fixed 1024-token budget. X-ASR takes them as biasing phrases, which
 * only apply under `modified_beam_search`, and too many phrases make the decoder hear them where
 * nobody said them. The list is therefore deliberately short and made of terms that are actually
 * misheard: proper nouns, product names, and the English words that Chinese speakers mix in.
 *
 * Everything here is developer and AI vocabulary; a caller appends their own through
 * `hotwordsEnabled` plus `hotwords` in the plugin configuration.
 */
/** Terms worth biasing, grouped the way a person would look for them. */
export declare const BUILTIN_HOTWORDS: readonly string[];
/**
 * Merge the built-in list with caller-supplied terms.
 *
 * Duplicates are dropped case-insensitively and later entries win, so a caller can correct the
 * spelling of a built-in term without editing this file.
 * @param extra - additional terms, in any order.
 * @returns one term per line of text, with the caller's spelling kept.
 */
export declare function mergeHotwords(extra?: readonly string[]): string[];
/**
 * Build the prompt fragment Fun-ASR reads.
 *
 * The model takes a plain string, and a comma-separated list reads as a vocabulary hint rather
 * than as a sentence to transcribe.
 * @param terms - merged hotwords.
 * @returns the prompt fragment, empty when there is nothing to add.
 */
export declare function promptFor(terms: readonly string[]): string;
/**
 * Build the biasing phrase list X-ASR reads.
 *
 * sherpa separates phrases with `/`, and with `modelingUnit: bpe` the phrases are ordinary words
 * rather than token sequences.
 * @param terms - merged hotwords.
 * @returns the phrase string, empty when there is nothing to add.
 */
export declare function phrasesFor(terms: readonly string[]): string;
