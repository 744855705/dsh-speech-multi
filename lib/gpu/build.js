/**
 * Building llama.cpp on the machine that will run it.
 *
 * The runtime is compiled locally rather than downloaded as a binary: a build compiled here picks
 * the machine's own instruction set and GPU target, and avoids the ABI differences that break a
 * copied binary. The pinned source comes from the same release as the models, so a version bump is
 * one upload rather than a network fetch from a project nobody controls.
 */
import { spawn } from 'node:child_process';
import { access, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { assetFor } from "../runtime/assets.js";
import { fetchArchive } from "../runtime/prepare.js";
/** Pinned runtime source, published beside the models. */
export const LLAMA_SOURCE_ARCHIVE = 'llama.cpp-1.1.0.zip';
/** Directory holding the extracted source inside the plugin's data root. */
const SOURCE_DIR = 'llama.cpp';
/** CMake flags per backend. */
const BACKEND_FLAGS = {
    hip: ['-DGGML_HIP=ON'],
    cuda: ['-DGGML_CUDA=ON'],
    vulkan: ['-DGGML_VULKAN=ON'],
};
/**
 * Where a built binary lives for one backend.
 * @param config - plugin configuration.
 * @param backend - backend it was compiled for.
 * @returns the absolute path to `llama-mtmd-cli`.
 */
export function builtBinary(config, backend) {
    return join(config.dataRoot, 'gpu', 'llama.cpp', `build-${backend}`, 'bin', 'llama-mtmd-cli');
}
/**
 * Whether a path is executable.
 * @param path - absolute path.
 * @returns true when the file exists and carries the execute bit.
 */
async function executable(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Resolve the runtime binary, compiling it when needed.
 * @param input - configuration, manifest, backend and cancellation.
 * @returns the absolute path to `llama-mtmd-cli`.
 * @throws when the source is missing, the toolchain rejects the build, or cancellation fired.
 */
export async function ensureLlamaBinary(input) {
    if (input.config.gpuBinary !== undefined)
        return input.config.gpuBinary;
    const binary = builtBinary(input.config, input.backend);
    if (await executable(binary))
        return binary;
    input.signal.throwIfAborted();
    const root = join(input.config.dataRoot, 'gpu');
    await mkdir(root, { recursive: true });
    const source = join(root, SOURCE_DIR);
    if (!(await exists(join(source, 'CMakeLists.txt')))) {
        input.onStep?.('download');
        const record = assetFor(input.manifest, LLAMA_SOURCE_ARCHIVE);
        const archive = await fetchArchive({
            dataRoot: input.config.dataRoot,
            baseUrl: input.config.releaseBaseUrl,
            manifest: input.manifest,
            signal: input.signal,
            progressIntervalMs: input.config.progressIntervalMs,
            segments: input.config.downloadSegments,
        }, LLAMA_SOURCE_ARCHIVE, record);
        input.onStep?.('extract');
        await rm(source, { recursive: true, force: true });
        await extractZip(archive, root);
        const entries = await readdir(root);
        const unpacked = entries.find((entry) => entry.startsWith('llama.cpp-'));
        if (unpacked === undefined)
            throw new Error(`${LLAMA_SOURCE_ARCHIVE} did not contain the llama.cpp source`);
        await rm(source, { recursive: true, force: true });
        await renameDir(join(root, unpacked), source);
    }
    input.signal.throwIfAborted();
    input.onStep?.('compile');
    const build = join(root, `build-${input.backend}`);
    await run('cmake', [
        '-S', source,
        '-B', build,
        '-DCMAKE_BUILD_TYPE=Release',
        '-DLLAMA_CURL=OFF',
        ...BACKEND_FLAGS[input.backend],
    ], input.signal);
    await run('cmake', ['--build', build, '-j', String(input.config.threads), '--target', 'llama-mtmd-cli'], input.signal);
    if (!(await executable(binary)))
        throw new Error(`llama.cpp build finished without producing ${binary}`);
    return binary;
}
/**
 * Check a path exists.
 * @param path - absolute path.
 * @returns true when it is present.
 */
async function exists(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Move a directory, which `fs.rename` cannot do across filesystems.
 * @param from - existing directory.
 * @param to - destination.
 */
async function renameDir(from, to) {
    const { rename, cp } = await import('node:fs/promises');
    try {
        await rename(from, to);
    }
    catch {
        await cp(from, to, { recursive: true });
        await rm(from, { recursive: true, force: true });
    }
}
/**
 * Expand a zip archive using the system tool.
 * @param archive - zip file.
 * @param destination - directory to unpack into.
 * @throws when `unzip` is unavailable.
 */
async function extractZip(archive, destination) {
    await run('unzip', ['-q', '-o', archive, '-d', destination], new AbortController().signal);
}
/**
 * Run a build command, surfacing the tail of its output on failure.
 * @param command - executable name.
 * @param argv - arguments.
 * @param signal - cancellation.
 * @throws when the command exits non-zero.
 */
async function run(command, argv, signal) {
    signal.throwIfAborted();
    await new Promise((resolve, reject) => {
        const child = spawn(command, [...argv], { stdio: ['ignore', 'pipe', 'pipe'] });
        let tail = '';
        const abort = () => {
            child.kill('SIGTERM');
        };
        signal.addEventListener('abort', abort, { once: true });
        const collect = (chunk) => {
            tail = `${tail}${chunk.toString('utf8')}`.slice(-4000);
        };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        child.on('error', (error) => {
            signal.removeEventListener('abort', abort);
            reject(new Error(`speech-multi could not run ${command}: ${String(error)}`));
        });
        child.on('close', (code) => {
            signal.removeEventListener('abort', abort);
            if (signal.aborted) {
                reject(new Error(`speech-multi ${command} cancelled`));
                return;
            }
            if (code !== 0) {
                reject(new Error(`speech-multi ${command} ${argv.slice(0, 3).join(' ')} failed: ${tail.trim().slice(-600)}`));
                return;
            }
            resolve();
        });
    });
}
//# sourceMappingURL=build.js.map