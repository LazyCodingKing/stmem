import { getContext, extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const MODULE = 'titan-memory';

// --- Defaults ---
const DEFAULT_PROMPT = `You are a helpful AI assistant managing the long-term memory of a story.
Your job is to update the existing summary with new events.

EXISTING MEMORY:
"{{EXISTING}}"

NEW CONVERSATION:
{{NEW_LINES}}

INSTRUCTION:
Write a consolidated summary in the past tense. 
Merge the new conversation into the existing memory.
Keep it concise. Do not lose key details (names, locations, major plot points).
Do not output anything else, just the summary text.

UPDATED MEMORY:`;

const defaults = {
    enabled: true,
    api_url: 'http://127.0.0.1:5000/api/v1/generate',
    api_key: '',
    threshold: 20, // messages
    pruning_enabled: true,
    pruning_buffer: 4, // Keep this many messages visible even if summarized, for continuity
    prompt_template: DEFAULT_PROMPT,
    debug: false
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
    $('#titan-memory-text').val(meta.summary || '');
    
    // Stats in status bar
    const ctx = getContext();
    if (ctx.character) {
        const lastIndex = meta.last_index || 0;
        const count = ctx.chat.length;
        const pending = Math.max(0, count - lastIndex);
        $('#titan-status').text(`Status: Ready. ${pending} new messages pending summary.`);
    }
}

// --- The Core: Summarizer ---
async function runSummarization() {
    if (isProcessing) return;
    const ctx = getContext();
    if (!ctx.character) return;

    const meta = getMeta();
    const chat = ctx.chat;
    const lastIndex = meta.last_index || 0;
    
    // Validation
    if (lastIndex >= chat.length) {
        $('#titan-status').text("No new messages to summarize.");
        return;
    }

    isProcessing = true;
    $('#titan-now').prop('disabled', true).text('Working...');
    $('#titan-status').text('Generating summary... please wait.');

    try {
        // 1. Gather Data
        const newLines = chat.slice(lastIndex).map(m => `${m.name}: ${m.mes}`).join('\n');
        const existingMemory = meta.summary || "No history yet.";
        
        // 2. Prepare Prompt
        let prompt = settings.prompt_template;
        prompt = prompt.replace('{{EXISTING}}', existingMemory);
        prompt = prompt.replace('{{NEW_LINES}}', newLines);

        // 3. Call API
        const response = await fetch(settings.api_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': settings.api_key ? `Bearer ${settings.api_key}` : undefined
            },
            body: JSON.stringify({
                prompt: prompt,
                max_new_tokens: 600,
                temperature: 0.7,
                top_p: 0.9,
                stop: ["INSTRUCTION:", "NEW CONVERSATION:"]
            })
        });

        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const data = await response.json();
        
        // Handle different API output formats (Ooba/Kobold/OpenAI)
        let result = data.results?.[0]?.text || data.choices?.[0]?.text || data.choices?.[0]?.message?.content || "";
        result = result.trim();

        if (!result) throw new Error("Empty response from API");

        // 4. Save
        setMeta({
            summary: result,
            last_index: chat.length
        });

        $('#titan-status').text('Summary updated successfully!');
        updateUI();

    } catch (e) {
        err(e);
        $('#titan-status').text(`Error: ${e.message}`).addClass('error');
    } finally {
        isProcessing = false;
        $('#titan-now').prop('disabled', false).text('⚡ Summarize Now');
    }
}

// --- Context Processor: Token Reduction & Injection ---
// This runs before every generation to modify what the AI sees
const titanProcessor = (data) => {
    if (!settings.enabled) return;
    const meta = getMeta();
    if (!meta.summary) return;

    // 1. INJECT MEMORY
    // We add a high-priority system message with the summary
    const summaryMsg = {
        is_system: true,
        mes: `[Story Summary / Long Term Memory]:\n${meta.summary}`,
        send_as: 'system',
        force_avatar: 'system' // Helper for some UIs
    };
    // Insert at index 0 (top of context)
    data.chat.unshift(summaryMsg);


    // 2. PRUNE OLD MESSAGES (Token Saving)
    if (settings.pruning_enabled && meta.last_index) {
        const buffer = settings.pruning_buffer || 4;
        
        // meta.last_index is the index in the REAL chat array (ctx.chat)
        // data.chat is the array being prepared for the AI (which we just unshifted)
        
        // We need to mark messages as "hidden" in the real context if we want to save tokens.
        // However, ContextProcessors receive a copy. Modifying 'data.chat' only affects this request.
        
        // Logic: We want to remove messages from `data.chat` that represent 
        // the history already covered by the summary, EXCEPT the last 'buffer' messages.
        
        // We can't rely on indices matching perfectly because `data.chat` might contain 
        // World Info injections or other extension data.
        
        // Reliable method: Iterate the chat provided by ST and filter based on content hash? Too slow.
        // Best approximation: Remove N messages from the start of the user/character conversation.
        
        // Let's use the `onMessageReceived` hook to permanently mark messages as ignored 
        // in the main array, which is safer and cleaner for ST.
    }
};

