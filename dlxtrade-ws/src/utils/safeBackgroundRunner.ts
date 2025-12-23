/**
 * Safe Background Task Runner
 * 
 * Provides non-blocking background task execution with:
 * - Event loop lag monitoring
 * - Hard timeouts on all tasks
 * - Automatic pause when lag exceeds threshold
 * - Yielding control back to event loop
 */

import { logger } from './logger';

// Configuration
const MAX_ITERATION_TIME_MS = 1000; // Max 1 second per iteration
const EVENT_LOOP_LAG_THRESHOLD_MS = 100; // Pause if lag > 100ms
const EVENT_LOOP_CHECK_INTERVAL_MS = 1000; // Check lag every 1 second
const TASK_TIMEOUT_MS = 30000; // Hard timeout for any background task

// Global state
let eventLoopLag = 0;
let isPaused = false;
let lagCheckInterval: NodeJS.Timeout | null = null;

/**
 * Start event loop lag monitoring
 */
export function startEventLoopMonitoring(): void {
  if (lagCheckInterval) return; // Already started

  let lastCheck = Date.now();

  lagCheckInterval = setInterval(() => {
    const now = Date.now();
    const expectedDelta = EVENT_LOOP_CHECK_INTERVAL_MS;
    const actualDelta = now - lastCheck;
    eventLoopLag = actualDelta - expectedDelta;
    lastCheck = now;

    if (eventLoopLag > EVENT_LOOP_LAG_THRESHOLD_MS) {
      if (!isPaused) {
        isPaused = true;
        logger.warn({ lag: eventLoopLag, threshold: EVENT_LOOP_LAG_THRESHOLD_MS }, 
          '⚠️ [BACKGROUND] Event loop lag detected - pausing background tasks');
        console.log(`⚠️ [BACKGROUND] Event loop lag: ${eventLoopLag}ms - background tasks paused`);
      }
    } else if (isPaused && eventLoopLag < EVENT_LOOP_LAG_THRESHOLD_MS / 2) {
      // Resume only when lag drops to half threshold
      isPaused = false;
      logger.info({ lag: eventLoopLag }, '✅ [BACKGROUND] Event loop recovered - resuming background tasks');
      console.log(`✅ [BACKGROUND] Event loop recovered: ${eventLoopLag}ms - resuming`);
    }
  }, EVENT_LOOP_CHECK_INTERVAL_MS);

  // Unref so it doesn't prevent process exit
  lagCheckInterval.unref();

  logger.info('✅ [BACKGROUND] Event loop monitoring started');
}

/**
 * Stop event loop monitoring
 */
export function stopEventLoopMonitoring(): void {
  if (lagCheckInterval) {
    clearInterval(lagCheckInterval);
    lagCheckInterval = null;
  }
}

/**
 * Check if background tasks should run
 */
export function shouldRunBackgroundTasks(): boolean {
  // Always check env flag first
  if (process.env.DISABLE_AUTOTRADE === 'true') {
    return false;
  }
  return !isPaused;
}

/**
 * Get current event loop lag
 */
export function getEventLoopLag(): number {
  return eventLoopLag;
}

/**
 * Check if background tasks are paused
 */
export function isBackgroundPaused(): boolean {
  return isPaused;
}

/**
 * Wrap a function with a hard timeout
 * Returns a promise that rejects if the function takes too long
 */
export function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = TASK_TIMEOUT_MS,
  taskName: string = 'unknown'
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      const error = new Error(`Task '${taskName}' timed out after ${timeoutMs}ms`);
      logger.warn({ taskName, timeoutMs }, `⏱️ [TIMEOUT] ${error.message}`);
      reject(error);
    }, timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
  });
}

/**
 * Yield control back to the event loop
 * Use this between heavy operations to prevent blocking
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Safe setInterval wrapper that:
 * - Checks if background tasks should run
 * - Adds timeout protection
 * - Yields control between iterations
 * - Logs execution time
 */
