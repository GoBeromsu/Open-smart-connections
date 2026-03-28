/**
 * @file process-in-chunks.ts
 * @description Chunked async processing helper that yields between chunks.
 */

export async function processInChunks<T, R>(
  items: T[],
  chunkSize: number,
  processFn: (chunk: T[]) => Promise<R[]>,
  yieldFn: () => Promise<void> = () => new Promise((resolve) => queueMicrotask(resolve)),
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await processFn(chunk);
    for (let j = 0; j < chunkResults.length; j++) {
      results.push(chunkResults[j] as R);
    }
    if (i + chunkSize < items.length) {
      await yieldFn();
    }
  }

  return results;
}
