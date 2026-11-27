/**
 * The strategy every recognizer family implements.
 *
 * The four families share one sherpa-onnx entry point but disagree on the option shape and
 * on which side files are mandatory. Keeping that difference behind one method is what lets
 * the worker treat them uniformly.
 */
import type { FamilyId } from '../catalog.ts';
/** Resolved on-disk locations for one prepared model. */
export interface ModelPaths {
    /** Directory the archive expanded to; contains exactly the family's expected files. */
    readonly root: string;
}
/** Values that change what the strategy emits. */
export interface FamilyOptions {
    /** CPU intra-operation threads. */
    readonly threads: number;
    /** Recording length; the Qwen3 family sizes its token budget from it. */
    readonly audioSeconds: number;
}
/** Construction options handed to `sherpa.OfflineRecognizer`. */
export interface EngineSpec {
    /** Family-specific `modelConfig` object. */
    readonly modelConfig: Record<string, unknown>;
    /** Sibling options such as `decodingMethod`. */
    readonly options: Record<string, unknown>;
    /** Token table path; sherpa validates its existence for every family. */
    readonly tokens: string;
}
/** One recognizer family. */
export interface FamilyStrategy {
    readonly family: FamilyId;
    /**
     * Build the recognizer construction options.
     * @param paths - resolved model directory.
     * @param options - threads and the longest window this model will see.
     * @returns sherpa-onnx construction options for this family.
     */
    engine(paths: ModelPaths, options: FamilyOptions): EngineSpec;
}
