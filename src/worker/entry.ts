/**
 * Private worker entry.
 *
 * Loads one recognizer, serves it on loopback, and prints `{"port":N}` as the only stdout line.
 * The Host passes the resolved paths and thresholds as JSON in `argv[2]`; the bearer secret
 * arrives in `DSH_SPEECH_TOKEN` and is removed from the environment once read. A failure before
 * readiness writes its message to stderr and exits non-zero, and the Host folds that text into
 * the preparation error.
 */
import { createRequire } from 'node:module'
import { z } from 'zod'
import type { ChunkingPolicy, FamilyId } from '../catalog.ts'
import { strategyFor } from '../models/index.ts'
import { punctuateOrKeep } from '../punctuation/fireredpunc.ts'
import { decodeWave } from '../runtime/wav.ts'
import { decodeRecording } from './decode.ts'
import { detectRegions } from './detect.ts'
import { startServer } from './server.ts'

const require = createRequire(import.meta.url)

const policySchema = z.object({
  blockSeconds: z.number().positive(),
  minBlockSeconds: z.number().nonnegative(),
  hardCapSeconds: z.number().positive(),
}).strict()

const payloadSchema = z.object({
  modelId: z.string().min(1),
  family: z.string().min(1),
  root: z.string().min(1),
  threads: z.number().int().positive(),
  maxAudioBytes: z.number().int().positive(),
  chunking: policySchema,
  /** Silero model path; the energy fallback runs when it is absent. */
  vadModel: z.string().min(1).optional(),
  /** FireRedPunc directory; punctuation is skipped when it is absent. */
  punctuationDirectory: z.string().min(1).optional(),
  detection: z.object({
    threshold: z.number().min(0).max(1),
    minSilenceSeconds: z.number().nonnegative(),
    minSpeechSeconds: z.number().nonnegative(),
    maxSpeechSeconds: z.number().positive(),
  }).strict(),
}).strict()

/** Shape `sherpa.OfflineRecognizer` accepts. */
interface RecognizerOptions {
  readonly featConfig: { readonly sampleRate: number; readonly featureDim: number }
  readonly modelConfig: Record<string, unknown>
}

async function main(): Promise<void> {
  const raw: unknown = JSON.parse(z.string().parse(process.argv[2]))
  const payload = payloadSchema.parse(raw)
  const token = z.string().regex(/^[a-f0-9]{64}$/u).parse(process.env.DSH_SPEECH_TOKEN)
  delete process.env.DSH_SPEECH_TOKEN

  const chunking: ChunkingPolicy = payload.chunking
  const spec = strategyFor(payload.family as FamilyId).engine(
    { root: payload.root },
    { threads: payload.threads, audioSeconds: chunking.hardCapSeconds },
  )

  const sherpa = require('sherpa-onnx-node') as {
    OfflineRecognizer: new (options: RecognizerOptions & Record<string, unknown>) => {
      createStream(): { acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void }
      decode(stream: unknown): void
      getResult(stream: unknown): { text: string }
    }
  }
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: spec.modelConfig,
    tokens: spec.tokens,
    ...spec.options,
  })

  const detection = {
    ...payload.detection,
    threads: payload.threads,
  }
  const punctuationDirectory = payload.punctuationDirectory

  const { port } = await startServer(token, payload.maxAudioBytes, async (audio) => {
    const wave = decodeWave(audio)
    const segments = detectRegions(wave.samples, wave.sampleRate, payload.vadModel, detection)
    const result = await decodeRecording({
      recognizer,
      modelId: payload.modelId,
      policy: chunking,
      samples: wave.samples,
      sampleRate: wave.sampleRate,
      segments,
      ...punctuationDirectory === undefined ? {} : {
        punctuate: async (text: string) => await punctuateOrKeep(punctuationDirectory, text),
      },
    })
    return {
      text: result.text,
      blocks: result.blocks,
      audioSeconds: result.audioSeconds,
      inferenceSeconds: result.inferenceSeconds,
    }
  })
  process.stdout.write(`${JSON.stringify({ port })}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`, () => {
    process.exit(1)
  })
})
