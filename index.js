/**
 * Memory Summarize v2.0 - Main Extension File
 * Updated for SillyTavern 1.12+ (2025)
 */

// Import from SillyTavern - FIX: Use proper import paths
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { power_user } from '../../../power-user.js';

// Extension metadata
const extensionName = 'memory-summarize';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// Default settings
const defaultSettings = {
  enabled: true,
  autoSummarize: true,
  summarizeTiming: 'after_generation',
  
  shortTermLimit: 2000,
  longTermLimit: 4000,
  messageThreshold: 50,
  
  summaryPrompt: 'Summarize the following message concisely in 1-2 sentences:\n\n{{message}}',
  summaryMaxTokens: 150,
  summaryTemperature: 0.1,
  
  useSeparatePreset: false,
  presetName: '',
  
  batchSize: 5,
  delayBetweenSummaries: 1000,
  messageLag: 0,
  
  displayMemories: true,
  colorShortTerm: '#22c55e',
  colorLongTerm: '#3b82f6',
  colorOutOfContext: '#ef4444',
  colorExcluded: '#9ca3af',
  
  startInjectingAfter: 3,
  removeMessagesAfterThreshold: false,
  staticMemoryMode: false,
  
  includeCharacterMessages: true,
  includeUserMessages: false,
  includeHiddenMessages: false,
  includeSystemMessages: false,
  
  shortTermInjectionPosition: 'after_scenario',
  longTermInjectionPosition: 'after_scenario',
  
  debugMode: false,
  enableInNewChats: true,
  useGlobalToggleState: false,
  
  incrementalUpdates: true,
  smartBatching: true,
  contextAwareInjection: true,
  
  profiles: {},
  activeProfile: 'default'
};

// Extension state
let settings = {};
let memoryCache = new Map();
let isProcessing = false;
let shouldStopProcessing = false;

/**
 * Initialize extension
 */
async function init() {
  console.log(`[${extensionName}] Initializing Memory Summarize v2.0`);
  
  try {
    // Load settings
    if (!extension_settings[extensionName]) {
      extension_settings[extensionName] = structuredClone(defaultSettings);
    }
    settings = extension_settings[extensionName];
    
    console.log(`[${extensionName}] Settings loaded:`, settings);
    
    // Apply CSS variables
    applyCSSVariables();
    
    // Setup UI
    await setupUI();
    
    // Register event listeners
    registerEventListeners();
    
    // Register slash commands
    registerSlashCommands();
    
    // Load memories for current chat
    await loadMemories();
    
    console.log(`[${extensionName}] Initialization complete`);
    toastr.success('Memory Summarize loaded successfully!');
    
  } catch (error) {
    console.error(`[${extensionName}] Initialization failed:`, error);
    toastr.error(`Memory Summarize failed to load: ${error.message}`);
  }
}

/**
 * Setup UI elements
 */
async function setupUI() {
  console.log(`[${extensionName}] Setting up UI`);
  
  // Add extension button to top bar
  const button = $(`
    <div id="memory-summarize-button" class="fa-solid fa-brain menu_button" 
         title="Memory Summarize"></div>
  `);
  
  button.on('click', () => toggleConfigPopup());
  $('#extensionsMenu').append(button);
  
  // Create simple config popup
  const configHTML = `
    <div class="memory-config-wrapper">
      <div class="memory-config-header">
        <div class="memory-config-title">
          <i class="fa-solid fa-brain"></i>
          Memory Summarize v2.0
        </div>
        <button class="memory-config-close" id="memory-close-btn">
          <i class="fa-solid fa-times"></i>
        </button>
      </div>
      <div class="memory-config-content" style="padding: 20px;">
        <h3>Extension Status</h3>
        <label>
          <input type="checkbox" id="memory-enabled" ${settings.enabled ? 'checked' : ''}>
          Enable Memory Summarize
        </label>
        
        <h3>Memory Limits</h3>
        <label>
          Short-Term Memory Limit (tokens):
          <input type="number" id="memory-short-term-limit" value="${settings.shortTermLimit}" min="100" max="10000" step="100">
        </label>
        <br>
        <label>
          Long-Term Memory Limit (tokens):
          <input type="number" id="memory-long-term-limit" value="${settings.longTermLimit}" min="100" max="10000" step="100">
        </label>
        
        <h3>Quick Actions</h3>
        <button id="memory-summarize-all" class="menu_button">Summarize All Messages</button>
        <button id="memory-clear-all" class="menu_button">Clear All Memories</button>
        
        <h3>Display</h3>
        <label>
          <input type="checkbox" id="memory-display" ${settings.displayMemories ? 'checked' : ''}>
          Show summaries below messages
        </label>
      </div>
      <div class="memory-config-footer" style="padding: 10px; border-top: 1px solid #ccc;">
        <button id="memory-save-btn" class="menu_button">Save Settings</button>
        <button id="memory-cancel-btn" class="menu_button">Cancel</button>
      </div>
    </div>
  `;
  
  $('body').append(`<div id="memory-config-popup" style="display: none;">${configHTML}</div>`);
  
  // Bind UI events
  bindUI();
  
  console.log(`[${extensionName}] UI setup complete`);
}

