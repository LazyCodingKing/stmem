import { 
    eventSource, 
    event_types, 
    saveSettingsDebounced,
    renderExtensionTemplateAsync 
} from '../../../../script.js';

// REMOVED: import { extension_settings } ... 
// We will access settings globally to avoid the "null" loop.

/**
 * Memory Summarize v2.0
 * Fixed: Uses global context to avoid import race conditions
 */

const extensionName = 'memory-summarize';
const extensionFolderPath = `third-party/memory-summarize`;

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

let settings = { ...defaultSettings };

/**
 * Load Settings Safe Method
 */
function loadSettings() {
    // 1. GET SETTINGS FROM GLOBAL CONTEXT (The Fix)
    const context = SillyTavern.getContext();
    const globalSettings = context.extension_settings;

    if (!globalSettings) {
        console.warn(`[${extensionName}] Extension settings not available yet.`);
        return false;
    }

    // 2. Initialize defaults if missing
    if (!globalSettings[extensionName]) {
        console.log(`[${extensionName}] Creating default settings...`);
        globalSettings[extensionName] = { ...defaultSettings };
        saveSettingsDebounced();
    }

    // 3. Link local variable
    settings = globalSettings[extensionName];
    console.log(`[${extensionName}] Settings loaded.`);
    return true;
}

/**
 * Setup UI
 */
async function setupUI() {
    if ($('#memory-summarize-button').length > 0) return;

    // Add Button
    const buttonHtml = `
        <div id="memory-summarize-button" class="list-group-item flex-container flexGap5" title="Memory Summarize v2.0">
            <div class="fa-solid fa-brain extensionsMenuExtensionButton"></div> 
            <span>Memory Summarize</span>
        </div>`;
    $('#extensions_settings').append(buttonHtml);
    $('#memory-summarize-button').on('click', () => toggleConfigPopup());

    // Load HTML Template
    let configHTML = "";
    try {
        configHTML = await renderExtensionTemplateAsync(extensionFolderPath, 'config');
    } catch (e) {
        console.warn(`[${extensionName}] Template load failed:`, e);
        configHTML = `<div style="padding:20px;"><h3>Error</h3><p>Could not load config.html. Ensure file exists.</p></div>`;
    }

    // Create Popup
    const popupHTML = `
        <div id="memory-config-popup" class="memory-config-popup">
             ${configHTML}
        </div>`;
    
    if ($('#memory-config-popup').length === 0) {
        $('body').append(popupHTML);
    }

    bindSettingsToUI();
    
    $(document).on('click', '#memory-close-btn, #memory-cancel-btn', function() {
         $('#memory-config-popup').removeClass('visible');
    });

    applyCSSVariables();
}

/**
 * Setup Event Listeners
 */
function setupListeners() {
    if (!eventSource) return;

    eventSource.on(event_types.MESSAGE_RECEIVED, (data) => {
        if (settings.enabled && settings.autoSummarize) {
            console.log(`[${extensionName}] Message received.`);
        }
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        updateMemoryDisplay();
    });

    if (window.SlashCommandParser) {
        window.SlashCommandParser.addCommand('memsum', async (args) => {
            if (typeof toastr !== 'undefined') toastr.info('Memory summarization triggered');
            return 'Memory summarization triggered';
        }, [], 'Manually trigger memory summarization');
    }
}

function toggleConfigPopup() {
    const popup = $('#memory-config-popup');
    popup.toggleClass('visible');
    if (popup.hasClass('visible')) bindSettingsToUI();
}

/* ==================== UI HELPER FUNCTIONS ==================== */

function bindSettingsToUI() {
    bindCheckbox('#memory-enabled', 'enabled');
    bindCheckbox('#memory-enable-new-chats', 'enableInNewChats');
    bindCheckbox('#memory-display', 'displayMemories', updateMemoryDisplay);
    bindCheckbox('#memory-auto-summarize', 'autoSummarize');
    
    bindInput('#memory-short-term-limit', 'shortTermLimit', true);
    bindInput('#memory-long-term-limit', 'longTermLimit', true);
    bindInput('#memory-message-threshold', 'messageThreshold', true);
    bindInput('#memory-summary-prompt', 'summaryPrompt');

    bindInput('#memory-color-short', 'colorShortTerm', false, applyCSSVariables);
    bindInput('#memory-color-long', 'colorLongTerm', false, applyCSSVariables);

    $('#memory-save-btn').off('click').on('click', () => {
        saveSettingsDebounced();
        if (typeof toastr !== 'undefined') toastr.success('Settings saved!');
        $('#memory-config-popup').removeClass('visible');
    });
}

function bindCheckbox(selector, key, callback) {
    const el = $(selector);
    if (!el.length) return;
    el.prop('checked', settings[key]);
    el.off('change').on('change', function() {
        settings[key] = $(this).prop('checked');
        saveSettingsDebounced();
        if (callback) callback();
    });
}

function bindInput(selector, key, isNum = false, callback) {
    const el = $(selector);
    if (!el.length) return;
    el.val(settings[key]);
    el.off('change').on('change', function() {
        let val = $(this).val();
        if (isNum) val = parseInt(val) || 0;
        settings[key] = val;
        saveSettingsDebounced();
        if (callback) callback();
    });
}

function applyCSSVariables() {
    const root = document.documentElement;
    root.style.setProperty('--qm-short', settings.colorShortTerm);
    root.style.setProperty('--qm-long', settings.colorLongTerm);
}

function updateMemoryDisplay() {
    if (!settings.displayMemories) {
        $('.message-memory').remove();
    }
}

// Global Export
window.memorySummarize = { settings, toggleConfigPopup };

// ============================================================================
// MAIN INITIALIZATION
// ============================================================================
jQuery(async () => {
    // Try loading settings
    const loaded = loadSettings();
    
    if (!loaded) {
        // If settings were not ready, we hook into the event and retry ONCE
        // This prevents the infinite loop you were seeing
        console.log(`[${extensionName}] Waiting for settings event...`);
        eventSource.once('extension_settings_loaded', () => {
            loadSettings();
            setupUI();
            setupListeners();
            updateMemoryDisplay();
            console.log(`[${extensionName}] Extension loaded (delayed)!`);
        });
        return;
    }

    // If settings were ready immediately, proceed
    await setupUI();
    setupListeners();
    updateMemoryDisplay();
    console.log(`[${extensionName}] Extension loaded!`);
});
