import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    getContext
} from '../../../../script.js';

import { extension_settings } from '../../../extensions.js';

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
// UTILITY FUNCTIONS (The "Old Method" Helpers)
// ============================================================================

function get_extension_directory() {
    // This calculates the current folder path dynamically, just like index (1).js
    let index_path = new URL(import.meta.url).pathname;
    return index_path.substring(0, index_path.lastIndexOf('/'));
}

function get_settings(key) {
    // Fail-safe: Try imported settings, then global, then context
    let store = extension_settings?.[extensionName];
    if (!store) {
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
    // THE OLD METHOD: Manual fetch using $.get
    let module_dir = get_extension_directory();
    let path = `${module_dir}/config.html`;

    console.log(`[${extensionName}] Loading HTML from: ${path}`);

    try {
        const response = await $.get(path);
        
        // 1. Create the Popup Container
        // We append this to body so it floats above everything
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
        toastr.error("Failed to load Memory Summarize HTML. Check console.");
        return false;
    }
}

function initialize_settings() {
    // Ensure settings exist. If 'extension_settings' is null here, we grab it from context.
    let globalStore = extension_settings;
    if (!globalStore) {
        console.warn(`[${extensionName}] Imported settings were null, using context.`);
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
    el.on('change', function() {
        set_settings(key, $(this).prop('checked'));
    });
}

function toggleConfigPopup() {
    const popup = $('#memory-config-popup');
    // Using jQuery toggle/show/hide like the old days
    if (popup.is(':visible')) {
        popup.removeClass('visible').hide();
    } else {
        popup.addClass('visible').show();
        // Refresh values when opening
        bind_ui_listeners();
    }
}

function applyCSSVariables() {
    const root = document.documentElement;
    root.style.setProperty('--qm-short', get_settings('colorShortTerm'));
    root.style.setProperty('--qm-long', get_settings('colorLongTerm'));
}

// ============================================================================
// MAIN ENTRY POINT (Matching index (1).js style)
// ============================================================================

jQuery(async function () {
    console.log(`[${extensionName}] Loading extension...`);

    // 1. Initialize Settings
    initialize_settings();

    // 2. Load HTML (The key step)
    await load_html();

    // 3. Bind UI
    bind_ui_listeners();

    // 4. Register Event Listeners
    if (eventSource) {
        eventSource.on(event_types.CHAT_CHANGED, () => {
            console.log(`[${extensionName}] Chat changed`);
        });
    }

    console.log(`[${extensionName}] Ready.`);
});
