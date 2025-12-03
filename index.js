/**
 * Memory Summarize v2.0 - Main Extension File
 * Updated for SillyTavern 1.12+ (2025)
 * No longer requires deprecated Extras API
 */

import { 
  eventSource, 
  event_types,
  saveSettingsDebounced,
  callPopup,
  getRequestHeaders
} from '../../../script.js';

import { 
  extension_settings,
  getContext
} from '../../extensions.js';

import {
  power_user
} from '../../power-user.js';

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
  
  // New in v2.0
  incrementalUpdates: true,
  smartBatching: true,
  contextAwareInjection: true,
  
  profiles: {},
  activeProfile: 'default'
};

// Extension state
let settings = defaultSettings;
let memoryCache = new Map();
let isProcessing = false;
let processingQueue = [];

/**
 * Initialize extension
 */
async function init() {
  console.log(`[${extensionName}] Initializing Memory Summarize v2.0`);
  
  // Load settings
  if (!extension_settings[extensionName]) {
    extension_settings[extensionName] = defaultSettings;
  }
  settings = extension_settings[extensionName];
  
  // Apply CSS variables
  applyCSSVariables();
  
  // Setup UI
  await setupUI();
  
  // Register event listeners
  registerEventListeners();
  
  // Register slash commands
  registerSlashCommands();
  
  // Setup context injection
  setupContextInjection();
  
  // Load memories for current chat
  await loadMemories();
  
  console.log(`[${extensionName}] Initialization complete`);
}

/**
 * Setup UI elements
 */
async function setupUI() {
  // Add extension button to top bar
  const button = $(`
    <div id="memory-summarize-button" class="fa-solid fa-brain menu_button" 
         title="Memory Summarize"></div>
  `);
  
  button.on('click', () => toggleConfigPopup());
  $('#extensionsMenu').append(button);
  
  // Create config popup HTML
  const configHTML = await fetch(`${extensionFolderPath}/config.html`)
    .then(res => res.text())
    .catch(() => {
      console.warn(`[${extensionName}] Config template not found, using default`);
      return createDefaultConfigHTML();
    });
  
  $('body').append(`<div id="memory-config-popup">${configHTML}</div>`);
  
  // Bind settings to UI
  bindSettingsToUI();
  
  // Add memory display to chat messages
  if (settings.displayMemories) {
    updateMemoryDisplay();
  }
}

/**
 * Register event listeners
 */
function registerEventListeners() {
  // Message events
  eventSource.on(event_types.MESSAGE_RECEIVED, handleMessageReceived);
  eventSource.on(event_types.MESSAGE_SENT, handleMessageSent);
  eventSource.on(event_types.USER_MESSAGE_RENDERED, updateMemoryDisplay);
  eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, updateMemoryDisplay);
  
  // Chat events
  eventSource.on(event_types.CHAT_CHANGED, handleChatChanged);
  
  // Generation events
  if (settings.summarizeTiming === 'before_generation') {
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, triggerAutoSummarization);
  }
  
  // Settings events
  eventSource.on(event_types.SETTINGS_UPDATED, handleSettingsUpdated);
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
  
  if (settings.summarizeTiming === 'before_generation') {
    // Will be triggered by GENERATION_AFTER_COMMANDS event
    return;
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
  
  // Determine which messages need summarization
  const messagesToSummarize = [];
  const startIndex = Math.max(0, chat.length - settings.messageLimit || chat.length);
  
  for (let i = startIndex; i < chat.length - settings.messageLag; i++) {
    const msg = chat[i];
    
    // Check if message should be summarized
    if (shouldSummarizeMessage(msg) && !hasMemory(msg)) {
      messagesToSummarize.push(i);
    }
  }
  
  if (messagesToSummarize.length === 0) {
    if (settings.debugMode) {
      console.log(`[${extensionName}] No messages to summarize`);
    }
    return;
  }
  
  // Batch process messages
  await processSummarizationQueue(messagesToSummarize);
}

/**
 * Check if message should be summarized
 */
