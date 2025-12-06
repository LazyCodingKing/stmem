import { Summarizer } from './summarizer.js';
import { MemoryAPI } from './api.js';
import { Logger, validateConfig } from './utils.js';

/**
 * Memory Summarize Plugin for SillyTavern
 * Intelligently summarizes and manages character memory
 */
class MemorySummarizePlugin {
  constructor() {
    this.logger = new Logger('MemorySummarize');
    this.config = {
      enabled: true,
      autoSummarize: true,
      summaryLength: 'medium',
      updateInterval: 300000, // 5 minutes
      maxHistoryLines: 50,
      apiEndpoint: null,
      apiKey: null,
    };
    this.summarizer = null;
    this.api = null;
    this.memoryBuffer = [];
    this.lastSummaryTime = 0;
    this.isInitialized = false;
  }

  /**
   * Initialize the plugin
   * @param {Object} sillytavernAPI - SillyTavern API
   */
  async init(sillytavernAPI) {
    try {
      this.logger.log('Initializing Memory Summarize Plugin...');

      // Validate SillyTavern API
      if (!sillytavernAPI) {
        throw new Error('SillyTavern API not provided');
      }

      // Initialize submodules
      this.summarizer = new Summarizer(this.config);
      this.api = new MemoryAPI(this.config);

      // Load saved configuration
      await this.loadConfig();

      // Register event listeners
      this.registerEventListeners(sillytavernAPI);

      // Create UI elements
      this.createUI();

      this.isInitialized = true;
      this.logger.log('Plugin initialized successfully');

      return true;
    } catch (error) {
      this.logger.error('Initialization failed:', error);
      return false;
    }
  }

