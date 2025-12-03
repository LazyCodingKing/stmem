import { 
    eventSource, 
    event_types, 
    saveSettingsDebounced,
    renderExtensionTemplateAsync 
} from '../../../../script.js';

import { extension_settings } from '../../../extensions.js';

/**
 * Memory Summarize v2.0
 * Architecture: ES6 Imports + SillyTavern Template Loader (NoAss Style)
 */

// Extension metadata
const extensionName = 'memory-summarize';
const extensionFolderPath = `third-party/memory-summarize`;

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

/**
 * Load and Validate Settings
 */
function loadSettings() {
    // If settings don't exist, create defaults
    if (!extension_settings[extensionName]) {
        console.log(`[${extensionName}] Creating default settings...`);
        extension_settings[extensionName] = { ...defaultSettings };
        saveSettingsDebounced();
    }

    // Link local variable to global settings
    settings = extension_settings[extensionName];
    console.log(`[${extensionName}] Settings loaded.`);
}

/**
 * Setup UI Elements (Using SillyTavern Template Loader)
 */
async function setupUI() {
    if ($('#memory-summarize-button').length > 0) return;

    // 1. Add the Button to the Extensions Menu
    const buttonHtml = `
        <div id="memory-summarize-button" class="list-group-item flex-container flexGap5" title="Memory Summarize v2.0">
            <div class="fa-solid fa-brain extensionsMenuExtensionButton"></div> 
            <span>Memory Summarize</span>
        </div>`;
    $('#extensions_settings').append(buttonHtml);
    $('#memory-summarize-button').on('click', () => toggleConfigPopup());

    // 2. Load the Config Popup HTML using the "NoAss" method
    // This looks for 'config.html' inside the extension folder automatically
    let configHTML = "";
    try {
        configHTML = await renderExtensionTemplateAsync(extensionFolderPath, 'config');
    } catch (e) {
        console.warn(`[${extensionName}] config.html not found, using fallback.`);
        configHTML = `<div style="padding:20px;"><h3>Error</h3><p>Could not load config.html</p></div>`;
    }

    // 3. Create the Popup Container
    const popupHTML = `
        <div id="memory-config-popup" class="memory-config-popup">
             ${configHTML}
        </div>`;
    
    if ($('#memory-config-popup').length === 0) {
        $('body').append(popupHTML);
    }

    // 4. Bind Logic
    bindSettingsToUI();
    
    // Close button handler
    $(document).on('click', '#memory-close-btn, #memory-cancel-btn', function() {
         $('#memory-config-popup').removeClass('visible');
    });

    // Apply initial CSS
    applyCSSVariables();
}

/**
 * Setup Event Listeners
 */
function setupListeners() {
    if (!eventSource) return;

    // ST Events
    eventSource.on(event_types.MESSAGE_RECEIVED, (data) => {
        if (settings.enabled && settings.autoSummarize) {
            console.log(`[${extensionName}] Message received.`);
        }
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        updateMemoryDisplay();
    });

    // Slash Commands
    if (window.SlashCommandParser) {
        window.SlashCommandParser.addCommand('memsum', async (args) => {
            if (typeof toastr !== 'undefined') toastr.info('Memory summarization triggered');
            return 'Memory summarization triggered';
        }, [], 'Manually trigger memory summarization');
    }
}

/**
 * Toggle config popup visibility
 */
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
window.memorySummarize = { settings, memoryCache, toggleConfigPopup };

// ============================================================================
// MAIN ENTRY POINT (NoAss Style)
// ============================================================================
jQuery(async () => {
    // 1. Load Settings first
    loadSettings();

    // 2. Load UI (HTML templates)
    await setupUI();

    // 3. Register Listeners
    setupListeners();

    // 4. Initial Logic
    updateMemoryDisplay();

    console.log(`[${extensionName}] Extension loaded!`);
});
