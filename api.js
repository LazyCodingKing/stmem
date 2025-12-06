/**
 * API Module - Handles external API calls and memory storage
 */
export class MemoryAPI {
  constructor(config) {
    this.config = config;
    this.timeout = 10000;
    this.retries = 3;
  }

  /**
   * Fetch memory summary from API
   * @param {string} characterId - Character identifier
   * @returns {Promise<Object>} - Memory data
   */
  async fetchMemory(characterId) {
    try {
      if (!characterId) {
        throw new Error('Character ID is required');
      }

      const endpoint = `${this.config.apiEndpoint}/memory/${characterId}`;
      return await this.makeRequest('GET', endpoint);
    } catch (error) {
      console.error('Error fetching memory:', error);
      return null;
    }
  }

  /**
   * Save memory summary to API
   * @param {string} characterId - Character identifier
   * @param {Object} data - Memory data
   * @returns {Promise<boolean>} - Success status
   */
  async saveMemory(characterId, data) {
    try {
      if (!characterId || !data) {
        throw new Error('Character ID and data are required');
      }

      const endpoint = `${this.config.apiEndpoint}/memory/${characterId}`;
      const result = await this.makeRequest('POST', endpoint, data);
      return result !== null;
    } catch (error) {
      console.error('Error saving memory:', error);
      return false;
    }
  }

  /**
   * Make HTTP request with retry logic
   * @param {string} method - HTTP method
   * @param {string} url - URL endpoint
   * @param {Object} data - Request body (optional)
   * @returns {Promise<Object>} - Response data
   */
  async makeRequest(method, url, data = null) {
    let lastError = null;

    for (let attempt = 0; attempt < this.retries; attempt++) {
      try {
        const options = {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: this.timeout,
        };

        if (this.config.apiKey) {
          options.headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        }

        if (data) {
          options.body = JSON.stringify(data);
        }

        const response = await fetch(url, options);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
      } catch (error) {
        lastError = error;
        console.warn(`Request attempt ${attempt + 1} failed:`, error);

        // Exponential backoff
        if (attempt < this.retries - 1) {
          await this.delay(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  /**
   * Delay execution
   * @param {number} ms - Milliseconds to delay
   */
  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Test API connection
   * @returns {Promise<boolean>} - Connection status
   */
  async testConnection() {
    try {
      if (!this.config.apiEndpoint) {
        return false; // No endpoint configured
      }

      const response = await this.makeRequest('GET', `${this.config.apiEndpoint}/health`);
      return response !== null;
    } catch (error) {
      console.error('API connection test failed:', error);
      return false;
    }
  }

  /**
   * Validate API configuration
   * @returns {Object} - Validation result
   */
  validateConfig() {
    const errors = [];

    if (!this.config.apiEndpoint) {
      errors.push('API endpoint is not configured');
    }

    if (this.config.apiEndpoint && !this.isValidUrl(this.config.apiEndpoint)) {
      errors.push('API endpoint is not a valid URL');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if string is valid URL
   * @param {string} str - String to validate
   * @returns {boolean} - Validity
   */
  isValidUrl(str) {
    try {
      new URL(str);
      return true;
    } catch {
      return false;
    }
  }
}