  /**
   * Load configuration from storage
   */
  async loadConfig() {
    try {
      // In a real implementation, load from localStorage or API
      const savedConfig = localStorage.getItem('memorySummarize_config');
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        this.config = { ...this.config, ...parsed };
        this.logger.log('Configuration loaded');
      }
    } catch (error) {
      this.logger.warn('Could not load saved config:', error);
    }
  }

  /**
   * Save configuration to storage
   */
  async saveConfig() {
    try {
      localStorage.setItem('memorySummarize_config', JSON.stringify(this.config));
      this.logger.log('Configuration saved');
    } catch (error) {
      this.logger.error('Could not save config:', error);
    }
  }

  /**
   * Register event listeners
   */
  registerEventListeners(sillytavernAPI) {
    try {
      // Listen for new messages
      if (sillytavernAPI.eventSource) {
        sillytavernAPI.eventSource.on('message', (message) => {
          this.onMessageReceived(message);
        });

        sillytavernAPI.eventSource.on('character_loaded', () => {
          this.onCharacterLoaded();
        });

        sillytavernAPI.eventSource.on('character_unloaded', () => {
          this.onCharacterUnloaded();
        });
      }
    } catch (error) {
      this.logger.warn('Could not register event listeners:', error);
    }
  }

  /**
   * Handle new message
   */
  onMessageReceived(message) {
    try {
      if (!this.config.enabled) return;

      // Add to memory buffer
      if (message && message.text) {
        this.memoryBuffer.push({
          timestamp: Date.now(),
          text: message.text,
          speaker: message.name || 'Unknown',
        });

        // Check if auto-summarize should trigger
        this.checkAutoSummarize();
      }
    } catch (error) {
      this.logger.error('Error processing message:', error);
    }
  }

  /**
   * Handle character loaded event
   */
  onCharacterLoaded() {
    try {
      this.memoryBuffer = [];
      this.lastSummaryTime = 0;
      this.logger.log('Character loaded, memory buffer reset');
    } catch (error) {
      this.logger.error('Error on character load:', error);
    }
  }

  /**
   * Handle character unloaded event
   */
  onCharacterUnloaded() {
    try {
      this.memoryBuffer = [];
      this.logger.log('Character unloaded');
    } catch (error) {
      this.logger.error('Error on character unload:', error);
    }
  }

  /**
   * Check if auto-summarize should trigger
   */
  checkAutoSummarize() {
    try {
      const now = Date.now();
      const timeSinceLastSummary = now - this.lastSummaryTime;

      if (
        this.config.autoSummarize &&
        this.memoryBuffer.length >= this.config.maxHistoryLines &&
        timeSinceLastSummary >= this.config.updateInterval
      ) {
        this.summarizeMemory();
      }
    } catch (error) {
      this.logger.error('Error checking auto-summarize:', error);
    }
  }

  /**
   * Summarize current memory buffer
   */
  async summarizeMemory() {
    try {
      if (this.memoryBuffer.length === 0) {
        this.logger.warn('No messages to summarize');
        return null;
      }

      const text = this.memoryBuffer
        .map((msg) => `${msg.speaker}: ${msg.text}`)
        .join('\n');

      // Use summarizer to create summary
      const summary = await this.summarizer.summarize(text);

      if (summary) {
        this.lastSummaryTime = Date.now();
        this.logger.log('Memory summarized successfully');

        // Clear buffer after summarizing
        this.memoryBuffer = [];

        return summary;
      }
    } catch (error) {
      this.logger.error('Error during summarization:', error);
      return null;
    }
  }

  /**
   * Get current memory statistics
   */
  getStats() {
    return {
      bufferSize: this.memoryBuffer.length,
      isInitialized: this.isInitialized,
      config: this.config,
      lastSummaryTime: this.lastSummaryTime,
    };
  }

  /**
   * Create UI elements
   */
  createUI() {
    try {
      // Create settings panel
      const settingsPanel = document.createElement('div');
      settingsPanel.id = 'memory-summarize-settings';
      settingsPanel.className = 'memory-summarize-panel';
      settingsPanel.innerHTML = `
        <div class="memory-settings">
          <h3>Memory Summarize Settings</h3>
          <label>
            <input type="checkbox" id="ms-enabled" ${this.config.enabled ? 'checked' : ''}>
            Enable Plugin
          </label>
          <label>
            <input type="checkbox" id="ms-auto" ${this.config.autoSummarize ? 'checked' : ''}>
            Auto-Summarize
          </label>
          <label>
            Summary Length:
            <select id="ms-length">
              <option value="short" ${this.config.summaryLength === 'short' ? 'selected' : ''}>Short</option>
              <option value="medium" ${this.config.summaryLength === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="long" ${this.config.summaryLength === 'long' ? 'selected' : ''}>Long</option>
            </select>
          </label>
          <button id="ms-summarize-now">Summarize Now</button>
          <button id="ms-reset">Reset Memory</button>
          <div id="ms-status">Status: Ready</div>
        </div>
      `;

      // Add event listeners to UI
      document.addEventListener('DOMContentLoaded', () => {
        const enabledCheckbox = document.getElementById('ms-enabled');
        const autoCheckbox = document.getElementById('ms-auto');
        const lengthSelect = document.getElementById('ms-length');
        const summarizeBtn = document.getElementById('ms-summarize-now');
        const resetBtn = document.getElementById('ms-reset');

        if (enabledCheckbox) {
          enabledCheckbox.addEventListener('change', (e) => {
            this.config.enabled = e.target.checked;
            this.saveConfig();
          });
        }

        if (autoCheckbox) {
          autoCheckbox.addEventListener('change', (e) => {
            this.config.autoSummarize = e.target.checked;
            this.saveConfig();
          });
        }

        if (lengthSelect) {
          lengthSelect.addEventListener('change', (e) => {
            this.config.summaryLength = e.target.value;
            this.saveConfig();
          });
        }

        if (summarizeBtn) {
          summarizeBtn.addEventListener('click', () => {
            this.summarizeMemory();
            this.updateStatus('Summarized!');
          });
        }

        if (resetBtn) {
          resetBtn.addEventListener('click', () => {
            this.memoryBuffer = [];
            this.updateStatus('Memory reset');
          });
        }
      });

      this.logger.log('UI created');
    } catch (error) {
      this.logger.warn('Could not create UI:', error);
    }
  }

  /**
   * Update status display
   */
  updateStatus(message) {
    try {
      const statusDiv = document.getElementById('ms-status');
      if (statusDiv) {
        statusDiv.textContent = `Status: ${message}`;
      }
    } catch (error) {
      this.logger.warn('Could not update status:', error);
    }
  }

  /**
   * Cleanup plugin
   */
  destroy() {
    try {
      this.logger.log('Destroying plugin');
      this.memoryBuffer = [];
      this.isInitialized = false;
    } catch (error) {
      this.logger.error('Error during cleanup:', error);
    }
  }
}

// Export plugin instance
export default new MemorySummarizePlugin();
