/**
 * Utility Module
 */
export class Logger {
  constructor(name) {
    this.name = name;
  }

  log(...args) {
    console.log(`[${this.name}]`, ...args);
  }

  warn(...args) {
    console.warn(`[${this.name}]`, ...args);
  }

  error(...args) {
    console.error(`[${this.name}]`, ...args);
  }
}

export function validateConfig(config) {
  return {
    valid: typeof config === 'object' && config !== null,
    errors: [],
  };
}

export function debounce(func, delay) {
  let timeoutId = null;
  return function (...args) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func.apply(this, args);
      timeoutId = null;
    }, delay);
  };
}