function shouldSummarizeMessage(message) {
  if (!message || !message.mes) return false;
  
  // Check message type filters
  if (message.is_user && !settings.includeUserMessages) return false;
  if (!message.is_user && !settings.includeCharacterMessages) return false;
  if (message.is_system && !settings.includeSystemMessages) return false;
  if (message.hidden && !settings.includeHiddenMessages) return false;
  
  // Check message length threshold
  const tokenCount = estimateTokens(message.mes);
  if (tokenCount < settings.messageThreshold) return false;
  
  return true;
}

/**
 * Process summarization queue with batching
 */
async function processSummarizationQueue(messageIndices) {
  isProcessing = true;
  showProgress(0, messageIndices.length);
  
  try {
    const batchSize = settings.smartBatching 
      ? calculateOptimalBatchSize(messageIndices.length)
      : settings.batchSize;
    
    for (let i = 0; i < messageIndices.length; i += batchSize) {
      const batch = messageIndices.slice(i, i + batchSize);
      
      // Process batch in parallel
      await Promise.all(batch.map(index => summarizeMessage(index)));
      
      // Update progress
      showProgress(Math.min(i + batchSize, messageIndices.length), messageIndices.length);
      
      // Delay between batches to respect rate limits
      if (i + batchSize < messageIndices.length && settings.delayBetweenSummaries > 0) {
        await sleep(settings.delayBetweenSummaries);
      }
    }
    
    // Update display after all summaries complete
    updateMemoryDisplay();
    await saveMemories();
    
    console.log(`[${extensionName}] Summarized ${messageIndices.length} messages`);
  } catch (error) {
    console.error(`[${extensionName}] Error in summarization queue:`, error);
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
    // Check if incremental update is possible
    const existingMemory = getMemory(messageIndex);
    if (existingMemory && settings.incrementalUpdates) {
      // Only update if message changed significantly
      if (!hasMessageChanged(message, existingMemory)) {
        if (settings.debugMode) {
          console.log(`[${extensionName}] Message ${messageIndex} unchanged, skipping`);
        }
        return;
      }
    }
    
    // Prepare summary prompt
    const prompt = prepareSummaryPrompt(message);
    
    // Generate summary using ST's native API
    const summary = await generateSummary(prompt);
    
    // Store memory
    setMemory(messageIndex, {
      summary: summary,
      originalText: message.mes,
      timestamp: Date.now(),
      messageId: message.id || messageIndex,
      isLongTerm: false,
      manuallyExcluded: false
    });
    
    if (settings.debugMode) {
      console.log(`[${extensionName}] Summarized message ${messageIndex}:`, summary);
    }
    
  } catch (error) {
    console.error(`[${extensionName}] Error summarizing message ${messageIndex}:`, error);
    toastr.error(`Failed to summarize message ${messageIndex}`);
  }
}

/**
 * Generate summary using ST's API
 */
async function generateSummary(prompt) {
  const context = getContext();
  
  // Save current settings if using separate preset
  let originalPreset = null;
  let originalTemp = null;
  
  if (settings.useSeparatePreset && settings.presetName) {
    // Switch to summary preset
    // Note: This requires careful handling to avoid losing user's current settings
    console.log(`[${extensionName}] Using separate preset: ${settings.presetName}`);
  }
  
  try {
    // Use quiet prompt generation (doesn't add to chat)
    const response = await context.generateQuietPrompt(
      prompt,
      false, // quiet
      false, // skip WI
      ''     // quiet image
    );
    
    if (!response || response.trim().length === 0) {
      throw new Error('Empty response from LLM');
    }
    
    // Clean up response
    let summary = response.trim();
    
    // Remove common prefixes
    summary = summary.replace(/^(Summary:|The summary is:|Here is the summary:)\s*/i, '');
    
    // Trim to max tokens if needed
    summary = truncateToTokens(summary, settings.summaryMaxTokens);
    
    return summary;
    
  } finally {
    // Restore original settings if changed
    if (originalPreset) {
      // Restore preset
    }
  }
}

/**
 * Prepare summary prompt with macro replacements
 */
function prepareSummaryPrompt(message) {
  let prompt = settings.summaryPrompt;
  
  // Replace standard macros
  prompt = prompt.replace(/\{\{message\}\}/g, message.mes);
  prompt = prompt.replace(/\{\{char\}\}/g, message.name || 'Character');
  prompt = prompt.replace(/\{\{user\}\}/g, power_user.name || 'User');
  
  // Custom macros could be added here
  
  return prompt;
}

