/** Shared deadline helper: one cancel signal that also expires. */

/** Largest delay `setTimeout` accepts. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/**
 * Combine caller cancellation with a deadline.
 * @param signal - caller cancellation.
 * @param milliseconds - deadline, clamped to what timers accept.
 * @returns a signal that aborts on either cause.
 */
export function withDeadline(signal: AbortSignal, milliseconds: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(Math.min(Math.max(1, milliseconds), MAX_TIMER_DELAY_MS))])
}
