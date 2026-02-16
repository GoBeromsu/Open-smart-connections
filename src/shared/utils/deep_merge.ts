/**
 * @file deep_merge.ts
 * @description Deep merge utility for objects
 */

/**
 * Check if value is a plain object
 */
function is_plain_object(o: any): o is Record<string, any> {
  return o && typeof o === 'object' && !Array.isArray(o);
}

/**
 * Deeply merge two objects, giving precedence to the source.
 * Mutates the target object.
 *
 * @param target Target object (mutated)
 * @param source Source object
 * @returns Mutated target
 */
export function deep_merge<T extends Record<string, any>>(
  target: T = {} as T,
  source: Partial<T> = {},
): T {
  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;

    if (is_plain_object(source[key]) && is_plain_object(target[key])) {
      deep_merge(target[key], source[key]);
    } else {
      target[key] = source[key] as T[Extract<keyof T, string>];
    }
  }

  return target;
}