/**
 * Setup context injection
 */
function setupContextInjection() {
  const context = getContext();
  
  // Register injection handler
  // This integrates with ST's prompt building system
  context.registerHelper('getMemoryInjection', () => {
    if (!settings.enabled) return '';
    
    return buildMemoryInjection();
  });
}

/**
 * Build memory injection text
 */
function buildMemoryInjection() {
  const shortTermMemories = getShortTermMemories();
  const longTermMemories = getLongTermMemories();
  
  let injection = '';
  
  // Add long-term memories
  if (longTermMemories.length > 0 && !isInjectionDisabled('long-term')) {
    injection += '[Long-term Memory]\n';
    injection += longTermMemories.map(m => m.summary).join('\n');
    injection += '\n\n';
  }
  
  // Add short-term memories
  if (shortTermMemories.length > 0 && !isInjectionDisabled('short-term')) {
    injection += '[Recent Events]\n';
    injection += shortTermMemories.map(m => m.summary).join('\n');
    injection += '\n\n';
  }
  
  return injection;
}

/**
 * Get short-term memories within token limit
 */
function getShortTermMemories() {
  const context = getContext();
  const chat = context.chat;
  const memories = [];
  let tokenCount = 0;
  
  // Iterate backwards from most recent
  for (let i = chat.length - 1; i >= 0; i--) {
    const memory = getMemory(i);
    
    if (!memory || memory.manuallyExcluded || memory.isLongTerm) continue;
    
    const memoryTokens = estimateTokens(memory.summary);
    
    if (tokenCount + memoryTokens > settings.shortTermLimit) {
      break;
    }
    
    memories.unshift(memory);
    tokenCount += memoryTokens;
  }
  
  return memories;
}

/**
 * Get long-term memories within token limit
 */
function getLongTermMemories() {
  const memories = [];
  let tokenCount = 0;
  
  // Get all long-term marked memories
  const longTermMemories = Array.from(memoryCache.values())
    .filter(m => m.isLongTerm && !m.manuallyExcluded)
    .sort((a, b) => a.messageId - b.messageId);
  
  for (const memory of longTermMemories) {
    const memoryTokens = estimateTokens(memory.summary);
    
    if (tokenCount + memoryTokens > settings.longTermLimit) {
      break;
    }
    
    memories.push(memory);
    tokenCount += memoryTokens;
  }
  
  return memories;
}

/**
 * Memory management functions
 */
function getMemory(messageIndex) {
  return memoryCache.get(messageIndex);
}

function setMemory(messageIndex, memoryData) {
  memoryCache.set(messageIndex, memoryData);
}

function hasMemory(message) {
  const index = getContext().chat.indexOf(message);
  return memoryCache.has(index);
}

function toggleLongTermMemory(messageIndex) {
  const memory = getMemory(messageIndex);
  if (memory) {
    memory.isLongTerm = !memory.isLongTerm;
    updateMemoryDisplay();
    saveMemories();
  }
}

/**
 * Save memories to chat metadata
 */
async function saveMemories() {
  const context = getContext();
  
  const memoriesData = Array.from(memoryCache.entries()).map(([index, memory]) => ({
    index,
    ...memory
  }));
  
  await context.saveMetadata({ memories: memoriesData });
}

/**
 * Load memories from chat metadata
 */
async function loadMemories() {
  const context = getContext();
  const metadata = await context.getMetadata();
  
  memoryCache.clear();
  
  if (metadata?.memories) {
    for (const memoryData of metadata.memories) {
      const { index, ...memory } = memoryData;
      memoryCache.set(index, memory);
    }
  }
}

/**
 * Utility functions
 */
function estimateTokens(text) {
  // Simple estimation: ~4 characters per token
  // ST has better tokenizers available through context
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
  // Smart batching based on total count
  if (totalMessages < 10) return 3;
  if (totalMessages < 50) return 5;
  if (totalMessages < 100) return 10;
  return 15;
}

// Export public API
window.MemorySummarize = {
  summarizeMessage,
  getMemory,
  toggleLongTermMemory,
  getSummaries: () => Array.from(memoryCache.values()),
  getSettings: () => settings
};

// Initialize when DOM is ready
jQuery(() => {
  init();
});
