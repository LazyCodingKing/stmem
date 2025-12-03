/**
 * Memory Summarize v2.0 - Main Extension File
 * Fixed & Merged for SillyTavern
 * Author: LazyCodingKing / Qvink
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
let isInitialized = false;

/**
 * Initialize extension
 */
async function init() {
    // Prevent double initialization
    if (isInitialized) {
        console.log(`[${extensionName}] Already initialized, skipping...`);
        return;
    }

    console.log(`[${extensionName}] Starting initialization...`);

    try {
        // Get SillyTavern context - DO THIS INSIDE THE TRY BLOCK
        const context = SillyTavern.getContext();
        const { eventSource, event_types, saveSettingsDebounced, extension_settings } = context;

        // Safety Check: If settings aren't loaded yet, wait for the event
        if (!extension_settings || typeof extension_settings === 'undefined') {
            console.log(`[${extensionName}] Settings not ready yet. Waiting for extension_settings_loaded event...`);
            eventSource.once(event_types.EXTENSION_SETTINGS_LOADED, init);
            return; 
        }

        // Make context available globally for this extension
        window.memorySummarizeContext = { eventSource, event_types, saveSettingsDebounced, extension_settings };

        // Initialize settings
        if (!extension_settings[extensionName]) {
            console.log(`[${extensionName}] Creating default settings...`);
            extension_settings[extensionName] = { ...defaultSettings };
        }
        
        // Link our local 'settings' variable to the global object
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

        // Trigger an initial memory display update
        updateMemoryDisplay();

        isInitialized = true;
        console.log(`[${extensionName}] ✅ Initialization complete`);
    } catch (err) {
        console.error(`[${extensionName}] Fatal initialization error:`, err);
        console.error(`[${extensionName}] Stack trace:`, err.stack);
    }
}

/**
 * Setup UI elements
 */
async function setupUI() {
    try {
        console.log(`[${extensionName}] Setting up UI...`);

        // Add extension button to top bar (Standard SillyTavern Extensions Menu)
        const buttonHtml = `
            <div id="memory-summarize-button" class="list-group-item flex-container flexGap5" title="Memory Summarize v2.0">
                <div class="fa-solid fa-brain extensionsMenuExtensionButton"></div> 
                <span data-i18n="Memory Summarize">Memory Summarize</span>
            </div>`;
        
        const button = $(buttonHtml);
        button.on('click', () => toggleConfigPopup());
        
        // Append to the extension menu container
        $('#extensions_settings2').append(button);

        // Load config HTML
        let configHTML = '';
        try {
            // Attempt to load local config.html, fallback if missing
            const response = await fetch(`${extensionFolderPath}/config.html`);
            if (response.ok) {
                configHTML = await response.text();
            } else {
                throw new Error('Config file not found');
            }
        } catch (fetchErr) {
            console.warn(`[${extensionName}] Failed to load config.html, using fallback.`);
            configHTML = createDefaultConfigHTML();
        }

        // Create popup container
        const popupHTML = `
            <div id="memory-config-popup" class="memory-config-popup">
                 ${configHTML}
            </div>`;

        // Only append if it doesn't exist
        if ($('#memory-config-popup').length === 0) {
            $('body').append(popupHTML);
        }

        // Bind all the UI actions
        bindSettingsToUI();
        
        // Close button handler (using delegated event for robustness)
        $(document).on('click', '#memory-close-btn, #memory-cancel-btn', function() {
             $('#memory-config-popup').removeClass('visible');
        });

        console.log(`[${extensionName}] UI setup complete`);
    } catch (err) {
        console.error(`[${extensionName}] UI Setup Error:`, err);
    }
}

/**
 * Register event listeners
 */
function registerEventListeners() {
    const { eventSource, event_types } = window.memorySummarizeContext;
    if (!eventSource || !event_types) return;

    eventSource.on(event_types.MESSAGE_RECEIVED, (data) => {
        if (settings.enabled && settings.autoSummarize) {
            console.log(`[${extensionName}] Message received. Auto-summarize logic pending.`);
        }
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        updateMemoryDisplay();
    });
}

/**
 * Register slash commands
 */
function registerSlashCommands() {
    if (window.SlashCommandParser) {
        window.SlashCommandParser.addCommand('memsum', async (args) => {
            console.log(`[${extensionName}] Manual summarization triggered`);
            return 'Memory summarization triggered (Logic Pending)';
        }, [], '<span class="monospace">/memsum</span> – Manually trigger memory summarization', true, true);
    }
}

/**
 * Toggle config popup visibility
 */
