import { Summarizer } from './summarizer.js';
import { MemoryAPI } from './api.js';
import { Logger, validateConfig } from './utils.js';

/**
 * Memory Summarize Extension for SillyTavern
 * Intelligently summarizes and manages character memory
 */

const MODULE_NAME = 'MemorySummarize';
const logger = new Logger(MODULE_NAME);

class MemorySummarizeExtension {
  constructor() {
    this.config = {
      enabled: true,
      autoSummarize: true,
      summaryLength: 'medium',
      updateInterval: 300000,
      maxHistoryLines: 50,
      apiEndpoint: null,
      apiKey: null,
    };
    this.summarizer = new Summarizer(this.config);
    this.api = new MemoryAPI(this.config);
    this.memoryBuffer = [];
    this.lastSummaryTime = 0;
  }

  async init() {
    try {
      logger.log('Initializing extension...');
      await this.loadConfig();
      this.createUI();
      this.setupEventListeners();
      logger.log('Extension initialized successfully');
    } catch (error) {
      logger.error('Initialization failed:', error);
    }
  }

  async loadConfig() {
    try {
      const saved = localStorage.getItem('memorySummarize_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        this.config = { ...this.config, ...parsed };
        logger.log('Configuration loaded');
      }
    } catch (error) {
      logger.warn('Could not load config:', error);
    }
  }

  async saveConfig() {
    try {
      localStorage.setItem('memorySummarize_config', JSON.stringify(this.config));
      logger.log('Configuration saved');
    } catch (error) {
      logger.error('Could not save config:', error);
    }
  }

  createUI() {
    try {
      const container = document.createElement('div');
      container.id = 'memory-summarize-container';
      container.className = 'memory-summarize-panel';
      container.innerHTML = `
        <div style="padding: 15px; background: #f5f5f5; border-radius: 8px; margin: 10px 0;">
          <h4 style="margin: 0 0 15px 0;">🧠 Memory Summarize</h4>
          
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <label style="display: flex; align-items: center; gap: 10px;">
              <input type="checkbox" id="ms-enabled" ${this.config.enabled ? 'checked' : ''}>
              <span>Enable Plugin</span>
            </label>
            
            <label style="display: flex; align-items: center; gap: 10px;">
              <input type="checkbox" id="ms-auto" ${this.config.autoSummarize ? 'checked' : ''}>
              <span>Auto-Summarize</span>
            </label>
            
            <label style="display: flex; align-items: center; gap: 10px;">
              <span>Length:</span>
              <select id="ms-length" style="padding: 5px;">
                <option value="short" ${this.config.summaryLength === 'short' ? 'selected' : ''}>Short</option>
                <option value="medium" ${this.config.summaryLength === 'medium' ? 'selected' : ''}>Medium</option>
                <option value="long" ${this.config.summaryLength === 'long' ? 'selected' : ''}>Long</option>
              </select>
            </label>
            
            <div style="display: flex; gap: 10px;">
              <button id="ms-summarize" style="padding: 8px 16px; background: #0066cc; color: white; border: none; border-radius: 4px; cursor: pointer;">Summarize Now</button>
              <button id="ms-reset" style="padding: 8px 16px; background: #d32f2f; color: white; border: none; border-radius: 4px; cursor: pointer;">Reset Memory</button>
            </div>
            
            <div id="ms-status" style="padding: 10px; background: #e3f2fd; border-left: 4px solid #0066cc; border-radius: 4px; font-size: 12px;">
              Status: <span id="ms-status-text">Ready</span>
            </div>
            
            <div style="font-size: 12px; color: #666;">
              Buffer: <span id="ms-buffer">0</span> messages | Last summary: <span id="ms-last-summary">Never</span>
            </div>
          </div>
        </div>
      `;
      
      const extensionSettings = document.getElementById('extension_settings');
      if (extensionSettings) {
        extensionSettings.appendChild(container);
        logger.log('UI created successfully');
      } else {
        logger.warn('Extension settings container not found');
      }
    } catch (error) {
      logger.error('Error creating UI:', error);
    }
  }