/**
 * Bind UI event handlers
 */
function bindUI() {
  $('#memory-close-btn, #memory-cancel-btn').on('click', () => {
    $('#memory-config-popup').hide();
  });
  
  $('#memory-save-btn').on('click', () => {
    saveSettings();
    $('#memory-config-popup').hide();
    toastr.success('Settings saved!');
  });
  
  $('#memory-enabled').on('change', function() {
    settings.enabled = $(this).prop('checked');
  });
  
  $('#memory-short-term-limit').on('change', function() {
    settings.shortTermLimit = parseInt($(this).val());
  });
  
  $('#memory-long-term-limit').on('change', function() {
    settings.longTermLimit = parseInt($(this).val());
  });
  
  $('#memory-display').on('change', function() {
    settings.displayMemories = $(this).prop('checked');
    updateMemoryDisplay();
  });
  
  $('#memory-summarize-all').on('click', async () => {
    if (confirm('Summarize all messages? This may take a while.')) {
      await triggerAutoSummarization();
    }
  });
  
  $('#memory-clear-all').on('click', async () => {
    if (confirm('Clear all memories? This cannot be undone.')) {
      memoryCache.clear();
      await saveMemories();
      updateMemoryDisplay();
      toastr.success('All memories cleared');
    }
  });
}

/**
 * Toggle config popup
 */
function toggleConfigPopup() {
  const popup = $('#memory-config-popup');
  if (popup.is(':visible')) {
    popup.hide();
  } else {
    popup.show();
  }
}

/**
 * Save settings
 */
function saveSettings() {
  extension_settings[extensionName] = settings;
  saveSettingsDebounced();
}

/**
 * Apply CSS variables
 */
function applyCSSVariables() {
  const root = document.documentElement;
  root.style.setProperty('--qm-short', settings.colorShortTerm);
  root.style.setProperty('--qm-long', settings.colorLongTerm);
  root.style.setProperty('--qm-old', settings.colorOutOfContext);
  root.style.setProperty('--qm-excluded', settings.colorExcluded);
}

/**
 * Register event listeners
 */
function registerEventListeners() {
  console.log(`[${extensionName}] Registering event listeners`);
  
  eventSource.on(event_types.MESSAGE_RECEIVED, handleMessageReceived);
  eventSource.on(event_types.MESSAGE_SENT, handleMessageSent);
  eventSource.on(event_types.CHAT_CHANGED, handleChatChanged);
}

/**
 * Register slash commands
 */
function registerSlashCommands() {
  console.log(`[${extensionName}] Registering slash commands`);
  
  // Basic commands
  window.SlashCommandParser?.addCommand('qm-enabled', () => {
    return String(settings.enabled);
  }, [], '– check if extension is enabled');
  
  window.SlashCommandParser?.addCommand('qm-toggle', (args) => {
    if (args.enabled !== undefined) {
      settings.enabled = args.enabled === 'true';
    } else {
      settings.enabled = !settings.enabled;
    }
    saveSettings();
    toastr.info(`Memory Summarize ${settings.enabled ? 'enabled' : 'disabled'}`);
    return String(settings.enabled);
  }, [], '– toggle extension on/off');
  
  window.SlashCommandParser?.addCommand('qm-summarize', async (args) => {
    const index = args.index !== undefined ? parseInt(args.index) : getContext().chat.length - 1;
    await summarizeMessage(index);
    return 'Summarization complete';
  }, [], '– summarize a message');
}

/**
 * Handle message received event
 */
async function handleMessageReceived(data) {
  if (!settings.enabled || !settings.autoSummarize) return;
  
  if (settings.summarizeTiming === 'after_generation') {
    await triggerAutoSummarization();
  }
}

/**
 * Handle message sent event
 */
async function handleMessageSent(data) {
  if (!settings.enabled || !settings.autoSummarize) return;
  
  if (settings.summarizeTiming === 'after_generation') {
    await triggerAutoSummarization();
  }
}

/**
 * Handle chat changed event
 */
async function handleChatChanged() {
  memoryCache.clear();
  await loadMemories();
  updateMemoryDisplay();
}

/**
 * Trigger auto-summarization
 */