function toggleConfigPopup() {
    const popup = $('#memory-config-popup');
    popup.toggleClass('visible');
    
    // Refresh UI state when opening
    if (popup.hasClass('visible')) {
        bindSettingsToUI();
    }
}

/* ==================== UI HELPER FUNCTIONS ==================== */

function bindSettingsToUI() {
    // Basic Settings
    bindCheckbox('#memory-enabled', 'enabled');
    bindCheckbox('#memory-enable-new-chats', 'enableInNewChats');
    bindCheckbox('#memory-display', 'displayMemories', updateMemoryDisplay);
    bindCheckbox('#memory-auto-summarize', 'autoSummarize');

    // Limits & Numbers
    bindInput('#memory-short-term-limit', 'shortTermLimit', true);
    bindInput('#memory-long-term-limit', 'longTermLimit', true);
    bindInput('#memory-message-threshold', 'messageThreshold', true);

    // Prompts
    bindInput('#memory-summary-prompt', 'summaryPrompt');

    // Colors
    bindInput('#memory-color-short', 'colorShortTerm', false, applyCSSVariables);
    bindInput('#memory-color-long', 'colorLongTerm', false, applyCSSVariables);
    bindInput('#memory-color-old', 'colorOutOfContext', false, applyCSSVariables);
    bindInput('#memory-color-excluded', 'colorExcluded', false, applyCSSVariables);

    // Bind Tab Switching
    $('.memory-config-tab').off('click').on('click', function() {
        const tabName = $(this).data('tab');
        $('.memory-config-tab').removeClass('active');
        $(this).addClass('active');
        $('.memory-config-section').removeClass('active');
        $(`.memory-config-section[data-section="${tabName}"]`).addClass('active');
    });

    // Save Button
    $('#memory-save-btn').off('click').on('click', () => {
        const { saveSettingsDebounced } = window.memorySummarizeContext;
        saveSettingsDebounced();
        if (typeof toastr !== 'undefined') toastr.success('Settings saved!');
        $('#memory-config-popup').removeClass('visible');
    });
}

/**
 * Helper to bind a checkbox to a setting
 */
function bindCheckbox(selector, settingKey, callback) {
    const el = $(selector);
    if (!el.length) return;
    
    el.prop('checked', settings[settingKey]);
    el.off('change').on('change', function() {
        settings[settingKey] = $(this).prop('checked');
        const { saveSettingsDebounced } = window.memorySummarizeContext;
        saveSettingsDebounced();
        if (callback) callback();
    });
}

/**
 * Helper to bind an input to a setting
 */
function bindInput(selector, settingKey, isNumber = false, callback) {
    const el = $(selector);
    if (!el.length) return;

    el.val(settings[settingKey]);
    el.off('change').on('change', function() {
        let val = $(this).val();
        if (isNumber) val = parseInt(val) || 0;
        settings[settingKey] = val;
        const { saveSettingsDebounced } = window.memorySummarizeContext;
        saveSettingsDebounced();
        if (callback) callback();
    });
}

function applyCSSVariables() {
    const root = document.documentElement;
    root.style.setProperty('--qm-short', settings.colorShortTerm);
    root.style.setProperty('--qm-long', settings.colorLongTerm);
    root.style.setProperty('--qm-old', settings.colorOutOfContext);
    root.style.setProperty('--qm-excluded', settings.colorExcluded);
}

function updateMemoryDisplay() {
    // Logic to inject visual indicators into the chat
    if (!settings.displayMemories) {
        $('.message-memory').remove();
        return;
    }
    console.log(`[${extensionName}] Updating memory display...`);
}

function createDefaultConfigHTML() {
    return `<div style="padding:20px; color:white; background: #1a1a1a; border-radius: 8px;">
        <h3 style="margin-top:0;">⚠️ Configuration UI Not Found</h3>
        <p>The config.html file could not be loaded.</p>
        <p>Please ensure <code>config.html</code> exists in:<br>
        <code>${extensionFolderPath}/config.html</code></p>
        <hr>
        <h4>Extension Status: Active</h4>
        <p>The extension is loaded but settings UI is unavailable.</p>
        <button id="memory-close-btn" style="padding:8px 16px; margin-top:10px; background:#3b82f6; color:white; border:none; border-radius:4px; cursor:pointer;">Close</button>
    </div>`;
}

// Export for debugging/global access
window.memorySummarize = {
    settings,
    memoryCache,
    init,
    toggleConfigPopup
};

// Initialize when the script loads
(async function() {
    console.log(`[${extensionName}] Extension script loaded, scheduling initialization...`);
    
    // Try to initialize immediately
    await init();
})();
