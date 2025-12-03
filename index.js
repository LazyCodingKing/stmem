import {
    saveSettingsDebounced,
    generateRaw,
    eventSource,
    event_types,
    getRequestHeaders,
} from '/scripts/script.js'; // FIXED: Absolute path

import {
    extension_settings,
    getContext,
    loadExtensionSettings,
} from '/scripts/extensions.js'; // FIXED: Absolute path

// ============================================================================
// CONSTANTS & CONFIG
// ============================================================================

const extensionName = 'memory-summarize';
const summaryDivClass = 'qvink_memory_text';
const MAX_SUMMARY_WORDS = 350; // TOKEN SAVER: Hard limit on summary size

// Default settings (merged with user settings on load)
const defaultSettings = {
    enabled: true,
    autoSummarize: true,
    messageThreshold: 20, // Summarize every 20 messages
    master_summary: "",   // The "Rolling Memory" lives here
};

// ============================================================================
// HELPER: THE SMART PEELER (HTML/Stats Cleaner)
// ============================================================================
function cleanTextForSummary(text) {
    if (!text) return "";

    // 1. SPECIFIC KILL LIST: Remove UI Stats / Info Boxes completely
    text = text.replace(/User's Stats[\s\S]*?(?=\n\n|$)/g, "");
    text = text.replace(/Info Box[\s\S]*?(?=\n\n|$)/g, "");
    text = text.replace(/Present Characters[\s\S]*?(?=\n\n|$)/g, "");

    // 2. UNWRAP HTML: Handle "Bulletin Boards" or generic code blocks
    // Remove the ``` markers
    text = text.replace(/```\w*\n?/g, "").replace(/```/g, "");

    // 3. STRIP TAGS: Remove <div...>, <br>, </span> but keep text
    text = text.replace(/<[^>]*>/g, " ");

    // 4. CLEANUP: Squash extra spaces
    text = text.replace(/\s+/g, " ").trim();

    return text;
}

// ============================================================================
// CORE LOGIC: ROLLING SUMMARIZATION
// ============================================================================

async function triggerRollingSummarize() {
    const context = getContext();
    const chat = context.chat;
    
    // Safety Check: Do we have enough messages?
    // We only want to summarize the *new* messages since the last run.
    // For simplicity in this "Rolling" version, we grab the last X messages.
    const threshold = extension_settings[extensionName].messageThreshold || 20;
    const recentMessages = chat.slice(-threshold); 

    // 1. Prepare the Text
    let newEventsText = recentMessages.map(msg => {
        return `${msg.name}: ${cleanTextForSummary(msg.mes)}`;
    }).join('\n');

    if (newEventsText.length < 50) return; // Too short to summarize

    // 2. Get the Old Memory
    let currentMemory = extension_settings[extensionName].master_summary || "No prior history.";

    // 3. Build the "Updater" Prompt
    const prompt = `
    You are an expert Story Summarizer. Update the "Current Story Summary" to include the "New Events".
    
    [Current Story Summary]:
    "${currentMemory}"

    [New Events]:
    "${newEventsText}"

    [INSTRUCTIONS]:
    - Rewrite the summary to be a seamless narrative.
    - Merge new events into the history.
    - Drop very old, irrelevant details if needed to save space.
    - KEEP THE TOTAL LENGTH UNDER ${MAX_SUMMARY_WORDS} WORDS.
    - Do not output any explanation, just the new summary text.
    `;

    console.log(`[${extensionName}] Generating Rolling Summary...`);

    // 4. Call the AI
    try {
        const newSummary = await generateRaw(prompt, {
            max_length: 500,
            temperature: 0.7
        });

        if (newSummary && newSummary.length > 10) {
            // 5. Update the Master Memory
            extension_settings[extensionName].master_summary = newSummary.trim();
            saveSettingsDebounced();
            console.log(`[${extensionName}] Memory Updated!`);
            
            // Visual Feedback (Optional: Toast or Log)
            toastr.success("Memory Updated", "Rolling Summary");
        }
    } catch (e) {
        console.error(`[${extensionName}] Summarization Failed:`, e);
    }
}

// ============================================================================
// INTERCEPTOR: INJECT MEMORY INTO PROMPT
// ============================================================================
// This function must be registered in manifest.json as "generate_interceptor"
function memory_intercept_messages(chat, ...args) {
    if (!extension_settings[extensionName].enabled) return;

    const memory = extension_settings[extensionName].master_summary;
    
    if (memory && memory.length > 5) {
        // We inject the memory at the VERY TOP of the context (or depth 0)
        // This acts like "Author's Note" or "World Info"
        const memoryBlock = {
            name: "System",
            is_system: true,
            mes: `[STORY SUMMARY SO FAR: ${memory}]`,
            force_avatar: "system.png"
        };
        
        // Insert at index 0 (Top of context)
        chat.unshift(memoryBlock);
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

jQuery(async function () {
    // 1. Load Settings
    const settings = await loadExtensionSettings(extensionName);
    // Merge defaults carefully
    Object.assign(extension_settings[extensionName], defaultSettings, settings);

    // 2. Register Listeners (No more Timeout race conditions!)
    if (eventSource) {
        eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
            // Check if we hit the threshold to trigger an update
            const context = getContext();
            const msgCount = context.chat.length;
            const threshold = extension_settings[extensionName].messageThreshold;
            
            // Simple logic: If total messages is a multiple of threshold (e.g., 20, 40, 60)
            if (msgCount % threshold === 0) {
                await triggerRollingSummarize();
            }
        });
    }

    // 3. Expose function to global scope (for manifest interceptor)
    window.memory_intercept_messages = memory_intercept_messages;

    console.log(`[${extensionName}] Rolling Memory System Ready. 🧠`);
});