async function triggerAutoSummarization() {
  if (isProcessing) {
    console.log(`[${extensionName}] Already processing, skipping`);
    return;
  }
  
  const context = getContext();
  const chat = context.chat;
  
  if (!chat || chat.length === 0) return;
  
  // Find messages that need summarization
  const messagesToSummarize = [];
  
  for (let i = 0; i < chat.length - settings.messageLag; i++) {
    const msg = chat[i];
    
    if (shouldSummarizeMessage(msg, i) && !memoryCache.has(i)) {
      messagesToSummarize.push(i);
    }
  }
  
  if (messagesToSummarize.length === 0) {
    return;
  }
  
  console.log(`[${extensionName}] Summarizing ${messagesToSummarize.length} messages`);
  await processSummarizationQueue(messagesToSummarize);
}

/**
 * Check if message should be summarized
 */
function shouldSummarizeMessage(message, index) {
  if (!message || !message.mes) return false;
  
  // Check message type filters
  if (message.is_user && !settings.includeUserMessages) return false;
  if (!message.is_user && !settings.includeCharacterMessages) return false;
  
  // Check message length
  const tokenCount = estimateTokens(message.mes);
  if (tokenCount < settings.messageThreshold) return false;
  
  return true;
}

/**
 * Process summarization queue
 */
async function processSummarizationQueue(messageIndices) {
  isProcessing = true;
  shouldStopProcessing = false;
  showProgress(0, messageIndices.length);
  
  try {
    const batchSize = settings.smartBatching 
      ? calculateOptimalBatchSize(messageIndices.length)
      : settings.batchSize;
    
    for (let i = 0; i < messageIndices.length; i++) {
      if (shouldStopProcessing) {
        console.log(`[${extensionName}] Stopped by user`);
        break;
      }
      
      await summarizeMessage(messageIndices[i]);
      showProgress(i + 1, messageIndices.length);
      
      if (settings.delayBetweenSummaries > 0 && i < messageIndices.length - 1) {
        await sleep(settings.delayBetweenSummaries);
      }
    }
    
    updateMemoryDisplay();
    await saveMemories();
    
    console.log(`[${extensionName}] Summarized ${messageIndices.length} messages`);
    toastr.success(`Summarized ${messageIndices.length} messages`);
    
  } catch (error) {
    console.error(`[${extensionName}] Error in summarization:`, error);
    toastr.error(`Summarization failed: ${error.message}`);
  } finally {
    isProcessing = false;
    hideProgress();
  }
}

/**
 * Summarize a single message
 */
async function summarizeMessage(messageIndex) {
  const context = getContext();
  const message = context.chat[messageIndex];
  
  if (!message) {
    console.warn(`[${extensionName}] Message ${messageIndex} not found`);
    return;
  }
  
  try {
    // Check if incremental update possible
    const existingMemory = memoryCache.get(messageIndex);
    if (existingMemory && settings.incrementalUpdates) {
      if (message.mes === existingMemory.originalText) {
        console.log(`[${extensionName}] Message ${messageIndex} unchanged, skipping`);
        return;
      }
    }
    
    // Prepare prompt
    let prompt = settings.summaryPrompt;
    prompt = prompt.replace(/\{\{message\}\}/g, message.mes);
    prompt = prompt.replace(/\{\{char\}\}/g, message.name || 'Character');
    prompt = prompt.replace(/\{\{user\}\}/g, power_user.name || 'User');
    
    // Generate summary - FIX: Use proper ST API
    console.log(`[${extensionName}] Generating summary for message ${messageIndex}`);
    
    const summary = await generateSummarySimple(prompt);
    
    // Store memory
    memoryCache.set(messageIndex, {
      summary: summary,
      originalText: message.mes,
      timestamp: Date.now(),
      messageId: messageIndex,
      isLongTerm: false,
      manuallyExcluded: false
    });
    
    console.log(`[${extensionName}] Summarized message ${messageIndex}`);
    
  } catch (error) {
    console.error(`[${extensionName}] Error summarizing message ${messageIndex}:`, error);
    toastr.error(`Failed to summarize message ${messageIndex}: ${error.message}`);
  }
}

/**
 * Generate summary - SIMPLIFIED VERSION
 */
async function generateSummarySimple(prompt) {
  try {
    const context = getContext();
    
    // Try using generateQuietPrompt if available
    if (typeof context.generateQuietPrompt === 'function') {
      const response = await context.generateQuietPrompt(prompt, false, false, '');
      if (response && response.trim()) {
        return cleanSummary(response);
      }
    }
    
    // Fallback: Try using generate if available
    if (typeof context.generate === 'function') {
      const response = await context.generate(prompt);
      if (response && response.trim()) {
        return cleanSummary(response);
      }
    }
    
    // If neither works, return a placeholder
    console.warn(`[${extensionName}] No generation method available, using placeholder`);
    return '[Summary generation not available - please configure your API]';
    
  } catch (error) {
    console.error(`[${extensionName}] Generation error:`, error);
    throw new Error(`Summary generation failed: ${error.message}`);
  }
}

