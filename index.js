import {
    saveSettingsDebounced,
    generateQuietPrompt,
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
    
    // Limits
    shortTermLimit: 2000,
    shortTermUnit: 'tokens',
    longTermLimit: 4000,
    longTermUnit: 'tokens',
    messageThreshold: 50,
    
    // Prompting
    summaryPrompt: 'Summarize the following message concisely in 1-2 sentences:\n\n{{message}}',
    summaryMaxTokens: 150,
    summaryTemperature: 0.1,
    
    // Connection
    connectionProfile: '',

    // Automation
    batchSize: 1,
    messageLag: 0,
    
    // Display
    displayMemories: true,
    colorShortTerm: '#22c55e',
    colorLongTerm: '#3b82f6',
    
    // Injection
    startInjectingAfter: 3,
    removeMessagesAfterThreshold: false,
    includeUserMessages: false,
    includeSystemMessages: false,
    includeCharacterMessages: true,
    
    debugMode: false,
    activeProfile: 'default'
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function get_extension_directory() {
    let index_path = new URL(import.meta.url).pathname;
    return index_path.substring(0, index_path.lastIndexOf('/'));
}

function get_settings(key) {
    let store = extension_settings?.[extensionName];
    if (!store) store = getContext().extension_settings?.[extensionName];
    return store?.[key] ?? defaultSettings[key];
}

function set_settings(key, value) {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = { ...defaultSettings };
    }
    extension_settings[extensionName][key] = value;
    saveSettingsDebounced();
}

function log(msg, ...args) {
    console.log(`[${extensionName}] ${msg}`, ...args);
}

// ============================================================================
// CORE LOGIC: SUMMARIZATION
// ============================================================================

async function triggerAutoSummarize() {
    if (!get_settings('enabled') || !get_settings('autoSummarize')) return;

    const context = getContext();
    const chat = context.chat;

    if (!chat || chat.length === 0) return;

    // Logic: Determine target message based on lag
    const lag = parseInt(get_settings('messageLag')) || 0;
    const targetIndex = chat.length - 1 - lag;

    if (targetIndex < 0) return; 

    const targetMsg = chat[targetIndex];

    // Filters
    if (targetMsg.is_system && !get_settings('includeSystemMessages')) return;
    if (!targetMsg.is_user && !targetMsg.is_system && !get_settings('includeCharacterMessages')) return;
    if (targetMsg.is_user && !get_settings('includeUserMessages')) return;
    
    // Check if already summarized
    if (targetMsg.extensions?.[extensionName]?.summary) {
        log(`Message ${targetIndex} already has a summary.`);
        return;
    }

    // Check Length
    const content = targetMsg.mes; 
    if (!content || content.length < get_settings('messageThreshold')) {
        log(`Message ${targetIndex} too short to summarize.`);
        return;
    }

    // Execute
    await generateSummaryForMessage(targetIndex, content);
}

async function generateSummaryForMessage(index, content) {
    log(`Generating summary for message ${index}...`);
    
    const rawPrompt = get_settings('summaryPrompt');
    const prompt = rawPrompt.replace('{{message}}', content);

    try {
        // SillyTavern function to generate text in background
        const result = await generateQuietPrompt(prompt, true, true); 
        
        if (result) {
            log(`Summary generated: ${result}`);
            
            const context = getContext();
            if (!context.chat[index].extensions) context.chat[index].extensions = {};
            
            context.chat[index].extensions[extensionName] = {
                summary: result.trim(),
                timestamp: Date.now()
            };

            context.saveChat();
            
            if (get_settings('displayMemories')) {
                // In a real scenario, you might trigger a UI refresh here
                // For now we just log it to ensure it works without breaking the chat render
                log("Summary saved to chat.");
            }
        }
    } catch (err) {
        console.error(`[${extensionName}] Generation failed:`, err);
    }
}

// ============================================================================
// UI LOGIC
// ============================================================================

async function load_html() {
    let module_dir = get_extension_directory();
    let path = `${module_dir}/config.html`;

    try {
        const response = await $.get(path);
        
        if ($('#memory-config-popup').length === 0) {
             const popupHTML = `
            <div id="memory-config-popup" class="memory-config-popup" style="display:none;">
                 ${response}
            </div>`;
            $('body').append(popupHTML);
        } else {
            $('#memory-config-popup').html(response);
        }

        if ($('#memory-summarize-button').length === 0) {
            const buttonHtml = `
                <div id="memory-summarize-button" class="list-group-item flex-container flexGap5" title="Memory Summarize v2.0">
                    <div class="fa-solid fa-brain extensionsMenuExtensionButton"></div> 
                    <span>Memory Summarize</span>
                </div>`;
            $('#extensions_settings').append(buttonHtml);
            $('#memory-summarize-button').on('click', () => toggleConfigPopup());
        }

        return true;
    } catch (err) {
        console.error(`[${extensionName}] Error loading HTML:`, err);
        return false;
    }
}

