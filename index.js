import { getContext, extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { saveSettingsDebounced, generateRaw, main_api, chat_metadata } from '../../../../script.js';

const MODULE_NAME = 'titan-memory';
const MODULE_NAME_FANCY = 'Titan Memory';

// Settings defaults
const default_settings = {
    enabled: true,
    threshold: 1,
    show_visuals: true,
    pruning_enabled: true,
    auto_summarize: true,
    debug: true,
    prompt_template: `[System Note: You are an AI managing the long-term memory of a story.]
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

UPDATED MEMORY:`,
    display_memories: true,
    manual_control: false,
    buffer_size: 4,
    max_summary_length: 2000,
};

const global_settings = {
    last_character: null,
};

let settings = {};
let globalSettings = { ...global_settings };
let isProcessing = false;

// --- Logging ---
function log() {
    console.log(`[${MODULE_NAME_FANCY}]`, ...arguments);
}

function debug() {
    if (settings.debug) {
        log("[DEBUG]", ...arguments);
    }
}

function error() {
    console.error(`[${MODULE_NAME_FANCY}]`, ...arguments);
    toastr?.error?.(Array.from(arguments).join(' '), MODULE_NAME_FANCY);
}

function toast(message, type = "info") {
    toastr?.[type]?.(message, MODULE_NAME_FANCY);
}

// --- Settings Management ---
function initialize_settings() {
    if (extension_settings[MODULE_NAME] !== undefined) {
        debug("Settings already initialized.");
        soft_reset_settings();
    } else {
        debug("Initializing fresh settings...");
        hard_reset_settings();
    }
}

function hard_reset_settings() {
    extension_settings[MODULE_NAME] = structuredClone({
        ...default_settings,
        ...global_settings,
    });
}

function soft_reset_settings() {
    extension_settings[MODULE_NAME] = Object.assign(
        structuredClone(default_settings),
        structuredClone(global_settings),
        extension_settings[MODULE_NAME]
    );
}

function set_settings(key, value, copy = false) {
    if (copy) {
        value = structuredClone(value);
    }
    extension_settings[MODULE_NAME][key] = value;
    saveSettingsDebounced();
}

function get_settings(key, copy = false) {
    let value = extension_settings[MODULE_NAME]?.[key] ?? default_settings[key];
    if (copy) {
        return structuredClone(value);
    }
    return value;
}

function set_chat_metadata(key, value, copy = false) {
    if (copy) {
        value = structuredClone(value);
    }
    if (!chat_metadata[MODULE_NAME]) chat_metadata[MODULE_NAME] = {};
    chat_metadata[MODULE_NAME][key] = value;
    saveMetadataDebounced();
}

function get_chat_metadata(key, copy = false) {
    let value = chat_metadata[MODULE_NAME]?.[key];
    if (copy) {
        return structuredClone(value);
    }
    return value;
}

// --- API Detection ---
function isChatCompletionAPI() {
    const chatAPIs = ['openai', 'claude', 'scale', 'openrouter', 'google', 'anthropic', 'mistralai', 'custom', 'cohere'];
    return chatAPIs.includes(main_api);
}

// --- Character/Chat Context ---
function get_current_character_identifier() {
    let context = getContext();
    if (context.groupId) {
        return context.groupId;
    }
    let index = context.characterId;
    if (!index) {
        return null;
    }
    return context.characters[index]?.avatar || null;
}

function is_chat_enabled() {
    return get_chat_metadata('enabled') ?? get_settings('enabled');
}

function toggle_chat_enabled(value = null) {
    let current = is_chat_enabled();
    if (value === null) {
        value = !current;
    } else if (value === current) {
        return;
    }

    set_chat_metadata('enabled', value);
    if (value) {
        toast('Titan Memory enabled for this chat', 'info');
    } else {
        toast('Titan Memory disabled for this chat', 'warning');
    }
    updateUI();
    refresh_memory_injection();
}

// --- Metadata Management ---
function get_chat_memory() {
    const ctx = getContext();
    if (!ctx.characterId) return {};
    
    const char = ctx.characters[ctx.characterId];
    if (!char?.data?.extensions) {
        if (char?.data) char.data.extensions = {};
    }
    if (!char?.data?.extensions[MODULE_NAME]) {
        if (char?.data?.extensions) char.data.extensions[MODULE_NAME] = {};
    }
    return char?.data?.extensions?.[MODULE_NAME] || {};
}

function set_chat_memory(data) {
    const ctx = getContext();
    if (!ctx.characterId) return;

    const char = ctx.characters[ctx.characterId];
    if (!char?.data) return;
    if (!char.data.extensions) char.data.extensions = {};
    if (!char.data.extensions[MODULE_NAME]) char.data.extensions[MODULE_NAME] = {};

    Object.assign(char.data.extensions[MODULE_NAME], data);
    saveMetadataDebounced();
}

// --- Memory History Management ---
function get_memory_history() {
    const memory = get_chat_memory();
    return memory.history || [];
}

function add_to_memory_history(summary, messageCount) {
    const memory = get_chat_memory();
    if (!memory.history) memory.history = [];
    
    memory.history.push({
        summary: summary,
        timestamp: Date.now(),
        messageCount: messageCount,
        id: Date.now() + Math.random()
    });
    
    // Keep only last 50 entries
    if (memory.history.length > 50) {
        memory.history = memory.history.slice(-50);
    }
    
    set_chat_memory(memory);
}

// --- Memory Viewer Interface ---
class MemoryViewerInterface {
    constructor() {
        this.popup = null;
        this.$content = null;
        this.isOpen = false;
    }

    html_template = `
<div id="titan_memory_viewer">
    <div class="flex-container justifyspacebetween alignitemscenter" style="margin-bottom: 15px;">
        <h3 style="margin: 0;">📋 Memory History</h3>
        <button id="viewer-refresh" class="menu_button" title="Refresh">
            <i class="fa-solid fa-refresh"></i>
        </button>
    </div>
    
    <div id="viewer-stats" style="padding: 10px; background: rgba(0,100,255,0.1); border-radius: 5px; margin-bottom: 15px;">
        <div><strong>Current Memory:</strong> <span id="stat-current-size">0</span> characters</div>
        <div><strong>Total Updates:</strong> <span id="stat-total-updates">0</span></div>
        <div><strong>Messages Processed:</strong> <span id="stat-messages-processed">0</span></div>
    </div>

    <hr>

    <div id="viewer-current" style="margin-bottom: 20px;">
        <h4>Current Active Memory</h4>
        <div class="titan-memory-card">
            <div class="memory-card-content" id="current-memory-text">No memory yet</div>
            <div class="memory-card-actions">
                <button class="copy-btn" data-action="copy-current" title="Copy to clipboard">
                    <i class="fa-solid fa-copy"></i>
                </button>
                <button class="edit-btn" data-action="edit-current" title="Edit">
                    <i class="fa-solid fa-edit"></i>
                </button>
            </div>
        </div>
    </div>

    <hr>

    <h4>Memory History (Most Recent First)</h4>
    <div id="viewer-history" style="max-height: 400px; overflow-y: auto;">
        <!-- History entries will be inserted here -->
    </div>
</div>
`;

    async show() {
        const ctx = getContext();
        this.popup = new ctx.Popup(this.html_template, ctx.POPUP_TYPE.TEXT, undefined, {
            wider: true,
            okButton: 'Close'
        });
        
        this.$content = $(this.popup.content);
        this.$content.closest('dialog').css('min-width', '70%');
        
        this.setupEventListeners();
        this.updateContent();
        
        this.isOpen = true;
        await this.popup.show();
        this.isOpen = false;
    }

    setupEventListeners() {
        const self = this;
        
        // Refresh button
        this.$content.find('#viewer-refresh').on('click', () => {
            this.updateContent();
            toast('Memory viewer refreshed', 'info');
        });

        // Copy buttons
        this.$content.on('click', '.copy-btn', function() {
            const action = $(this).data('action');
            const text = $(this).closest('.titan-memory-card').find('.memory-card-content').text();
            navigator.clipboard.writeText(text);
            toast('Copied to clipboard', 'success');
        });

        // Edit current memory
        this.$content.on('click', '[data-action="edit-current"]', function() {
            const $card = $(this).closest('.titan-memory-card');
            const $content = $card.find('.memory-card-content');
            const currentText = $content.text();
            
            const $textarea = $(`<textarea class="titan_textarea" style="width: 100%; min-height: 100px;">${currentText}</textarea>`);
            $content.replaceWith($textarea);
            
            const $saveBtn = $(`<button class="save-edit-btn" style="margin-top: 5px;">Save</button>`);
            $(this).replaceWith($saveBtn);
            
            $saveBtn.on('click', function() {
                const newText = $textarea.val();
                set_chat_memory({ summary: newText, updated_at: Date.now() });
                refresh_memory_injection();
                renderVisuals();
                toast('Memory updated', 'success');
                self.updateContent();
            });
        });

        // Delete history entry
        this.$content.on('click', '.delete-btn', function() {
            const id = $(this).data('id');
            const memory = get_chat_memory();
            if (memory.history) {
                memory.history = memory.history.filter(h => h.id !== id);
                set_chat_memory(memory);
                self.updateContent();
                toast('History entry deleted', 'info');
            }
        });
    }

    updateContent() {
        const memory = get_chat_memory();
        const history = get_memory_history();
        
        // Update stats
        this.$content.find('#stat-current-size').text(memory.summary?.length || 0);
        this.$content.find('#stat-total-updates').text(history.length);
        this.$content.find('#stat-messages-processed').text(memory.last_index || 0);
        
        // Update current memory
        const currentText = memory.summary || 'No memory yet';
        this.$content.find('#current-memory-text').text(currentText);
        
        // Update history
        const $historyContainer = this.$content.find('#viewer-history');
        $historyContainer.empty();
        
        if (history.length === 0) {
            $historyContainer.append('<p style="opacity: 0.6;">No history entries yet</p>');
        } else {
            // Show in reverse order (most recent first)
            const reversedHistory = [...history].reverse();
            reversedHistory.forEach(entry => {
                const date = new Date(entry.timestamp).toLocaleString();
                const $entry = $(`
                    <div class="titan-memory-card" style="margin-bottom: 10px;">
                        <div class="memory-card-header">
                            <span class="memory-card-date">${date}</span>
                            <span class="memory-card-info">(${entry.messageCount} messages)</span>
                        </div>
                        <div class="memory-card-content">${this.escapeHtml(entry.summary)}</div>
                        <div class="memory-card-actions">
                            <button class="copy-btn" title="Copy">
                                <i class="fa-solid fa-copy"></i>
                            </button>
                            <button class="delete-btn" data-id="${entry.id}" title="Delete">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `);
                $historyContainer.append($entry);
            });
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

const memoryViewerInterface = new MemoryViewerInterface();

// --- UI Updates ---
function updateUI() {
    if (!document.querySelector('#titan-settings')) return;

    const memory = get_chat_memory();
    const $memoryText = $('#titan-memory-text');

    if ($memoryText.length && !$memoryText.is(':focus')) {
        $memoryText.val(memory.summary || '');
    }

    const ctx = getContext();
    const lastIndex = memory.last_index || 0;
    const currentCount = ctx.chat?.length || 0;
    const pending = Math.max(0, currentCount - lastIndex);

    const $status = $('#titan-status');
    if ($status.length) {
        if (isProcessing) {
            $status.text(`Status: Processing...`);
        } else {
            $status.text(`Status: Ready. ${pending} new messages pending.`);
        }
    }
}

// --- Visual Rendering ---
function renderVisuals(errorMsg = null) {
    if (!is_chat_enabled() || !get_settings('display_memories')) {
        $('.titan-chat-node').remove();
        return;
    }

    const memory = get_chat_memory();
    const $chat = $('#chat');
    const $lastMsg = $chat.children('.mes').last();

    if ($lastMsg.length === 0) {
        debug('No messages in chat to attach memory to');
        return;
    }

    // Remove existing nodes
    $('.titan-chat-node').remove();

    let html = '';
    if (errorMsg) {
        html = `<div class="titan-chat-node error">
            <div class="titan-chat-header"><i class="fa-solid fa-triangle-exclamation"></i> Memory Error</div>
            <div class="titan-memory-content">${escapeHtml(errorMsg)}</div>
        </div>`;
    } else if (isProcessing) {
        html = `<div class="titan-chat-node">
            <div class="titan-chat-header"><i class="fa-solid fa-spinner fa-spin"></i> Updating Memory...</div>
        </div>`;
    } else if (memory.summary) {
        html = `<div class="titan-chat-node">
            <div class="titan-chat-header"><i class="fa-solid fa-brain"></i> 📝 Memory</div>
            <div class="titan-memory-content">${escapeHtml(memory.summary)}</div>
        </div>`;
        debug('Rendered memory in chat');
    } else {
        debug('No memory to display yet');
        return;
    }

    if (html) {
        const $textBlock = $lastMsg.find('.mes_text');
        if ($textBlock.length) {
            $textBlock.after(html);
            debug('Memory appended to message');
        } else {
            $lastMsg.append(html);
            debug('Memory appended to message container');
        }
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Memory Injection ---
function refresh_memory_injection() {
    const ctx = getContext();
    const memory = get_chat_memory();

    if (!is_chat_enabled() || !memory.summary) {
        ctx.setExtensionPrompt(`${MODULE_NAME}_injection`, '', 0, 0);
        return;
    }

    const injectionText = `[Story Memory]:\n${memory.summary}`;
    debug("Injecting memory into context");
    ctx.setExtensionPrompt(`${MODULE_NAME}_injection`, injectionText, 0, 0, true, 0);
}

// --- Pruning ---
function handle_pruning() {
    if (!is_chat_enabled() || !get_settings('pruning_enabled')) {
        debug('Pruning disabled');
        return;
    }

    const ctx = getContext();
    const memory = get_chat_memory();
    const chat = ctx.chat;

    if (!chat || chat.length === 0) return;

    const lastIndex = memory.last_index || 0;
    const buffer = get_settings('buffer_size');
    const pruneLimit = Math.max(0, lastIndex - buffer);

    if (pruneLimit > 0) {
        debug(`Pruning messages: indices 0-${pruneLimit} will be hidden`);
        
        for (let i = 0; i < Math.min(pruneLimit, chat.length); i++) {
            if (!chat[i].extra) chat[i].extra = {};
            chat[i].extra.exclude_from_context = true;
        }
    }
}

// --- Summarization ---
async function run_summarization() {
    if (isProcessing) {
        debug('Summarization already in progress');
        return;
    }

    const ctx = getContext();
    if (!ctx.characterId) {
        error('No character loaded');
        return;
    }

    if (!is_chat_enabled()) {
        debug('Titan Memory disabled for this chat');
        return;
    }

    const memory = get_chat_memory();
    const chat = ctx.chat || [];
    const lastIndex = memory.last_index || 0;

    if (lastIndex >= chat.length) {
        debug('No new messages to summarize');
        return;
    }

    isProcessing = true;
    renderVisuals();
    updateUI();

    try {
        const newMessages = chat.slice(lastIndex);
        const newLines = newMessages
            .map(m => `${m.name}: ${m.mes}`)
            .join('\n');

        const existingMemory = memory.summary || "No history yet.";

        let promptText = get_settings('prompt_template');
        promptText = promptText.replace('{{EXISTING}}', existingMemory);
        promptText = promptText.replace('{{NEW_LINES}}', newLines);

        let apiPrompt;
        if (isChatCompletionAPI()) {
            debug(`Using Chat Completion (API: ${main_api})`);
            apiPrompt = [{ role: 'user', content: promptText }];
        } else {
            debug(`Using Text Completion (API: ${main_api})`);
            apiPrompt = promptText;
        }

        debug(`Generating summary for ${newMessages.length} new messages`);

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('API call timeout (30s)')), 30000)
        );

        const result = await Promise.race([
            generateRaw({
                prompt: apiPrompt,
                trimNames: false,
            }),
            timeoutPromise
        ]);

        if (!result || typeof result !== 'string') {
            throw new Error("API returned invalid response");
        }

        let cleanResult = result.trim()
            .replace(/^UPDATED MEMORY:\s*/i, '')
            .replace(/^["']|["']$/g, '')
            .trim();

        if (!cleanResult) {
            throw new Error("Generated summary was empty");
        }

        const maxLen = get_settings('max_summary_length');
        if (cleanResult.length > maxLen) {
            cleanResult = cleanResult.substring(0, maxLen) + "...";
        }

        debug(`Summary generated: ${cleanResult.length} characters`);

        // Add to history before updating
        add_to_memory_history(cleanResult, chat.length);

        set_chat_memory({
            summary: cleanResult,
            last_index: chat.length,
            updated_at: Date.now(),
        });

        updateUI();
        refresh_memory_injection();
        handle_pruning();
        renderVisuals();
        toast('Memory updated successfully', 'success');

    } catch (e) {
        error(`Summarization failed: ${e.message}`);
        toast(`Summarization failed: ${e.message}`, 'error');
        renderVisuals(`Failed: ${e.message}`);
    } finally {
        isProcessing = false;
        updateUI();
    }
}

// --- Event Handlers ---
function on_new_message() {
    debug('on_new_message triggered');
    
    if (!is_chat_enabled()) {
        debug('Chat memory not enabled, skipping');
        return;
    }
    
    if (!get_settings('auto_summarize')) {
        debug('Auto-summarize disabled, skipping');
        return;
    }

    const ctx = getContext();
    if (!ctx.chat || ctx.chat.length === 0) {
        debug('No chat or empty chat');
        return;
    }

    const memory = get_chat_memory();
    const lastIndex = memory.last_index || 0;
    const currentCount = ctx.chat.length;
    const diff = currentCount - lastIndex;

    debug(`New message detected. Last: ${lastIndex}, Current: ${currentCount}, Diff: ${diff}, Threshold: ${get_settings('threshold')}`);

    if (diff >= get_settings('threshold')) {
        debug('Threshold reached, triggering summarization');
        run_summarization();
    } else {
        debug(`Not at threshold yet (${diff}/${get_settings('threshold')})`);
        refresh_memory_injection();
        requestAnimationFrame(() => renderVisuals());
    }
    updateUI();
}

function on_chat_changed() {
    debug('Chat changed');
    updateUI();
    refresh_memory_injection();
    handle_pruning();
    requestAnimationFrame(() => renderVisuals());
}

// --- UI Setup ---
function setup_ui() {
    const bind_setting = (id, key, type = 'text', callback = null) => {
        const $el = $(`#${id}`);
        if (!$el.length) {
            debug(`UI element #${id} not found`);
            return;
        }

        if (type === 'check') {
            $el.prop('checked', get_settings(key));
            $el.on('change', () => {
                set_settings(key, $el.prop('checked'));
                refresh_memory_injection();
                renderVisuals();
                if (callback) callback();
            });
        } else if (type === 'num') {
            $el.val(get_settings(key));
            $el.on('change', () => {
                set_settings(key, Number($el.val()));
                if (callback) callback();
            });
        } else {
            $el.val(get_settings(key));
            $el.on('change', () => {
                set_settings(key, $el.val());
                if (callback) callback();
            });
        }
    };

    bind_setting('titan-enabled', 'enabled', 'check');
    bind_setting('titan-display-memories', 'display_memories', 'check', () => renderVisuals());
    bind_setting('titan-auto-summarize', 'auto_summarize', 'check');
    bind_setting('titan-pruning', 'pruning_enabled', 'check');
    bind_setting('titan-show-visuals', 'show_visuals', 'check');
    bind_setting('titan-threshold', 'threshold', 'num');
    bind_setting('titan-buffer-size', 'buffer_size', 'num');
    bind_setting('titan-max-length', 'max_summary_length', 'num');
    bind_setting('titan-debug', 'debug', 'check');
    bind_setting('titan-prompt-template', 'prompt_template');

    $('#titan-reset-prompt').on('click', () => {
        set_settings('prompt_template', default_settings.prompt_template);
        $('#titan-prompt-template').val(default_settings.prompt_template);
        toast('Prompt reset to default', 'info');
    });

    $('#titan-toggle-chat').on('click', () => {
        toggle_chat_enabled();
    });

    $('#titan-save').on('click', () => {
        const newSummary = $('#titan-memory-text').val();
        set_chat_memory({
            summary: newSummary,
            updated_at: Date.now(),
        });
        refresh_memory_injection();
        renderVisuals();
        toast('Memory saved manually', 'success');
    });

    $('#titan-now').on('click', () => {
        debug('Manual summarization triggered');
        run_summarization();
    });

    $('#titan-wipe').on('click', () => {
        if (confirm("Delete all memory for this character? This cannot be undone.")) {
            set_chat_memory({
                summary: '',
                last_index: 0,
                updated_at: Date.now(),
                history: []
            });
            refresh_memory_injection();
            renderVisuals();
            updateUI();
            toast('Memory wiped', 'info');
        }
    });

    // NEW: View Memory History button
    $('#titan-view-history').on('click', () => {
        memoryViewerInterface.show();
    });

    debug('UI setup complete');
}

async function load_settings_html() {
    try {
        const extensionDir = new URL(import.meta.url).pathname;
        const extensionPath = extensionDir.substring(0, extensionDir.lastIndexOf('/'));
        const settingsPath = `${extensionPath}/settings.html`;
        
        const response = await fetch(settingsPath);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        $('#extensions_settings2').append(html);
        setup_ui();
        log('Settings UI loaded');
    } catch (e) {
        error(`Failed to load settings.html: ${e.message}`);
    }
}

// --- MAIN ENTRY POINT ---
jQuery(async function () {
    log(`Loading extension...`);

    initialize_settings();
    settings = structuredClone(extension_settings[MODULE_NAME]);

    await load_settings_html();

    const ctx = getContext();
    const eventTypes = ctx.eventTypes || ctx.event_types;

    log('Registering event listeners...');
    
    ctx.eventSource.on(eventTypes.USER_MESSAGE_RENDERED, () => {
        debug('USER_MESSAGE_RENDERED fired');
        on_new_message();
    });
    
    ctx.eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, () => {
        debug('CHARACTER_MESSAGE_RENDERED fired');
        on_new_message();
    });
    
    ctx.eventSource.on(eventTypes.CHAT_CHANGED, () => {
        debug('CHAT_CHANGED fired');
        on_chat_changed();
    });
    
    ctx.eventSource.on(eventTypes.GENERATION_STARTED, () => {
        debug('GENERATION_STARTED fired');
        handle_pruning();
    });

    if (ctx.chat && ctx.chat.length > 0) {
        requestAnimationFrame(() => {
            updateUI();
            refresh_memory_injection();
            renderVisuals();
        });
    }

    log(`Extension loaded successfully`);
});

globalThis.titan_memory_intercept = function (chat, _contextSize, _abort, type) {
    if (!is_chat_enabled() || !get_settings('pruning_enabled')) {
        return;
    }

    const memory = get_chat_memory();
    const lastIndex = memory.last_index || 0;
    const buffer = get_settings('buffer_size');
    const pruneLimit = Math.max(0, lastIndex - buffer);

    if (pruneLimit <= 0) return;

    let start = chat.length - 1;
    if (type === 'continue') start--;

    for (let i = 0; i < Math.min(pruneLimit, chat.length); i++) {
        if (!chat[i].extra) chat[i].extra = {};
        
        const IGNORE_SYMBOL = getContext().symbols?.ignore;
        if (IGNORE_SYMBOL) {
            chat[i].extra[IGNORE_SYMBOL] = true;
        }
    }
};