  setupEventListeners() {
    try {
      const enableCheckbox = document.getElementById('ms-enabled');
      if (enableCheckbox) {
        enableCheckbox.addEventListener('change', (e) => {
          this.config.enabled = e.target.checked;
          this.saveConfig();
          this.updateStatus(e.target.checked ? 'Enabled' : 'Disabled');
        });
      }

      const autoCheckbox = document.getElementById('ms-auto');
      if (autoCheckbox) {
        autoCheckbox.addEventListener('change', (e) => {
          this.config.autoSummarize = e.target.checked;
          this.saveConfig();
          this.updateStatus(e.target.checked ? 'Auto-summarize enabled' : 'Auto-summarize disabled');
        });
      }

      const lengthSelect = document.getElementById('ms-length');
      if (lengthSelect) {
        lengthSelect.addEventListener('change', (e) => {
          this.config.summaryLength = e.target.value;
          this.saveConfig();
          this.updateStatus('Length updated');
        });
      }

      const summarizeBtn = document.getElementById('ms-summarize');
      if (summarizeBtn) {
        summarizeBtn.addEventListener('click', async () => {
          summarizeBtn.disabled = true;
          this.updateStatus('Summarizing...');
          try {
            const summary = await this.summarizeMemory();
            if (summary) {
              this.updateStatus('Summarization complete');
              logger.log('Summary:', summary);
            } else {
              this.updateStatus('No content to summarize');
            }
          } catch (error) {
            logger.error('Error:', error);
            this.updateStatus('Error occurred');
          } finally {
            summarizeBtn.disabled = false;
          }
        });
      }

      const resetBtn = document.getElementById('ms-reset');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          if (confirm('Reset memory buffer?')) {
            this.memoryBuffer = [];
            this.updateStatus('Memory reset');
            this.updateDisplay();
          }
        });
      }

      logger.log('Event listeners attached');
    } catch (error) {
      logger.error('Error setting up listeners:', error);
    }
  }

  async summarizeMemory() {
    try {
      if (this.memoryBuffer.length === 0) {
        logger.warn('No messages to summarize');
        return null;
      }

      const text = this.memoryBuffer
        .map((msg) => `${msg.speaker}: ${msg.text}`)
        .join('\n');

      const summary = await this.summarizer.summarize(text);

      if (summary) {
        this.lastSummaryTime = Date.now();
        this.memoryBuffer = [];
        this.updateDisplay();
        return summary;
      }
      return null;
    } catch (error) {
      logger.error('Summarization error:', error);
      return null;
    }
  }

  updateStatus(message) {
    const statusText = document.getElementById('ms-status-text');
    if (statusText) {
      statusText.textContent = message;
    }
  }

  updateDisplay() {
    const bufferSpan = document.getElementById('ms-buffer');
    if (bufferSpan) {
      bufferSpan.textContent = this.memoryBuffer.length;
    }

    const lastSummarySpan = document.getElementById('ms-last-summary');
    if (lastSummarySpan) {
      lastSummarySpan.textContent = this.lastSummaryTime > 0
        ? new Date(this.lastSummaryTime).toLocaleTimeString()
        : 'Never';
    }
  }

  onMessageReceived(message) {
    try {
      if (!this.config.enabled || !message) return;

      if (message.text) {
        this.memoryBuffer.push({
          timestamp: Date.now(),
          text: message.text,
          speaker: message.name || 'Unknown',
        });

        this.updateDisplay();

        const now = Date.now();
        const timeSinceLastSummary = now - this.lastSummaryTime;

        if (
          this.config.autoSummarize &&
          this.memoryBuffer.length >= this.config.maxHistoryLines &&
          timeSinceLastSummary >= this.config.updateInterval
        ) {
          this.summarizeMemory();
        }
      }
    } catch (error) {
      logger.error('Error processing message:', error);
    }
  }
}

const extension = new MemorySummarizeExtension();

// Hook into SillyTavern's extension system
async function setupExtension() {
  try {
    await extension.init();
    logger.log('Extension setup complete');

    // Listen for messages if event system available
    if (window.eventSource) {
      window.eventSource.on('message', (msg) => {
        extension.onMessageReceived(msg);
      });
      logger.log('Message listeners registered');
    }
  } catch (error) {
    logger.error('Extension setup failed:', error);
  }
}

// Wait for SillyTavern to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupExtension);
} else {
  setupExtension();
}

// Export for debugging
window.MemorySummarizeExtension = extension;
