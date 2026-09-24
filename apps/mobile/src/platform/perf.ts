/** Anything slower than this is logged; quicker work is not worth the noise. */
const LOG_OVER_MS = 16;

/**
 * Runs `work` and, when it took longer than a frame, logs how long under a `[perf]` tag. Release builds log too,
 * so the time a page takes to build on a real device can be read with `adb logcat -s ReactNativeJS | findstr perf`.
 */
export function timed<T>(label: string, work: () => T): T {
  const started = Date.now();
  try {
    return work();
  } finally {
    const took = Date.now() - started;
    if (took > LOG_OVER_MS) console.log(`[perf] ${label} ${took}ms`);
  }
}
