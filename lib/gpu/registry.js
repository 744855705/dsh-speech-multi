/** How long a model may sit unused before its memory is released. */
export const DEFAULT_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const ROOTS = new Map();
/**
 * State for one data root.
 * @param dataRoot - plugin data directory.
 * @returns the residency record.
 */
function residencyFor(dataRoot) {
    let existing = ROOTS.get(dataRoot);
    if (existing === undefined) {
        existing = { active: undefined, idle: undefined };
        ROOTS.set(dataRoot, existing);
    }
    return existing;
}
/**
 * Clear the pending idle timer.
 * @param residency - record to touch.
 */
function cancelIdle(residency) {
    if (residency.idle !== undefined)
        clearTimeout(residency.idle);
    residency.idle = undefined;
}
/**
 * Schedule the release of the active model.
 * @param dataRoot - plugin data directory.
 * @param residency - record to arm.
 * @param timeoutMs - idle period; zero keeps the model resident until something else needs the card.
 */
function armIdle(dataRoot, residency, timeoutMs) {
    cancelIdle(residency);
    if (timeoutMs <= 0)
        return;
    residency.idle = setTimeout(() => {
        residency.idle = undefined;
        void releaseAll(dataRoot);
    }, timeoutMs);
}
/**
 * Stop whatever holds the card.
 * @param dataRoot - plugin data directory.
 */
export async function releaseAll(dataRoot) {
    const residency = residencyFor(dataRoot);
    cancelIdle(residency);
    const active = residency.active;
    residency.active = undefined;
    if (active !== undefined)
        await active.server.stop();
}
/**
 * Mark a CPU provider as the one in use.
 *
 * The reported order matters: a CPU model cannot share the device, so the GPU runtime is stopped
 * immediately rather than left to idle out.
 * @param dataRoot - plugin data directory.
 * @returns after the card has been released.
 */
export async function noteCpuUse(dataRoot) {
    await releaseAll(dataRoot);
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
export async function acquireGpu(dataRoot, id, create, idleTimeoutMs) {
    const residency = residencyFor(dataRoot);
    cancelIdle(residency);
    if (residency.active !== undefined && residency.active.id !== id) {
        const previous = residency.active;
        residency.active = undefined;
        await previous.server.stop();
    }
    const server = residency.active?.server ?? create();
    residency.active = { id, server };
    armIdle(dataRoot, residency, idleTimeoutMs);
    return server;
}
/**
 * Restart the idle countdown for the model in use.
 * @param dataRoot - plugin data directory.
 * @param idleTimeoutMs - how long it may stay unused.
 */
export function touchGpu(dataRoot, idleTimeoutMs) {
    const residency = residencyFor(dataRoot);
    if (residency.active === undefined)
        return;
    armIdle(dataRoot, residency, idleTimeoutMs);
}
/**
 * Stop everything this module started.
 * @param dataRoot - plugin data directory, or undefined for all of them.
 */
export async function shutdownGpu(dataRoot) {
    const roots = dataRoot === undefined ? [...ROOTS.keys()] : [dataRoot];
    for (const root of roots)
        await releaseAll(root);
}
/**
 * Report the resident model, for tests and diagnostics.
 * @param dataRoot - plugin data directory.
 * @returns the provider id, or undefined when nothing holds the card.
 */
export function activeGpu(dataRoot) {
    return ROOTS.get(dataRoot)?.active?.id;
}
//# sourceMappingURL=registry.js.map