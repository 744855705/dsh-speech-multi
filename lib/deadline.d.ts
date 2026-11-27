/** Shared deadline helper: one cancel signal that also expires. */
/** Largest delay `setTimeout` accepts. */
export declare const MAX_TIMER_DELAY_MS = 2147483647;
/**
 * Combine caller cancellation with a deadline.
 * @param signal - caller cancellation.
 * @param milliseconds - deadline, clamped to what timers accept.
 * @returns a signal that aborts on either cause.
 */
export declare function withDeadline(signal: AbortSignal, milliseconds: number): AbortSignal;