// --- Event Handlers ---

// Checks if we should summarize or prune
function onNewMessage() {
    if (!settings.enabled) return;
    const ctx = getContext();
    const meta = getMeta();
    const lastIndex = meta.last_index || 0;
    const currentCount = ctx.chat.length;

    // 1. Check Pruning (Token Reduction)
    if (settings.pruning_enabled && lastIndex > 0) {
        const IGNORE = ctx.symbols.ignore; // The magic symbol that hides tokens
        const buffer = settings.pruning_buffer || 4;
        const pruneLimit = lastIndex - buffer; // Keep a few overlap messages

        if (pruneLimit > 0) {
            let pruned = 0;
            for (let i = 0; i < pruneLimit; i++) {
                // If it's not already ignored, ignore it
                if (!ctx.chat[i][IGNORE]) {
                    ctx.chat[i][IGNORE] = true;
                    pruned++;
                }
            }
            if (pruned > 0) log(`Pruned ${pruned} messages to save tokens.`);
        }
    }

    // 2. Check Trigger
    const diff = currentCount - lastIndex;
    if (diff >= settings.threshold) {
        log(`Threshold reached (${diff}/${settings.threshold}). Summarizing.`);
        runSummarization();
    }
    
    updateUI();
}

function setupUI() {
    // Toggles & Inputs
    const bind = (id, key, type='text') => {
        const el = $(`#${id}`);
        if (type === 'check') {
            el.prop('checked', settings[key]);
            el.on('change', () => { settings[key] = el.prop('checked'); saveSettings(); });
        } else {
            el.val(settings[key]);
            el.on('change', () => { settings[key] = (type==='num' ? Number(el.val()) : el.val()); saveSettings(); });
        }
    };

    bind('titan-enabled', 'enabled', 'check');
    bind('titan-pruning', 'pruning_enabled', 'check');
    bind('titan-api', 'api_url');
    bind('titan-key', 'api_key');
    bind('titan-threshold', 'threshold', 'num');
    bind('titan-prompt-template', 'prompt_template');

    // Buttons
    $('#titan-reset-prompt').on('click', () => {
        $('#titan-prompt-template').val(DEFAULT_PROMPT).trigger('change');
    });

    $('#titan-save').on('click', () => {
        setMeta({ summary: $('#titan-memory-text').val() });
        $('#titan-status').text('Memory manually updated.');
    });

    $('#titan-now').on('click', runSummarization);

    $('#titan-wipe').on('click', () => {
        if(confirm("Delete all memory for this character?")) {
            setMeta({ summary: '', last_index: 0 });
            // Un-hide all messages
            const ctx = getContext();
            const IGNORE = ctx.symbols.ignore;
            ctx.chat.forEach(m => delete m[IGNORE]);
            updateUI();
            $('#titan-status').text('Memory wiped and context restored.');
        }
    });
}

function saveSettings() {
    extension_settings[MODULE] = settings;
    saveSettingsDebounced();
}

async function init() {
    // Load Settings
    settings = { ...defaults, ...(extension_settings[MODULE] || {}) };

    // HTML
    const url = new URL(import.meta.url);
    const path = url.pathname.substring(0, url.pathname.lastIndexOf('/'));
    const html = await (await fetch(`${path}/settings.html`)).text();
    $('#extensions_settings2').append(html);

    setupUI();

    // Hooks
    const ctx = getContext();
    ctx.eventSource.on('chat:new-message', onNewMessage);
    ctx.eventSource.on('chat_loaded', () => { updateUI(); onNewMessage(); }); // Run check on load
    
    // Processor (Injection)
    ctx.contextProcessors.push(titanProcessor);

    log('Titan Memory v2 Loaded.');
}

init();
