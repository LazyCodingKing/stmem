/**
 * Utility Module - Helper functions and logging
 */

/**
 * Logger class for consistent logging
 */
export class Logger {
  constructor(name) {
    this.name = name;
    this.logLevel = 'info'; // 'error', 'warn', 'info', 'debug'
  }

  /**
   * Log information
   */
  log(...args) {
    if (this.shouldLog('info')) {
      console.log(`[${this.name}]`, ...args);
    }
  }

  /**
   * Log warning
   */
  warn(...args) {
    if (this.shouldLog('warn')) {
      console.warn(`[${this.name}]`, ...args);
    }
  }

  /**
   * Log error
   */
  error(...args) {
    if (this.shouldLog('error')) {
      console.error(`[${this.name}]`, ...args);
    }
  }

  /**
   * Log debug info
   */
  debug(...args) {
    if (this.shouldLog('debug')) {
      console.debug(`[${this.name}]`, ...args);
    }
  }

  /**
   * Check if should log at this level
   */
  shouldLog(level) {
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    return levels[level] <= levels[this.logLevel];
  }

  /**
   * Set log level
   */
  setLevel(level) {
    if (['error', 'warn', 'info', 'debug'].includes(level)) {
      this.logLevel = level;
    }
  }
}

/**
 * Validate configuration object
 * @param {Object} config - Configuration to validate
 * @returns {Object} - Validation result
 */
export function validateConfig(config) {
  const errors = [];

  if (typeof config !== 'object' || config === null) {
    errors.push('Config must be an object');
    return { valid: false, errors };
  }

  // Validate specific fields if needed
  if (config.updateInterval && typeof config.updateInterval !== 'number') {
    errors.push('updateInterval must be a number');
  }

  if (config.maxHistoryLines && typeof config.maxHistoryLines !== 'number') {
    errors.push('maxHistoryLines must be a number');
  }

  if (config.summaryLength) {
    const validLengths = ['short', 'medium', 'long'];
    if (!validLengths.includes(config.summaryLength)) {
      errors.push(`summaryLength must be one of: ${validLengths.join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Debounce function execution
 * @param {Function} func - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} - Debounced function
 */
export function debounce(func, delay) {
  let timeoutId = null;

  return function debounced(...args) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func.apply(this, args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Throttle function execution
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} - Throttled function
 */
export function throttle(func, limit) {
  let lastCall = 0;

  return function throttled(...args) {
    const now = Date.now();

    if (now - lastCall >= limit) {
      func.apply(this, args);
      lastCall = now;
    }
  };
}

/**
 * Deep clone object
 * @param {Object} obj - Object to clone
 * @returns {Object} - Cloned object
 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }

  if (obj instanceof Array) {
    return obj.map((item) => deepClone(item));
  }

  if (obj instanceof Object) {
    const cloned = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = deepClone(obj[key]);
      }
    }
    return cloned;
  }
}

/**
 * Sanitize string for safe display
 * @param {string} str - String to sanitize
 * @returns {string} - Sanitized string
 */
export function sanitizeString(str) {
  if (typeof str !== 'string') {
    return '';
  }

  // Escape HTML special characters
  const escaped = str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');

  return escaped;
}

/**
 * Check if object is empty
 * @param {Object} obj - Object to check
 * @returns {boolean} - True if empty
 */
export function isEmpty(obj) {
  if (obj === null || obj === undefined) {
    return true;
  }

  if (obj instanceof Array) {
    return obj.length === 0;
  }

  if (obj instanceof Object) {
    return Object.keys(obj).length === 0;
  }

  if (typeof obj === 'string') {
    return obj.trim().length === 0;
  }

  return false;
}

/**
 * Get current timestamp formatted
 * @returns {string} - Formatted timestamp
 */
export function getTimestamp() {
  const now = new Date();
  return now.toISOString();
}

/**
 * Parse memory entry
 * @param {string|Object} entry - Memory entry to parse
 * @returns {Object} - Parsed entry
 */
export function parseMemoryEntry(entry) {
  try {
    if (typeof entry === 'string') {
      return JSON.parse(entry);
    }
    return entry;
  } catch (error) {
    console.error('Error parsing memory entry:', error);
    return null;
  }
}

/**
 * Format memory for display
 * @param {Object} memory - Memory object
 * @returns {string} - Formatted string
 */
export function formatMemory(memory) {
  try {
    if (!memory) return '';

    let formatted = '';

    if (memory.summary) {
      formatted += `Summary: ${memory.summary}\n`;
    }

    if (memory.details) {
      formatted += `Details: ${memory.details}\n`;
    }

    if (memory.timestamp) {
      formatted += `Last Updated: ${new Date(memory.timestamp).toLocaleString()}\n`;
    }

    return formatted.trim();
  } catch (error) {
    console.error('Error formatting memory:', error);
    return '';
  }
}
