export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000,
): Promise<T> {
  let lastError: Error;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (attempt < maxAttempts) {
        const jitter = Math.random() * 500;
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
        await sleep(delay);
      }
    }
  }
  throw lastError!;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function batchMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
  delayBetweenBatches = 500,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...(await Promise.all(batch.map(fn))));
    if (i + concurrency < items.length) await sleep(delayBetweenBatches);
  }
  return results;
}
