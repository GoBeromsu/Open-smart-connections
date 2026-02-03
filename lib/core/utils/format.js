/**
 * @file format.js - String and data formatting utilities
 */

/**
 * Converts a timestamp to a human readable relative time string.
 * @param {number} timestamp
 * @returns {string}
 */
export function convert_to_time_ago(timestamp) {
  const now = Date.now();
  const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  const diff_ms = now - ms;
  const is_future = diff_ms < 0;
  const seconds = Math.floor(Math.abs(diff_ms) / 1000);
  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 },
    { label: 'second', seconds: 1 }
  ];
  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds);
    if (count >= 1) {
      const suffix = `${count} ${interval.label}${count > 1 ? 's' : ''}`;
      return is_future ? `in ${suffix}` : `${suffix} ago`;
    }
  }
  return 'just now';
}

/**
 * Format a byte count as a human readable string.
 * @param {number} size
 * @returns {string}
 */
export function convert_to_human_readable_size(size = 0) {
  if (size > 1000000) {
    return `${(size / 1000000).toFixed(1)} MB`;
  }
  if (size > 1000) {
    return `${(size / 1000).toFixed(1)} KB`;
  }
  return `${size} bytes`;
}

/**
 * Escape HTML special characters.
 * @param {string} str
 * @returns {string}
 */
export function escape_html(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Convert CamelCase or camelCase to snake_case.
 * @param {string} str - Input string in camel or Pascal case.
 * @returns {string} snake_case string.
 */
export function camel_case_to_snake_case(str = '') {
  return str
    .replace(/([A-Z])/g, m => `_${m.toLowerCase()}`)
    .replace(/^_/, '')
    .replace(/2$/, '');
}

/**
 * Convert a string to PascalCase.
 * @param {string} str input string
 * @returns {string} PascalCase string
 */
export function to_pascal_case(str = '') {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-\s]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join('');
}
