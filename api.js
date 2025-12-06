/**
 * API Module - External API calls
 */
export class MemoryAPI {
  constructor(config) {
    this.config = config;
    this.timeout = 10000;
  }

  async saveMemory(characterId, data) {
    try {
      if (!this.config.apiEndpoint) return false;

      const response = await fetch(`${this.config.apiEndpoint}/memory/${characterId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` }),
        },
        body: JSON.stringify(data),
      });

      return response.ok;
    } catch (error) {
      console.error('API error:', error);
      return false;
    }
  }

  async fetchMemory(characterId) {
    try {
      if (!this.config.apiEndpoint) return null;

      const response = await fetch(`${this.config.apiEndpoint}/memory/${characterId}`, {
        headers: this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {},
      });

      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (error) {
      console.error('API error:', error);
      return null;
    }
  }

  async testConnection() {
    try {
      if (!this.config.apiEndpoint) return false;
      const response = await fetch(`${this.config.apiEndpoint}/health`, {
        signal: AbortSignal.timeout(this.timeout),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
