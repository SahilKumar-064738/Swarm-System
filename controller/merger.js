'use strict';

/**
 * merger.js — detects output type and merges subtask results.
 *
 * Merge strategies (guide Section 7):
 *   numbers      → sum all values
 *   JSON arrays  → concatenate in chunk order
 *   JSON objects → deep merge, numeric values summed
 *   plain text   → concatenate in chunk order, newline-separated
 *
 * ALWAYS merge in ascending chunk/task index order, never arrival order.
 */

/**
 * Attempt to parse a raw stdout string as JSON.
 * Returns the parsed value on success, or null on failure.
 */
function tryParseJSON(str) {
  try {
    return JSON.parse(str.trim());
  } catch (_) {
    return null;
  }
}

/**
 * Deep-merge two plain objects.
 * Numeric leaf values are summed; other types: b wins over a.
 */
function deepMergeObjects(a, b) {
  const result = Object.assign({}, a);
  for (const key of Object.keys(b)) {
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      if (typeof result[key] === 'number' && typeof b[key] === 'number') {
        result[key] = result[key] + b[key];
      } else if (
        typeof result[key] === 'object' && result[key] !== null &&
        typeof b[key]      === 'object' && b[key]      !== null &&
        !Array.isArray(result[key]) && !Array.isArray(b[key])
      ) {
        result[key] = deepMergeObjects(result[key], b[key]);
      } else {
        result[key] = b[key]; // last write wins for non-numeric scalars
      }
    } else {
      result[key] = b[key];
    }
  }
  return result;
}

/**
 * Detect the output type from an ordered array of raw stdout strings.
 *
 * Returns one of: 'number' | 'array' | 'object' | 'text'
 */
function detectType(rawResults) {
  const parsed = rawResults.map(tryParseJSON);

  if (parsed.every(v => v !== null && typeof v === 'number')) {
    return 'number';
  }
  if (parsed.every(v => Array.isArray(v))) {
    return 'array';
  }
  if (parsed.every(v => v !== null && typeof v === 'object' && !Array.isArray(v))) {
    return 'object';
  }

  // Mixed or non-JSON → warn and fall back to text
  if (parsed.some(v => v !== null) && !parsed.every(v => v !== null)) {
    console.warn('[merger] WARNING: inconsistent result types across chunks — falling back to plain-text concat');
  }

  return 'text';
}

/**
 * Merge an ordered array of raw stdout strings into a single result value.
 *
 * @param {string[]} rawResults — ordered array of stdout strings (chunk_0 first)
 * @returns {{ type: string, value: any }}
 */
function mergeResults(rawResults) {
  if (!rawResults || rawResults.length === 0) {
    return { type: 'text', value: '' };
  }

  const type = detectType(rawResults);

  switch (type) {
    case 'number': {
      const sum = rawResults.reduce((acc, r) => acc + JSON.parse(r.trim()), 0);
      return { type, value: sum };
    }

    case 'array': {
      const merged = rawResults.reduce((acc, r) => {
        return acc.concat(JSON.parse(r.trim()));
      }, []);
      return { type, value: merged };
    }

    case 'object': {
      const merged = rawResults.reduce((acc, r) => {
        return deepMergeObjects(acc, JSON.parse(r.trim()));
      }, {});
      return { type, value: merged };
    }

    case 'text':
    default: {
      const merged = rawResults.join('\n').replace(/\n+$/, '');
      return { type, value: merged };
    }
  }
}

module.exports = { mergeResults, detectType, deepMergeObjects };
