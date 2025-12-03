import {
    saveSettingsDebounced
} from '../../../../script.js';

import { 
    extension_settings, 
    getContext 
} from '../../../extensions.js';

// ============================================================================
// CONFIGURATION & DEFAULTS
// ============================================================================

const extensionName = 'memory-summarize';

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

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function get_extension_directory() {
    // Calculates the path dynamically like index (1).js
    let index_path = new URL(import.meta.url).pathname;
    return index_path.substring(0, index_path.lastIndexOf('/'));
}

function get_settings(key) {
    let store = extension_settings?.[extensionName];
    if (!store) {
        // Fallback to fetching context if direct import fails
        store = getContext().extension_settings?.[extensionName];
    }
    return store?.[key] ?? defaultSettings[key];
}

function set_settings(key, value) {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = { ...defaultSettings };
    }
    extension_settings[extensionName][key] = value;
    saveSettingsDebounced();
}

// ============================================================================
// CORE LOGIC
// ============================================================================

async function load_html() {
    // Manual fetch using $.get (The "Old Method")
    let module_dir = get_extension_directory();
    let path = `${module_dir}/config.html`;

    console.log(`[${extensionName}] Loading HTML from: ${path}`);

    try {
        const response = await $.get(path);
        
        // 1. Create the Popup Container
        const popupHTML = `
            <div id="memory-config-popup" class="memory-config-popup" style="display:none;">
                 ${response}
            </div>`;
        
        if ($('#memory-config-popup').length === 0) {
            $('body').append(popupHTML);
        }

        // 2. Create the Menu Button
        if ($('#memory-summarize-button').length === 0) {
            const buttonHtml = `
                <div id="memory-summarize-button" class="list-group-item flex-container flexGap5" title="Memory Summarize v2.0">
                    <div class="fa-solid fa-brain extensionsMenuExtensionButton"></div> 
                    <span>Memory Summarize</span>
                </div>`;
            $('#extensions_settings').append(buttonHtml);
            $('#memory-summarize-button').on('click', () => toggleConfigPopup());
        }

        console.log(`[${extensionName}] HTML Loaded successfully.`);
        return true;
    } catch (err) {
        console.error(`[${extensionName}] Error loading HTML:`, err);
        return false;
    }
}

function initialize_settings() {
    // Ensure settings exist
    let globalStore = extension_settings;
    if (!globalStore) {
        globalStore = getContext().extension_settings;
    }

    if (globalStore && !globalStore[extensionName]) {
        console.log(`[${extensionName}] Initializing default settings...`);
        globalStore[extensionName] = structuredClone(defaultSettings);
        saveSettingsDebounced();
    }
}

function bind_ui_listeners() {
    // Close buttons
    $(document).on('click', '#memory-close-btn, #memory-cancel-btn', function() {
        $('#memory-config-popup').removeClass('visible').hide();
    });

    // Inputs
    bind_checkbox('#memory-enabled', 'enabled');
    bind_checkbox('#memory-auto-summarize', 'autoSummarize');
    bind_checkbox('#memory-display', 'displayMemories');
    
    // Apply CSS
    applyCSSVariables();
}

function bind_checkbox(selector, key) {
    const el = $(selector);
    el.prop('checked', get_settings(key));
    el.off('change').on('change', function() {
        set_settings(key, $(this).prop('checked'));
    });
}

function toggleConfigPopup() {
    const popup = $('#memory-config-popup');
    if (popup.is(':visible')) {
        popup.removeClass('visible').hide();
    } else {
        popup.addClass('visible').show();
        bind_ui_listeners(); // Refresh values
    }
}

function applyCSSVariables() {
    const root = document.documentElement;
    root.style.setProperty('--qm-short', get_settings('colorShortTerm'));
    root.style.setProperty('--qm-long', get_settings('colorLongTerm'));
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

jQuery(async function () {
    console.log(`[${extensionName}] Loading extension...`);

    // 1. Initialize Settings
    initialize_settings();

    // 2. Load HTML
    await load_html();

    // 3. Bind UI
    bind_ui_listeners();

    // 4. Register Event Listeners
    // We get eventSource from getContext() to be safe
    const context = getContext();
    const eventSource = context.eventSource;
    const event_types = context.event_types;

    if (eventSource) {
        eventSource.on(event_types.CHAT_CHANGED, () => {
            console.log(`[${extensionName}] Chat changed`);
        });
        // You can add more listeners here later
    }

    console.log(`[${extensionName}] Ready.`);
});
