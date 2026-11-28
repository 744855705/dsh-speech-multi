/**
 * GPU backend detection.
 *
 * The plugin cannot assume a vendor: the same build has to light up on a ROCm workstation, a CUDA
 * box, and an older card that only has Vulkan. Detection therefore probes the toolchains that are
 * actually installed and reports the best one, plus how much memory the device has, so the catalog
 * can decide which models to offer.
 *
 * Integrated GPUs are excluded, not just deprioritised. Every modern desktop ships one, the drivers
 * list it next to the discrete card, and its shared memory reads as a large number; a model placed
 * there would run an order of magnitude slower while the discrete card sat idle.
 */
import { execFileSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
/**
 * Names an integrated GPU reports on the AMD stack.
 *
 * An APU is enumerated as a card whose product name is the *CPU* — "AMD Ryzen 7 9700X 8-Core
 * Processor" — or as a bare "Radeon(TM) Graphics" with no model number, while a discrete card
 * always carries a model designation.
 */
const INTEGRATED_PATTERNS = [
    /\bRyzen\b/iu,
    /\bProcessor\b/iu,
    /\bAPU\b/iu,
    /Radeon(?:\(TM\)|™)?\s*Graphics\b/iu,
    /\bVega\s+\d+\b/iu,
];
/**
 * Whether a device name belongs to an integrated GPU.
 * @param name - driver-reported product name.
 * @returns true when the device is part of the CPU package.
 */
export function isIntegratedName(name) {
    return INTEGRATED_PATTERNS.some((pattern) => pattern.test(name));
}
/**
 * Choose the device a model should run on.
 *
 * Integrated devices are dropped outright, then the largest remaining one wins: a machine with two
 * discrete cards should use the roomier one, and a machine with only an integrated GPU yields
 * undefined so the plugin offers no GPU provider at all.
 * @param devices - devices as reported by one driver.
 * @returns the selected device, or undefined when only integrated devices were reported.
 */
export function pickDiscreteDevice(devices) {
    let best;
    for (const device of devices) {
        if (device.integrated === true)
            continue;
        if (isIntegratedName(device.name))
            continue;
        if (!Number.isFinite(device.vramBytes) || device.vramBytes <= 0)
            continue;
        if (best === undefined || device.vramBytes > best.vramBytes)
            best = device;
    }
    return best;
}
/**
 * Whether a path exists and is executable.
 * @param path - absolute path.
 * @returns true when it can be executed.
 */
function executable(path) {
    try {
        accessSync(path, constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Run a probe command and return its standard output.
 * @param command - executable name.
 * @param argv - arguments.
 * @returns standard output, or undefined when the command is missing or fails.
 */
function probe(command, argv) {
    try {
        return execFileSync(command, [...argv], { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] });
    }
    catch {
        return undefined;
    }
}
/**
 * List the devices the ROCm tooling reports.
 * @returns per-card name and memory, or undefined when rocm-smi is absent or unparsable.
 */
function rocmDevices() {
    const stdout = probe('rocm-smi', ['--showmeminfo', 'vram', '--showproductname', '--json']);
    if (stdout === undefined)
        return undefined;
    try {
        const parsed = JSON.parse(stdout);
        if (typeof parsed !== 'object' || parsed === null)
            return undefined;
        const devices = [];
        for (const value of Object.values(parsed)) {
            if (typeof value !== 'object' || value === null)
                continue;
            const record = value;
            const vramBytes = Number(record['VRAM Total Memory (B)']);
            if (!Number.isFinite(vramBytes) || vramBytes <= 0)
                continue;
            const series = record['Card Series'];
            devices.push({ name: typeof series === 'string' && series.length > 0 ? series : 'AMD GPU', vramBytes });
        }
        return devices.length > 0 ? devices : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * List the devices nvidia-smi reports.
 *
 * NVIDIA workstations expose only discrete cards, so the integrated-GPU filter is a no-op here;
 * it still runs, because a Jetson-style unified-memory device must not silently win the selection.
 * @returns per-card name and memory, or undefined when nvidia-smi is absent.
 */
function cudaDevices() {
    const stdout = probe('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
    if (stdout === undefined)
        return undefined;
    const devices = [];
    for (const line of stdout.trim().split('\n')) {
        const [name, mib] = line.split(',').map((part) => part.trim());
        const vramBytes = Number(mib) * 1024 * 1024;
        if (name !== undefined && Number.isFinite(vramBytes) && vramBytes > 0)
            devices.push({ name, vramBytes });
    }
    return devices.length > 0 ? devices : undefined;
}
/**
 * List the devices Vulkan reports, using the driver's own device class.
 *
 * This is the one backend that states the device type explicitly, so its answer is taken as-is
 * rather than guessed from the name.
 * @returns per-device name, memory and class, or undefined when vulkaninfo is absent.
 */
function vulkanDevices() {
    const stdout = probe('vulkaninfo', ['--summary']);
    if (stdout === undefined)
        return undefined;
    const devices = [];
    const blocks = stdout.split(/GPU\d+:/u);
    for (const block of blocks) {
        const name = /deviceName\s*=\s*(.+)/u.exec(block)?.[1]?.trim();
        if (name === undefined)
            continue;
        const type = /deviceType\s*=\s*(\S+)/u.exec(block)?.[1] ?? '';
        let vramBytes = 0;
        for (const match of block.matchAll(/(\d+)\s*MiB/gu))
            vramBytes = Math.max(vramBytes, Number(match[1]) * 1024 * 1024);
        devices.push({ name, vramBytes, integrated: type.includes('INTEGRATED') });
    }
    return devices.length > 0 ? devices : undefined;
}
/**
 * Probe the machine for a usable discrete GPU.
 *
 * Preference order is HIP, then CUDA, then Vulkan: the first two build against the vendor's own
 * math libraries and are measurably faster than the portable path, while Vulkan is what remains
 * usable on an older card that has no vendor stack installed.
 * @param prefer - force one backend, for testing and for pinning a machine's choice.
 * @returns the device, or undefined when no discrete GPU is available.
 */
export function detectGpu(prefer) {
    const candidates = [
        { backend: 'hip', ready: () => executable('/opt/rocm/bin/hipcc'), list: rocmDevices },
        {
            backend: 'cuda',
            ready: () => executable('/usr/local/cuda/bin/nvcc') || executable('/opt/cuda/bin/nvcc'),
            list: cudaDevices,
        },
        {
            backend: 'vulkan',
            ready: () => executable('/usr/bin/glslc') && executable('/usr/bin/vulkaninfo'),
            list: vulkanDevices,
        },
    ];
    for (const candidate of candidates) {
        if (prefer !== undefined && prefer !== candidate.backend)
            continue;
        if (!candidate.ready())
            continue;
        const devices = candidate.list();
        if (devices === undefined)
            continue;
        const device = pickDiscreteDevice(devices);
        if (device === undefined)
            continue;
        return { backend: candidate.backend, vramBytes: device.vramBytes, name: device.name };
    }
    return undefined;
}
//# sourceMappingURL=backend.js.map