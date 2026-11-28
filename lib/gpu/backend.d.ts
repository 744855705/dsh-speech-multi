/** Backend llama.cpp is built against. */
export type GpuBackend = 'hip' | 'cuda' | 'vulkan';
/** What the machine can offer. */
export interface GpuDevice {
    /** Backend to build llama.cpp with. */
    readonly backend: GpuBackend;
    /** Total device memory in bytes; 0 when the driver will not say. */
    readonly vramBytes: number;
    /** Driver-provided device name, for the log line only. */
    readonly name: string;
}
/** One device as a driver reported it, before any filtering. */
export interface RawDevice {
    /** Driver-provided name. */
    readonly name: string;
    /** Total memory in bytes. */
    readonly vramBytes: number;
    /** Set when the driver itself says the device is integrated. */
    readonly integrated?: boolean | undefined;
}
/**
 * Whether a device name belongs to an integrated GPU.
 * @param name - driver-reported product name.
 * @returns true when the device is part of the CPU package.
 */
export declare function isIntegratedName(name: string): boolean;
/**
 * Choose the device a model should run on.
 *
 * Integrated devices are dropped outright, then the largest remaining one wins: a machine with two
 * discrete cards should use the roomier one, and a machine with only an integrated GPU yields
 * undefined so the plugin offers no GPU provider at all.
 * @param devices - devices as reported by one driver.
 * @returns the selected device, or undefined when only integrated devices were reported.
 */
export declare function pickDiscreteDevice(devices: readonly RawDevice[]): RawDevice | undefined;
/**
 * Probe the machine for a usable discrete GPU.
 *
 * Preference order is HIP, then CUDA, then Vulkan: the first two build against the vendor's own
 * math libraries and are measurably faster than the portable path, while Vulkan is what remains
 * usable on an older card that has no vendor stack installed.
 * @param prefer - force one backend, for testing and for pinning a machine's choice.
 * @returns the device, or undefined when no discrete GPU is available.
 */
export declare function detectGpu(prefer?: GpuBackend | undefined): GpuDevice | undefined;
