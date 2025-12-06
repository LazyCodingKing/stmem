import { getContext, extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { saveSettingsDebounced, generateRaw } from '../../../../script.js';

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
    pruning_buffer: 2, 
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

// --- Visual Injection ---
function renderVisuals(errorMsg = null) {
    if (!settings.enabled || !settings.show_visuals) {
        $('.titan-chat-node').remove();
        return;
    }

    const meta = getMeta();
    const chat = $('#chat');
    const lastMsg = chat.children('.mes').last();
    if (lastMsg.length === 0) return;

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

    if (html) lastMsg.find('.mes_text').append(html);
}

// --- The Core: Summarizer (Integrated Mode) ---
async function runSummarization() {
    if (isProcessing) return;
    const ctx = getContext();
    if (!ctx.character) return;

    const meta = getMeta();
    const chat = ctx.chat;
    const lastIndex = meta.last_index || 0;
    
    if (lastIndex >= chat.length) {
        $('#titan-status').text("No new messages to summarize.");
        return;
    }

    isProcessing = true;
    renderVisuals();
    $('#titan-status').text('Generating summary using Main API...');

    try {
        const newLines = chat.slice(lastIndex).map(m => `${m.name}: ${m.mes}`).join('\n');
        const existingMemory = meta.summary || "No history yet.";
        
        let promptText = settings.prompt_template;
        promptText = promptText.replace('{{EXISTING}}', existingMemory);
        promptText = promptText.replace('{{NEW_LINES}}', newLines);

        // --- THE QVINK METHOD: USE INTERNAL GENERATION ---
        // This uses whatever settings you have in SillyTavern (OpenAI, Ooba, etc.)
        const result = await generateRaw(promptText, {
            max_length: 600,       // Max tokens for summary
            stop: ["INSTRUCTION:", "RECENT CONVERSATION:", "UPDATED MEMORY:"],
            temperature: 0.5,
            skip_w_info: true,     // Don't inject World Info into the summary prompt
            include_jailbreak: false
        });

        if (!result) throw new Error("Main API returned empty text");

        let cleanResult = result.trim();

        setMeta({
            summary: cleanResult,
            last_index: chat.length
        });

        $('#titan-status').text('Summary updated.');
        updateUI();
        isProcessing = false;
        renderVisuals();

    } catch (e) {
        err(e);
        isProcessing = false;
        $('#titan-status').text(`Error: ${e.message}`).addClass('error');
        renderVisuals(`Failed: ${e.message}`);
    }
}

// --- Context Processor: Injection ---
const titanProcessor = (data) => {
    if (!settings.enabled) return;
    const meta = getMeta();
    if (!meta.summary) return;

    const summaryMsg = {
        is_system: true,
        mes: `[System Note: Long-term memory]\n${meta.summary}`,
        send_as: 'system',
        force_avatar: 'system'
    };
    data.chat.unshift(summaryMsg);
};

// --- Event Handlers ---
function onNewMessage() {
    if (!settings.enabled) return;
    const ctx = getContext();
    const meta = getMeta();
    const lastIndex = meta.last_index || 0;
    const currentCount = ctx.chat.length;

    // Pruning (Token Saving)
    if (settings.pruning_enabled && lastIndex > 0) {
        const IGNORE = ctx.symbols.ignore;
        const buffer = settings.pruning_buffer || 2;
        const pruneLimit = lastIndex - buffer;

        if (pruneLimit > 0) {
            for (let i = 0; i < pruneLimit; i++) {
                if (!ctx.chat[i][IGNORE]) ctx.chat[i][IGNORE] = true;
            }
        }
    }

    // Trigger
    const diff = currentCount - lastIndex;
    if (diff >= settings.threshold) {
        log(`Threshold reached. Summarizing.`);
        runSummarization();
    } else {
        renderVisuals();
    }
    
    updateUI();
}

function setupUI() {
    const bind = (id, key, type='text') => {
        const el = $(`#${id}`);
        if (type === 'check') {
            el.prop('checked', settings[key]);
            el.on('change', () => { settings[key] = el.prop('checked'); saveSettings(); renderVisuals(); });
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
        $('#titan-status').text('Memory manually updated.');
        renderVisuals();
    });

    $('#titan-now').on('click', runSummarization);

    $('#titan-wipe').on('click', () => {
        if(confirm("Delete all memory?")) {
            setMeta({ summary: '', last_index: 0 });
            const ctx = getContext();
            const IGNORE = ctx.symbols.ignore;
            ctx.chat.forEach(m => delete m[IGNORE]);
            updateUI();
            renderVisuals(); 
            $('#titan-status').text('Memory wiped.');
        }
    });
}

function saveSettings() {
    extension_settings[MODULE] = settings;
    saveSettingsDebounced();
}

async function init() {
    settings = { ...defaults, ...(extension_settings[MODULE] || {}) };

    const url = new URL(import.meta.url);
    const path = url.pathname.substring(0, url.pathname.lastIndexOf('/'));
    const html = await (await fetch(`${path}/settings.html`)).text();
    $('#extensions_settings2').append(html);

    setupUI();

    const ctx = getContext();
    ctx.eventSource.on('chat:new-message', onNewMessage);
    ctx.eventSource.on('chat_message_rendered', () => setTimeout(renderVisuals, 100));
    
    ctx.eventSource.on('chat_loaded', () => { 
        updateUI(); 
        onNewMessage(); 
        setTimeout(renderVisuals, 500); 
    });

    ctx.contextProcessors.push(titanProcessor);

    log('Titan Memory v3 (Integrated) Loaded.');
}

init();
