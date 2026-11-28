/**
 * Which GPU model is resident, and for how long.
 *
 * Only one model may hold device memory at a time. A card that kept every prepared model loaded
 * would reserve several gigabytes for models nobody is using, and the user asked for the opposite:
 * switching models unloads the old weights at once, and switching to a CPU model stops the GPU
 * runtime entirely.
 *
 * Residency is therefore decided by use rather than by the settings page: whichever provider is
 * asked to transcribe is the one that stays, and the others are stopped before the new one starts.
 */
import type { LlamaServer } from './server.ts'

/** How long a model may sit unused before its memory is released. */
export const DEFAULT_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000

/** A server the registry can stop without knowing which model it belongs to. */
export interface ResidentServer {
  readonly id: string
  readonly server: LlamaServer
}

/** Everything resident for one data root. */
interface Residency {
  active: ResidentServer | undefined
  idle: ReturnType<typeof setTimeout> | undefined
}

const ROOTS = new Map<string, Residency>()

/**
 * State for one data root.
 * @param dataRoot - plugin data directory.
 * @returns the residency record.
 */
function residencyFor(dataRoot: string): Residency {
  let existing = ROOTS.get(dataRoot)
  if (existing === undefined) {
    existing = { active: undefined, idle: undefined }
    ROOTS.set(dataRoot, existing)
  }
  return existing
}

/**
 * Clear the pending idle timer.
 * @param residency - record to touch.
 */
function cancelIdle(residency: Residency): void {
  if (residency.idle !== undefined) clearTimeout(residency.idle)
  residency.idle = undefined
}

/**
 * Schedule the release of the active model.
 * @param dataRoot - plugin data directory.
 * @param residency - record to arm.
 * @param timeoutMs - idle period; zero keeps the model resident until something else needs the card.
 */
function armIdle(dataRoot: string, residency: Residency, timeoutMs: number): void {
  cancelIdle(residency)
  if (timeoutMs <= 0) return
  residency.idle = setTimeout(() => {
    residency.idle = undefined
    void releaseAll(dataRoot)
  }, timeoutMs)
}

/**
 * Stop whatever holds the card.
 * @param dataRoot - plugin data directory.
 */
export async function releaseAll(dataRoot: string): Promise<void> {
  const residency = residencyFor(dataRoot)
  cancelIdle(residency)
  const active = residency.active
  residency.active = undefined
  if (active !== undefined) await active.server.stop()
}

/**
 * Mark a CPU provider as the one in use.
 *
 * The reported order matters: a CPU model cannot share the device, so the GPU runtime is stopped
 * immediately rather than left to idle out.
 * @param dataRoot - plugin data directory.
 * @returns after the card has been released.
 */
export async function noteCpuUse(dataRoot: string): Promise<void> {
  await releaseAll(dataRoot)
}

/**
 * Make one GPU model the resident one.
 *
 * The caller supplies a factory so the registry can stop the previous model before anything new is
 * loaded: starting first would need memory for both, which is exactly the situation this avoids.
 * @param dataRoot - plugin data directory.
 * @param id - provider id of the model being used.
 * @param create - builds the server for that model.
 * @param idleTimeoutMs - how long it may stay unused.
 * @returns the resident server.
 */
export async function acquireGpu(
  dataRoot: string,
  id: string,
  create: () => LlamaServer,
  idleTimeoutMs: number,
): Promise<LlamaServer> {
  const residency = residencyFor(dataRoot)
  cancelIdle(residency)
  if (residency.active !== undefined && residency.active.id !== id) {
    const previous = residency.active
    residency.active = undefined
    await previous.server.stop()
  }
  const server = residency.active?.server ?? create()
  residency.active = { id, server }
  armIdle(dataRoot, residency, idleTimeoutMs)
  return server
}

/**
 * Restart the idle countdown for the model in use.
 * @param dataRoot - plugin data directory.
 * @param idleTimeoutMs - how long it may stay unused.
 */
export function touchGpu(dataRoot: string, idleTimeoutMs: number): void {
  const residency = residencyFor(dataRoot)
  if (residency.active === undefined) return
  armIdle(dataRoot, residency, idleTimeoutMs)
}

/**
 * Stop everything this module started.
 * @param dataRoot - plugin data directory, or undefined for all of them.
 */
export async function shutdownGpu(dataRoot?: string | undefined): Promise<void> {
  const roots = dataRoot === undefined ? [...ROOTS.keys()] : [dataRoot]
  for (const root of roots) await releaseAll(root)
}

/**
 * Report the resident model, for tests and diagnostics.
 * @param dataRoot - plugin data directory.
 * @returns the provider id, or undefined when nothing holds the card.
 */
export function activeGpu(dataRoot: string): string | undefined {
  return ROOTS.get(dataRoot)?.active?.id
}
