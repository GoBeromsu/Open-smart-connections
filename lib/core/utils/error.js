/**
 * @file error.js - Error normalization utilities
 */

function is_json_compatible(value) {
  if (value === null) return true;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return true;
  if (Array.isArray(value)) return value.every(is_json_compatible);
  if (type === 'object') {
    return Object.values(value).every(is_json_compatible);
  }
  return false;
}

function extract_json_details(source, exclude_keys) {
  const details = {};
  for (const [key, value] of Object.entries(source)) {
    if (exclude_keys.includes(key)) continue;
    if (!is_json_compatible(value)) continue;
    details[key] = value;
  }
  return details;
}

function is_empty_object(obj) {
  return Object.keys(obj).length === 0;
}

function merge_details(first, second) {
  if (is_empty_object(first)) return second;
  if (is_empty_object(second)) return first;
  return { ...first, ...second };
}

function get_message_from_object(value) {
  const raw = value.message;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

/**
 * Normalize errors from various sources into a consistent format.
 * @param {unknown} error
 * @param {number|null} http_status
 * @returns {{ message: string, details: Object|null, http_status: number|null }}
 */
export function normalize_error(error, http_status = null) {
  if (Array.isArray(error) && error.length > 0) {
    return normalize_error(error[0], http_status);
  }
  if (error == null) {
    return { message: 'Unknown error', details: null, http_status };
  }

  if (typeof error === 'string') {
    return { message: error, details: null, http_status };
  }

  if (error instanceof Error) {
    const message = (error.message || '').trim() || 'Unknown error';
    const extra_details = extract_json_details(error, ['message']);
    return {
      message,
      details: is_empty_object(extra_details) ? null : extra_details,
      http_status
    };
  }

  if (typeof error === 'object') {
    const obj = error;

    if ('error' in obj && obj.error != null) {
      const nested_error = obj.error;

      if (typeof nested_error === 'object') {
        const nested_obj = nested_error;
        const nested_message = get_message_from_object(nested_obj);
        const nested_details = extract_json_details(nested_obj, ['message']);
        const outer_details = extract_json_details(obj, ['message', 'error']);
        const combined_details = merge_details(outer_details, nested_details);
        const message = nested_message || get_message_from_object(obj) || 'Unknown error';

        return {
          message,
          details: is_empty_object(combined_details) ? null : combined_details,
          http_status
        };
      }

      return normalize_error(nested_error);
    }

    const object_message = get_message_from_object(obj);
    if (object_message) {
      const details = extract_json_details(obj, ['message']);
      return {
        message: object_message,
        details: is_empty_object(details) ? null : details,
        http_status
      };
    }
  }

  return { message: 'Unknown error', details: null, http_status };
}