/**
 * Clean up summary text
 */
function cleanSummary(text) {
  let summary = text.trim();
  summary = summary.replace(/^(Summary:|The summary is:|Here is the summary:)\s*/i, '');
  summary = truncateToTokens(summary, settings.summaryMaxTokens);
  return summary;
}

/**
 * Update memory display
 */
function updateMemoryDisplay() {
  if (!settings.displayMemories) {
    $('.message-memory').remove();
    return;
  }
  
  $('.message-memory').remove();
  
  $('#chat .mes').each(function(index) {
    const memory = memoryCache.get(index);
    if (memory) {
      const memoryDiv = $(`
        <div class="message-memory" style="
          font-size: 0.85em;
          margin-top: 8px;
          padding: 8px;
          border-left: 3px solid ${settings.colorShortTerm};
          background: rgba(0,0,0,0.1);
          font-style: italic;
        ">
          💭 ${escapeHtml(memory.summary)}
        </div>
      `);
      $(this).find('.mes_text').after(memoryDiv);
    }
  });
}

/**
 * Show progress
 */
function showProgress(current, total) {
  let progressDiv = $('#memory-progress');
  
  if (progressDiv.length === 0) {
    progressDiv = $(`
      <div id="memory-progress" style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: var(--SmartThemeBodyColor);
        border: 2px solid var(--SmartThemeBorderColor);
        padding: 15px;
        border-radius: 8px;
        z-index: 9999;
        min-width: 250px;
      ">
        <div style="font-weight: bold; margin-bottom: 8px;">
          <i class="fa-solid fa-spinner fa-spin"></i> Summarizing Messages
        </div>
        <div class="progress-bar" style="
          width: 100%;
          height: 8px;
          background: #ddd;
          border-radius: 4px;
          overflow: hidden;
        ">
          <div class="progress-fill" style="
            height: 100%;
            background: #22c55e;
            width: 0%;
            transition: width 0.3s;
          "></div>
        </div>
        <div class="progress-text" style="margin-top: 8px; font-size: 0.9em;">0 / 0</div>
        <button id="memory-stop-btn" class="menu_button" style="margin-top: 8px; width: 100%;">
          <i class="fa-solid fa-stop"></i> Stop
        </button>
      </div>
    `);
    $('body').append(progressDiv);
    
    $('#memory-stop-btn').on('click', () => {
      shouldStopProcessing = true;
      toastr.info('Stopping summarization...');
    });
  }
  
  const percentage = total > 0 ? (current / total) * 100 : 0;
  progressDiv.find('.progress-fill').css('width', `${percentage}%`);
  progressDiv.find('.progress-text').text(`${current} / ${total}`);
}

/**
 * Hide progress
 */
function hideProgress() {
  $('#memory-progress').remove();
}

/**
 * Save memories to chat metadata
 */
async function saveMemories() {
  try {
    const context = getContext();
    const memoriesArray = Array.from(memoryCache.entries()).map(([index, memory]) => ({
      index,
      ...memory
    }));
    
    // Try to save to chat metadata
    if (context.saveMetadata) {
      await context.saveMetadata({ memories: memoriesArray });
    } else {
      console.warn(`[${extensionName}] saveMetadata not available`);
    }
    
  } catch (error) {
    console.error(`[${extensionName}] Error saving memories:`, error);
  }
}

/**
 * Load memories from chat metadata
 */
async function loadMemories() {
  try {
    const context = getContext();
    
    memoryCache.clear();
    
    if (context.getMetadata) {
      const metadata = await context.getMetadata();
      
      if (metadata && metadata.memories) {
        for (const memoryData of metadata.memories) {
          const { index, ...memory } = memoryData;
          memoryCache.set(index, memory);
        }
        console.log(`[${extensionName}] Loaded ${memoryCache.size} memories`);
      }
    }
    
  } catch (error) {
    console.error(`[${extensionName}] Error loading memories:`, error);
  }
}

/**
 * Utility functions
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text, maxTokens) {
  const estimatedTokens = estimateTokens(text);
  if (estimatedTokens <= maxTokens) return text;
  
  const targetLength = maxTokens * 4;
  return text.substring(0, targetLength) + '...';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function calculateOptimalBatchSize(totalMessages) {
  if (totalMessages < 10) return 3;
  if (totalMessages < 50) return 5;
  if (totalMessages < 100) return 10;
  return 15;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Export public API
window.MemorySummarize = {
  summarizeMessage,
  getMemory: (index) => memoryCache.get(index),
  getSummaries: () => Array.from(memoryCache.values()),
  getSettings: () => settings,
  stopProcessing: () => { shouldStopProcessing = true; }
};

// Initialize when jQuery is ready
jQuery(() => {
  console.log(`[${extensionName}] jQuery ready, initializing...`);
  init();
});