export function safeSetInterval(
  callback: () => Promise<void>,
  intervalMs: number,
  taskName: string
): NodeJS.Timeout {
  let isExecuting = false;

  const wrappedCallback = async () => {
    // Skip if already executing (prevent overlap)
    if (isExecuting) {
      logger.debug({ taskName }, `⏭️ [BACKGROUND] Skipping ${taskName} - previous iteration still running`);
      return;
    }

    // Skip if background tasks are paused
    if (!shouldRunBackgroundTasks()) {
      logger.debug({ taskName, paused: isPaused, disabled: process.env.DISABLE_AUTOTRADE === 'true' },
        `⏭️ [BACKGROUND] Skipping ${taskName} - background tasks paused/disabled`);
      return;
    }

    isExecuting = true;
    const startTime = Date.now();

    try {
      // Execute with timeout protection
      await withTimeout(callback, Math.min(MAX_ITERATION_TIME_MS * 30, TASK_TIMEOUT_MS), taskName);
    } catch (err: any) {
      logger.error({ taskName, error: err.message }, `❌ [BACKGROUND] Error in ${taskName}`);
    } finally {
      isExecuting = false;
      const duration = Date.now() - startTime;
      
      if (duration > MAX_ITERATION_TIME_MS) {
        logger.warn({ taskName, duration, threshold: MAX_ITERATION_TIME_MS },
          `⚠️ [BACKGROUND] ${taskName} took ${duration}ms (exceeds ${MAX_ITERATION_TIME_MS}ms threshold)`);
      }

      // Yield control back to event loop
      await yieldToEventLoop();
    }
  };

  // Use setInterval but with safe wrapper
  const intervalId = setInterval(() => {
    // Fire and forget - don't await in setInterval
    wrappedCallback().catch((err) => {
      logger.error({ taskName, error: err.message }, `❌ [BACKGROUND] Unhandled error in ${taskName}`);
    });
  }, intervalMs);

  logger.info({ taskName, intervalMs }, `✅ [BACKGROUND] Started safe interval for ${taskName}`);

  return intervalId;
}

/**
 * Run a background task safely with timeout and yield
 * Use this for one-off background operations
 */
export async function runBackgroundTask<T>(
  taskFn: () => Promise<T>,
  taskName: string,
  timeoutMs: number = TASK_TIMEOUT_MS
): Promise<T | null> {
  // Check if background tasks should run
  if (!shouldRunBackgroundTasks()) {
    logger.debug({ taskName }, `⏭️ [BACKGROUND] Skipping ${taskName} - background tasks paused/disabled`);
    return null;
  }

  const startTime = Date.now();

  try {
    const result = await withTimeout(taskFn, timeoutMs, taskName);
    const duration = Date.now() - startTime;
    
    if (duration > MAX_ITERATION_TIME_MS) {
      logger.warn({ taskName, duration }, `⚠️ [BACKGROUND] ${taskName} took ${duration}ms`);
    }

    return result;
  } catch (err: any) {
    logger.error({ taskName, error: err.message }, `❌ [BACKGROUND] Error in ${taskName}`);
    return null;
  } finally {
    // Yield control back to event loop
    await yieldToEventLoop();
  }
}

/**
 * Wrap external API calls with timeout
 * Use this for exchange, research, analytics calls
 */
export async function safeExternalCall<T>(
  callFn: () => Promise<T>,
  callName: string,
  timeoutMs: number = 10000 // Default 10s for external calls
): Promise<T> {
  const startTime = Date.now();

  try {
    const result = await withTimeout(callFn, timeoutMs, callName);
    const duration = Date.now() - startTime;
    
    logger.debug({ callName, duration }, `[EXTERNAL] ${callName} completed in ${duration}ms`);
    return result;
  } catch (err: any) {
    const duration = Date.now() - startTime;
    logger.warn({ callName, duration, error: err.message }, `[EXTERNAL] ${callName} failed after ${duration}ms`);
    throw err;
  }
}

// Export configuration for testing/tuning
export const config = {
  MAX_ITERATION_TIME_MS,
  EVENT_LOOP_LAG_THRESHOLD_MS,
  EVENT_LOOP_CHECK_INTERVAL_MS,
  TASK_TIMEOUT_MS,
};

