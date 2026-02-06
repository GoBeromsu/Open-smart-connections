/**
 * @file sequential_async_processor.ts
 * @description Sequential execution of async functions with value passing
 */

/**
 * Async processor function signature
 */
export type AsyncProcessorFn<T = any, O = any> = (value: T, opts: O) => Promise<T>;

/**
 * Sequentially executes an array of asynchronous functions, passing the result
 * of each function as input to the next, along with an optional options object.
 *
 * @param funcs Array of async functions to execute sequentially
 * @param initial_value Initial value to pass to first function
 * @param opts Optional parameters to pass to each function
 * @returns Final value after all functions executed
 * @throws Error if any function throws or if array contains non-functions
 */
export async function sequential_async_processor<T = any, O = any>(
  funcs: AsyncProcessorFn<T, O>[],
  initial_value: T,
  opts: O = {} as O,
): Promise<T> {
  let value = initial_value;

  for (const func of funcs) {
    // Ensure each element is a function
    if (typeof func !== 'function') {
      throw new TypeError('All elements in funcs array must be functions');
    }

    try {
      value = await func(value, opts);
    } catch (error) {
      // Rethrow to halt execution
      throw error;
    }
  }

  return value;
}
