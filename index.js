/**
 * Memory Summarize v2.0 - Main Extension File
 * Corrected for SillyTavern 1.14+ (2025)
 * Proper initialization using jQuery ready pattern
 */

// Get SillyTavern context API
const { eventSource, event_types, callPopup, renderExtensionTemplateAsync, saveSettingsDebounced } = SillyTavern.getContext();
const { extension_settings } = SillyTavern.getContext();

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
let settings = { ...defaultSettings };
let memoryCache = new Map();
let isProcessing = false;
let processingQueue = [];

/**
 * Initialize extension
 */
async function init() {
  console.log(`[${extensionName}] Starting initialization...`);
  
  try {
    // Initialize settings
    if (!extension_settings[extensionName]) {
      extension_settings[extensionName] = { ...defaultSettings };
    }
    settings = extension_settings[extensionName];

    console.log(`[${extensionName}] Settings loaded`);

    // Apply CSS variables
    applyCSSVariables();

    // Setup UI
    await setupUI();

    // Register event listeners
    registerEventListeners();

    // Register slash commands
    registerSlashCommands();

    console.log(`[${extensionName}] ✅ Initialization complete`);
  } catch (err) {
    console.error(`[${extensionName}] Fatal initialization error:`, err);
    console.error(err.stack);
  }
}

/**
 * Setup UI elements
 */
async function setupUI() {
  try {
    console.log(`[${extensionName}] Setting up UI...`);

    // Add extension button to top bar
    const button = $(`<i id="memory-summarize-button" class="fa-solid fa-brain" title="Memory Summarize v2.0"></i>`);
    button.on('click', () => toggleConfigPopup());
    $('#extensionsMenu').append(button);
    console.log(`[${extensionName}] Button added to extensions menu`);

    // Load config HTML
    let configHTML = '';
    try {
      const response = await fetch(`${extensionFolderPath}/config.html`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      configHTML = await response.text();
      console.log(`[${extensionName}] Config HTML loaded`);
    } catch (fetchErr) {
      console.warn(`[${extensionName}] Failed to load config.html:`, fetchErr.message);
      configHTML = createDefaultConfigHTML();
    }

    // Create popup container
    const popupHTML = `<div id="memory-config-popup" class="memory-config-popup">
      <div class="memory-config-header">
        <h2 class="memory-config-title"><i class="fa-solid fa-brain"></i>Memory Summarize</h2>
        <button class="memory-config-close" id="memory-config-close">&times;</button>
      </div>
      <div class="memory-config-content">
        ${configHTML}
      </div>
    </div>`;

    $('body').append(popupHTML);

    // Attach close handler
    $('#memory-config-close').on('click', () => toggleConfigPopup());

    console.log(`[${extensionName}] UI setup complete`);
  } catch (err) {
    console.error(`[${extensionName}] UI Setup Error:`, err);
  }
}

/**
 * Register event listeners
 */
function registerEventListeners() {
  try {
    if (!eventSource || !event_types) {
      console.warn(`[${extensionName}] EventSource not fully available`);
      return;
    }

    // Listen for message received events
    eventSource.on(event_types.MESSAGE_RECEIVED, (data) => {
      if (settings.enabled && settings.autoSummarize) {
        onMessageReceived(data);
      }
    });

    eventSource.on(event_types.MESSAGE_SENT, (data) => {
      if (settings.debugMode) {
        console.log(`[${extensionName}] Message sent`);
      }
    });

    eventSource.on(event_types.CHAT_CHANGED, (data) => {
      if (settings.debugMode) {
        console.log(`[${extensionName}] Chat changed`);
      }
    });

    console.log(`[${extensionName}] Event listeners registered`);
  } catch (err) {
    console.error(`[${extensionName}] Error registering event listeners:`, err);
  }
}

/**
 * Register slash commands
 */
function registerSlashCommands() {
  try {
    if (window.SlashCommandParser) {
      window.SlashCommandParser.addCommand('memsum', async (args) => {
        await triggerManualSummarization();
        return 'Memory summarization triggered';
      }, [], 'Manually trigger memory summarization');

      console.log(`[${extensionName}] Slash commands registered`);
    }
  } catch (err) {
    console.warn(`[${extensionName}] Could not register slash commands:`, err);
  }
}

/**
 * Handle received messages
 */
async function onMessageReceived(data) {
  try {
    if (settings.debugMode) {
      console.log(`[${extensionName}] Processing received message`);
    }
  } catch (err) {
    console.error(`[${extensionName}] Error in onMessageReceived:`, err);
  }
}

/**
 * Trigger manual summarization
 */
async function triggerManualSummarization() {
  try {
    console.log(`[${extensionName}] Manual summarization triggered`);
  } catch (err) {
    console.error(`[${extensionName}] Error in manual summarization:`, err);
  }
}

/**
 * Toggle config popup visibility
 */
function toggleConfigPopup() {
  try {
    const popup = $('#memory-config-popup');
    if (popup.length) {
      popup.toggleClass('visible');
      console.log(`[${extensionName}] Popup toggled`);
    } else {
      console.warn(`[${extensionName}] Popup not found`);
    }
  } catch (err) {
    console.error(`[${extensionName}] Error toggling popup:`, err);
  }
}

/**
 * Apply CSS variables
 */
function applyCSSVariables() {
  try {
    const root = document.documentElement;
    root.style.setProperty('--qm-short', settings.colorShortTerm);
    root.style.setProperty('--qm-long', settings.colorLongTerm);
    root.style.setProperty('--qm-old', settings.colorOutOfContext);
    root.style.setProperty('--qm-excluded', settings.colorExcluded);
  } catch (err) {
    console.error(`[${extensionName}] Error applying CSS variables:`, err);
  }
}

/**
 * Create default config HTML if template not found
 */
function createDefaultConfigHTML() {
  return `
    <div class="memory-config-section active">
      <div class="memory-config-group">
        <h3>Extension Status</h3>
        <p>✅ Memory Summarize v2.0 is loaded and active!</p>
        <label>
          <input type="checkbox" id="enable-extension" class="memory-checkbox" ${settings.enabled ? 'checked' : ''}> 
          Enable Memory Summarize
        </label>
        <p><small>Config template not found. Check browser console (F12) for details.</small></p>
      </div>
    </div>
  `;
}

// Export for debugging/global access
window.memorySummarize = {
  version: '2.0.0',
  settings,
  memoryCache,
  init,
  toggleConfigPopup,
  triggerManualSummarization
};

// Initialize when jQuery is ready (standard SillyTavern pattern)
jQuery(async () => {
  console.log(`[${extensionName}] jQuery ready, initializing extension...`);
  await init();
  console.log(`[${extensionName}] Extension loaded`);
});