function bind_ui_listeners() {
    // 1. Close / Toggle
    $(document).off('click', '#memory-close-btn, #memory-cancel-btn').on('click', '#memory-close-btn, #memory-cancel-btn', function() {
        $('#memory-config-popup').removeClass('visible').hide();
    });

    // 2. Tab Switching
    $(document).off('click', '.memory-config-tab').on('click', '.memory-config-tab', function() {
        $('.memory-config-tab').removeClass('active');
        $(this).addClass('active');

        const targetSection = $(this).data('tab');
        $('.memory-config-section').removeClass('active');
        $(`.memory-config-section[data-section="${targetSection}"]`).addClass('active');
    });

    // 3. Inputs
    const checkboxes = ['enabled', 'autoSummarize', 'displayMemories', 'enableInNewChats', 'includeUserMessages', 'includeSystemMessages', 'removeMessagesAfterThreshold'];
    
    checkboxes.forEach(key => {
        // Helper to handle both camelCase key and hyphenated-id
        const hyphen = key.replace(/[A-Z]/g, m => "-" + m.toLowerCase());
        const selector = `#memory-${hyphen}`;
        
        bind_checkbox(selector, key);
    });

    bind_input('#memory-short-term-limit', 'shortTermLimit');
    bind_input('#memory-long-term-limit', 'longTermLimit');
    bind_input('#memory-message-threshold', 'messageThreshold');
    bind_input('#memory-max-tokens', 'summaryMaxTokens');
    bind_input('#memory-inject-after', 'startInjectingAfter');
    bind_textarea('#memory-summary-prompt', 'summaryPrompt');
    bind_input('#memory-short-term-unit', 'shortTermUnit');
    bind_input('#memory-long-term-unit', 'longTermUnit');

    $('#memory-save-btn').off('click').on('click', () => {
        $('#memory-config-popup').removeClass('visible').hide();
        saveSettingsDebounced();
        if (typeof toastr !== 'undefined') toastr.success('Settings Saved');
    });
    
    applyCSSVariables();
}

function bind_checkbox(selector, key) {
    const el = $(selector);
    if (!el.length) return;
    el.prop('checked', get_settings(key));
    el.off('change').on('change', function() {
        set_settings(key, $(this).prop('checked'));
    });
}

function bind_input(selector, key) {
    const el = $(selector);
    if (!el.length) return;
    el.val(get_settings(key));
    el.off('change input').on('change input', function() {
        set_settings(key, $(this).val());
    });
}

function bind_textarea(selector, key) {
    const el = $(selector);
    if (!el.length) return;
    el.val(get_settings(key));
    el.off('change input').on('change input', function() {
        set_settings(key, $(this).val());
    });
}

function toggleConfigPopup() {
    const popup = $('#memory-config-popup');
    if (popup.is(':visible')) {
        popup.removeClass('visible').hide();
    } else {
        popup.addClass('visible').show();
        bind_ui_listeners();
    }
}

function applyCSSVariables() {
    const root = document.documentElement;
    root.style.setProperty('--qm-short', get_settings('colorShortTerm'));
    root.style.setProperty('--qm-long', get_settings('colorLongTerm'));
}

function initialize_settings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = structuredClone(defaultSettings);
    }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

jQuery(async function () {
    console.log(`[${extensionName}] Loading extension...`);

    initialize_settings();
    await load_html();
    bind_ui_listeners();

    const context = getContext();
    const eventSource = context.eventSource;
    const event_types = context.event_types;

    if (eventSource) {
        eventSource.on(event_types.CHAT_CHANGED, () => {
            log('Chat changed.');
        });

        // Trigger on AI message
        eventSource.on(event_types.MESSAGE_RECEIVED, async (data) => {
            log('Message received. Checking auto-summarize...');
            if (get_settings('autoSummarize')) {
                setTimeout(() => triggerAutoSummarize(), 1000);
            }
        });
        
        // Trigger on User message (if enabled)
        eventSource.on(event_types.MESSAGE_SENT, async () => {
             if (get_settings('autoSummarize') && get_settings('includeUserMessages')) {
                 setTimeout(() => triggerAutoSummarize(), 1000);
             }
        });
    }

    console.log(`[${extensionName}] Ready.`);
});
