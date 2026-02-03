/**
 * @file async.js - Async utilities
 */

/**
 * Delay execution for a number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sequentially executes an array of asynchronous functions, passing the result of each function
 * as the input to the next, along with an optional options object.
 * @param {Function[]} funcs - An array of functions to execute sequentially.
 * @param {*} initial_value - The initial value to pass to the first function.
 * @param {Object} opts - Optional parameters to pass to each function.
 * @returns {*} The final value after all functions have been executed.
 */
export async function sequential_async_processor(funcs, initial_value, opts = {}) {
  let value = initial_value;
  for (const func of funcs) {
    if (typeof func !== 'function') {
      throw new TypeError('All elements in async_functions array must be functions');
    }
    value = await func(value, opts);
  }
  return value;
}
