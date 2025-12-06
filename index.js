import { getContext, extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { saveSettingsDebounced, generateRaw, amount_gen } from '../../../../script.js';

const MODULE = 'memory-summarize';

const DEFAULT_PROMPT = `[System Note: You are an AI managing the long-term memory of a story.]
Your job is to update the existing summary with new events.

EXISTING MEMORY:
"{{EXISTING}}"

RECENT CONVERSATION:
{{NEW_LINES}}

INSTRUCTION:
Write a consolidated summary in the past tense. 
Merge the new conversation into the existing memory.
Keep it concise. Do not lose key details (names, locations, major plot points).
Do not output anything else, just the summary text.

UPDATED MEMORY:`;

const defaults = {
    enabled: true,
    threshold: 1,
    show_visuals: true,
    pruning_enabled: true,
    prompt_template: DEFAULT_PROMPT,
    debug: true
};

let settings = {};
let isProcessing = false;

// --- Helpers ---
const log = (msg) => console.log(`[Titan] ${msg}`);
const err = (msg) => console.error(`[Titan] ${msg}`);

const getMeta = () => {
    const ctx = getContext();
    if (!ctx.character) return {};
    return ctx.character.metadata[MODULE] || {};
};

const setMeta = (data) => {
    const ctx = getContext();
    if (!ctx.character) return;
    if (!ctx.character.metadata[MODULE]) ctx.character.metadata[MODULE] = {};
    Object.assign(ctx.character.metadata[MODULE], data);
    saveMetadataDebounced();
};

// --- UI Updates ---
function updateUI() {
    const meta = getMeta();
    if (!$('#titan-memory-text').is(':focus')) {
        $('#titan-memory-text').val(meta.summary || '');
    }
    
    const ctx = getContext();
    if (ctx.character) {
        const lastIndex = meta.last_index || 0;
        const count = ctx.chat.length;
        const pending = Math.max(0, count - lastIndex);
        $('#titan-status').text(`Status: Ready. ${pending} new messages pending.`);
    }
}

// --- Visual Injection (Qvink Method: By Message ID) ---
function renderVisuals(errorMsg = null) {
    if (!settings.enabled || !settings.show_visuals) {
        $('.titan-chat-node').remove();
        return;
    }

    const ctx = getContext();
    const meta = getMeta();
    
    // Find the last message ID
    const lastMsgId = ctx.chat.length - 1;
    if (lastMsgId < 0) return;

    // Find the DOM element with that mesid
    const lastMsg = $(`#chat [mesid="${lastMsgId}"]`);
    if (lastMsg.length === 0) return;

    // Remove old nodes
    $('.titan-chat-node').remove();

    let html = '';
    if (errorMsg) {
        html = `<div class="titan-chat-node error">
            <div class="titan-chat-header"><i class="fa-solid fa-triangle-exclamation"></i> Memory Error</div>
            <div class="titan-memory-content">${errorMsg}</div></div>`;
    } else if (isProcessing) {
        html = `<div class="titan-chat-node">
            <div class="titan-chat-header"><i class="fa-solid fa-spinner fa-spin"></i> Updating Memory...</div></div>`;
    } else if (meta.summary) {
        html = `<div class="titan-chat-node">
            <div class="titan-chat-header"><i class="fa-solid fa-brain"></i> Current Memory</div>
            <div class="titan-memory-content" style="white-space: pre-wrap;">${meta.summary}</div></div>`;
    }

    // Inject AFTER the text block (Qvink style)
    if (html) {
        const textBlock = lastMsg.find('.mes_text');
        if (textBlock.length) {
            textBlock.after(html);
        } else {
            lastMsg.append(html);
        }
    }
}

// --- Injection Logic (Qvink Method) ---
function refreshMemoryInjection() {
    const ctx = getContext();
    const meta = getMeta();
    
    if (!settings.enabled || !meta.summary) {
        ctx.setExtensionPrompt(`${MODULE}_injection`, '');
        return;
    }

    const injectionText = `[System Note - Story Memory]:\n${meta.summary}`;
    // extensionName, text, position, depth, scan, role
    ctx.setExtensionPrompt(`${MODULE}_injection`, injectionText, 0, 0, true, 0);
}

// --- Pruning Logic ---
globalThis.titan_intercept_messages = function (chat, contextSize) {
    if (!settings.enabled || !settings.pruning_enabled) return;

    const meta = getMeta();
    const lastIndex = meta.last_index || 0;
    const buffer = 4;
    const pruneLimit = lastIndex - buffer;

    if (pruneLimit > 0) {
        const ctx = getContext();
        const IGNORE = ctx.symbols.ignore; 

        for (let i = 0; i < chat.length; i++) {
            if (i < pruneLimit) {
                if (!chat[i][IGNORE]) chat[i][IGNORE] = true;
            }
        }
    }
};

// --- Summarizer (Fixed API Call) ---
async function runSummarization() {
    if (isProcessing) return;
    const ctx = getContext();
    if (!ctx.character) return;

    const meta = getMeta();
    const chat = ctx.chat;
    const lastIndex = meta.last_index || 0;
    
    if (lastIndex >= chat.length) return;

    isProcessing = true;
    renderVisuals();
    $('#titan-status').text('Generating summary...');

    try {
        const newLines = chat.slice(lastIndex).map(m => `${m.name}: ${m.mes}`).join('\n');
        const existingMemory = meta.summary || "No history yet.";
        
        let promptText = settings.prompt_template;
        promptText = promptText.replace('{{EXISTING}}', existingMemory);
        promptText = promptText.replace('{{NEW_LINES}}', newLines);

        // Construct Chat Array for compatibility
        const messages = [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: promptText }
        ];

        // --- THE FIX: Pass a SINGLE OBJECT to generateRaw ---
        // This matches Qvink's implementation exactly.
        const result = await generateRaw({
            prompt: messages, 
            max_length: 600,
            stop: ["INSTRUCTION:", "RECENT CONVERSATION:", "UPDATED MEMORY:"],
            temperature: 0.5,
            skip_w_info: true,
            include_jailbreak: false
        });

        if (!result) throw new Error("API returned empty text");

        let cleanResult = result.trim();

        setMeta({
            summary: cleanResult,
            last_index: chat.length
        });

        updateUI();
        refreshMemoryInjection();
        
    } catch (e) {
        err(e);
        $('#titan-status').text(`Error: ${e.message}`).addClass('error');
        renderVisuals(`Failed: ${e.message}`);
    } finally {
        isProcessing = false;
        $('#titan-status').text('Ready.');
        renderVisuals();
    }
}

