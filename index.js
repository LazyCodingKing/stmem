// ============================================================================
// IMPORTS: 3 Levels Up (Correct for your install)
// ============================================================================
import {
    saveSettingsDebounced,
    generateRaw,
    getRequestHeaders,
} from '../../../../script.js';

import {
    extension_settings,
    loadExtensionSettings,
} from '../../../extensions.js';

// ============================================================================
// SETUP: Get Context & Tools
// ============================================================================
const context = SillyTavern.getContext();
const eventSource = context.eventSource;
const event_types = context.event_types;
// We grab the template loader from context to load settings.html safely
const renderExtensionTemplateAsync = context.renderExtensionTemplateAsync; 

// ============================================================================
// CONSTANTS & CONFIG
// ============================================================================

const extensionName = 'memory-summarize';
const extensionPath = 'third-party/memory-summarize'; // Based on your log
const MAX_SUMMARY_WORDS = 350;

// Default settings
const defaultSettings = {
    enabled: true,           // Maps to #auto_summarize
    messageThreshold: 20,    // Maps to #summarization_delay
    master_summary: "",
    debugMode: true
};

// ============================================================================
// HELPER: HTML CLEANER
// ============================================================================
function cleanTextForSummary(text) {
    if (!text) return "";
    text = text.replace(/User's Stats[\s\S]*?(?=\n\n|$)/g, "");
    text = text.replace(/Info Box[\s\S]*?(?=\n\n|$)/g, "");
    text = text.replace(/Present Characters[\s\S]*?(?=\n\n|$)/g, "");
    text = text.replace(/```\w*\n?/g, "").replace(/```/g, "");
    text = text.replace(/<[^>]*>/g, " ");
    text = text.replace(/\s+/g, " ").trim();
    return text;
}

// ============================================================================
// CORE LOGIC: ROLLING SUMMARY
// ============================================================================
async function triggerRollingSummarize() {
    const chat = context.chat;
    const threshold = extension_settings[extensionName].messageThreshold || 20;

    // Safety: Need enough messages
    if (!chat || chat.length < threshold) return;

    // Only grab the recent messages
    const recentMessages = chat.slice(-threshold);

    let newEventsText = recentMessages.map(msg => {
        return `${msg.name}: ${cleanTextForSummary(msg.mes)}`;
    }).join('\n');

    if (newEventsText.length < 50) return;

    let currentMemory = extension_settings[extensionName].master_summary || "No prior history.";

    const prompt = `
    You are an expert Story Summarizer. Update the "Current Story Summary" to include the "New Events".
    
    [Current Story Summary]:
    "${currentMemory}"

    [New Events]:
    "${newEventsText}"

    [INSTRUCTIONS]:
    - Rewrite the summary to be a seamless narrative.
    - Merge new events into the history.
    - Drop very old, irrelevant details if needed.
    - KEEP THE TOTAL LENGTH UNDER ${MAX_SUMMARY_WORDS} WORDS.
    - Do not output any explanation, just the new summary text.
    `;

    console.log(`[${extensionName}] Generating Rolling Summary...`);

    try {
        const newSummary = await generateRaw(prompt, {
            max_length: 500,
            temperature: 0.7
        });

        if (newSummary && newSummary.length > 10) {
            extension_settings[extensionName].master_summary = newSummary.trim();
            saveSettingsDebounced();
            console.log(`[${extensionName}] Memory Updated!`);
            toastr.success("Memory Updated", "Rolling Summary");
            
            // Update UI if open (Optional)
            $('#qvink_memory_display').text(newSummary.trim());
        }
    } catch (e) {
        console.error(`[${extensionName}] Summarization Failed:`, e);
    }
}

// ============================================================================
// INTERCEPTOR
// ============================================================================
function memory_intercept_messages(chat, ...args) {
    if (!extension_settings[extensionName]?.enabled) return;

    const memory = extension_settings[extensionName].master_summary;

    if (memory && memory.length > 5) {
        const memoryBlock = {
            name: "System",
            is_system: true,
            mes: `[STORY SUMMARY SO FAR: ${memory}]`,
            force_avatar: "system.png"
        };
        chat.unshift(memoryBlock);
    }
}

// ============================================================================
// UI BINDING (Connects HTML inputs to Settings)
// ============================================================================
function bindSettingsUI() {
    // 1. Connect "Auto Summarize" Checkbox
    const $enableBox = $('#auto_summarize');
    $enableBox.prop('checked', extension_settings[extensionName].enabled);
    $enableBox.on('change', () => {
        extension_settings[extensionName].enabled = $enableBox.prop('checked');
        saveSettingsDebounced();
    });

    // 2. Connect "Message Lag" (Threshold) Input
    const $thresholdInput = $('#summarization_delay'); // Reusing this input ID from your HTML
    $thresholdInput.val(extension_settings[extensionName].messageThreshold);
    $thresholdInput.on('change', () => {
        const val = parseInt($thresholdInput.val());
        if (!isNaN(val) && val > 0) {
            extension_settings[extensionName].messageThreshold = val;
            saveSettingsDebounced();
        }
    });
}

// ============================================================================
// INITIALIZATION
// ============================================================================
jQuery(async function () {
    console.log(`[${extensionName}] Initializing...`);

    // 1. Load Settings
    const settings = await loadExtensionSettings(extensionName);
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {};
    }
    Object.assign(extension_settings[extensionName], defaultSettings, settings);

    // 2. INJECT HTML UI (This is what we missed!)
    try {
        // We use the path from your log: third-party/memory-summarize
        const settingsHtml = await renderExtensionTemplateAsync(extensionPath, 'settings');
        $('#extensions_settings').append(settingsHtml);
        
        // Bind the inputs so they actually work
        bindSettingsUI();
        
    } catch (e) {
        console.error(`[${extensionName}] Failed to load settings.html:`, e);
    }

    // 3. Register Listeners
    if (eventSource) {
        eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
            const currentContext = SillyTavern.getContext();
            const msgCount = currentContext.chat.length;
            const threshold = extension_settings[extensionName].messageThreshold;

            if (msgCount > 0 && msgCount % threshold === 0) {
                await triggerRollingSummarize();
            }
        });
    }

    // 4. Expose for manifest
    window.memory_intercept_messages = memory_intercept_messages;

    console.log(`[${extensionName}] Ready with UI. 🚀`);
});
