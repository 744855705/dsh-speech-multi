/**
 * Running llama.cpp's multimodal CLI for one recording.
 *
 * The runtime is a batch tool, not a server: `llama-mtmd-cli` loads the model, transcribes, and
 * exits. Measured on the 7900 XTX, load is about a second and a three-minute recording finishes in
 * roughly five, so a fresh process per request costs little and keeps nothing resident between
 * dictations. Results go to stdout while every log line goes to stderr, which is what makes the
 * transcript readable without post-processing heuristics.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { sanitize } from '../health.ts'
import type { GpuFilePaths } from './files.ts'
import { contextFor } from './spec.ts'

/** Everything one transcription needs. */
export interface LlamaRequest {
  /** Path to `llama-mtmd-cli` inside the built tree. */
  readonly binary: string
  /** Model and audio tower, already resolved on disk. */
  readonly files: GpuFilePaths
  /** WAV bytes as received from the Host. */
  readonly audio: Uint8Array
  /** Decoded length, which selects the context size. */
  readonly audioSeconds: number
  /** CPU threads; the audio tower runs on the CPU while the text model runs on the GPU. */
  readonly threads: number
  /** Cancels the process. */
  readonly signal: AbortSignal
}

/** One transcription result. */
export interface LlamaResult {
  readonly text: string
  /** Wall time spent inside the runtime, in seconds. */
  readonly inferenceSeconds: number
}

/**
 * Strip the runtime's own framing from stdout.
 *
 * The model answers with a language tag in front of the transcript — `language Chinese<asr_text>`
 * — which is part of the model's output format rather than the audio, so it never reaches the user.
 * {@link sanitize} also removes the marker tokens and the decoder's other control strings.
 * @param stdout - everything the process wrote to standard output.
 * @returns the transcript.
 */
export function parseTranscript(stdout: string): string {
  const lines = stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
  return sanitize(lines.join('')).trim()
}

/**
 * Transcribe one recording.
 * @param request - binary, model files, audio and cancellation.
 * @returns the transcript and how long the runtime took.
 * @throws when the process exits non-zero, or when cancellation fired.
 */
export async function transcribeWithLlama(request: LlamaRequest): Promise<LlamaResult> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-speech-gpu-'))
  const wav = join(directory, 'recording.wav')
  await writeFile(wav, request.audio)
  const started = Date.now()
  try {
    const argv = [
      '-m', request.files.model,
      '--mmproj', request.files.mmproj,
      '--audio', wav,
      '-p', '转写这段音频。',
      '-n', '4096',
      '--temp', '0',
      '-ngl', '99',
      '-t', String(request.threads),
      '-c', String(contextFor(request.audioSeconds)),
    ]
    const stdout = await runProcess(request.binary, argv, request.signal)
    return { text: parseTranscript(stdout), inferenceSeconds: (Date.now() - started) / 1000 }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/**
 * Run the CLI and collect standard output.
 *
 * The shared libraries sit next to the binary in a source build, so the loader path is pointed at
 * that directory instead of relying on an installed one.
 * @param binary - executable path.
 * @param argv - arguments after the program name.
 * @param signal - cancellation; the process is killed when it fires.
 * @returns standard output.
 */
async function runProcess(binary: string, argv: readonly string[], signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(binary, [...argv], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        LD_LIBRARY_PATH: [dirname(binary), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
      },
    })
    const out: Buffer[] = []
    let stderr = ''
    const abort = (): void => {
      child.kill('SIGTERM')
    }
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4000)
    })
    child.on('error', (error) => {
      signal.removeEventListener('abort', abort)
      reject(error)
    })
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) {
        reject(new Error('speech-multi transcription cancelled'))
        return
      }
      if (code !== 0) {
        reject(new Error(`llama-mtmd-cli exited with ${String(code)}: ${stderr.trim().slice(-400)}`))
        return
      }
      resolve(Buffer.concat(out).toString('utf8'))
    })
  })
}