// --- Event Handlers ---
function onNewMessage() {
    if (!settings.enabled) return;
    const ctx = getContext();
    const meta = getMeta();
    const lastIndex = meta.last_index || 0;
    const currentCount = ctx.chat.length;

    const diff = currentCount - lastIndex;
    
    if (diff >= settings.threshold) {
        log(`Threshold reached (${diff}). Summarizing.`);
        runSummarization();
    } else {
        refreshMemoryInjection();
        renderVisuals();
    }
    updateUI();
}

function setupUI() {
    const bind = (id, key, type='text') => {
        const el = $(`#${id}`);
        if (type === 'check') {
            el.prop('checked', settings[key]);
            el.on('change', () => { settings[key] = el.prop('checked'); saveSettings(); refreshMemoryInjection(); renderVisuals(); });
        } else {
            el.val(settings[key]);
            el.on('change', () => { settings[key] = (type==='num' ? Number(el.val()) : el.val()); saveSettings(); });
        }
    };

    bind('titan-enabled', 'enabled', 'check');
    bind('titan-show-visuals', 'show_visuals', 'check');
    bind('titan-pruning', 'pruning_enabled', 'check');
    bind('titan-threshold', 'threshold', 'num');
    bind('titan-prompt-template', 'prompt_template');

    $('#titan-reset-prompt').on('click', () => {
        $('#titan-prompt-template').val(DEFAULT_PROMPT).trigger('change');
    });

    $('#titan-save').on('click', () => {
        setMeta({ summary: $('#titan-memory-text').val() });
        refreshMemoryInjection();
        renderVisuals();
        $('#titan-status').text('Saved.');
    });

    $('#titan-now').on('click', runSummarization);

    $('#titan-wipe').on('click', () => {
        if(confirm("Delete all memory?")) {
            setMeta({ summary: '', last_index: 0 });
            refreshMemoryInjection();
            renderVisuals(); 
            updateUI();
        }
    });
}

function saveSettings() {
    extension_settings[MODULE] = settings;
    saveSettingsDebounced();
}

// --- MAIN ENTRY POINT ---
jQuery(async function () {
    log('Initializing Titan Memory v12...');

    settings = { ...defaults, ...(extension_settings[MODULE] || {}) };

    const url = new URL(import.meta.url);
    const path = url.pathname.substring(0, url.pathname.lastIndexOf('/'));
    try {
        const html = await (await fetch(`${path}/settings.html`)).text();
        $('#extensions_settings2').append(html);
        setupUI();
    } catch (e) {
        err("Failed to load settings.html: " + e);
    }

    const ctx = getContext();
    const event_types = ctx.event_types;

    // Listeners using System Types (Qvink Style)
    ctx.eventSource.on(event_types.USER_MESSAGE_RENDERED, () => {
        log("User message rendered");
        onNewMessage();
    });

    ctx.eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
        log("Character message rendered");
        onNewMessage();
    });

    ctx.eventSource.on(event_types.CHAT_CHANGED, () => {
        log("Chat changed");
        updateUI();
        refreshMemoryInjection();
        setTimeout(renderVisuals, 500);
    });

    // Initial Check
    if (ctx.chat && ctx.chat.length > 0) {
        updateUI();
        refreshMemoryInjection();
        setTimeout(renderVisuals, 1000);
    }

    log('Titan Memory v12 (Qvink API Match) Loaded.');
});
