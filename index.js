import { 
    saveSettingsDebounced, 
    Generate, 
    eventSource, 
    event_types, 
    getRequestHeaders,
    substituteParams,
    callGenericPopup,
    Popup
} from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================
const extensionName = 'memory-summarize';
const summaryDivClass = 'qvink_memory_text';

// Inject CSS dynamically (modern approach with CSS custom properties)
const styles = `
    .qvink_memory_text {
        font-size: 0.85em;
        margin-top: 5px;
        padding: 5px 10px;
        border-radius: 5px;
        background-color: var(--black50a, rgba(0, 0, 0, 0.2));
        border-left: 3px solid var(--SmartThemeBodyColor, #22c55e);
        font-style: italic;
        color: var(--SmartThemeBodyColor, #e0e0e0);
        opacity: 0.9;
        cursor: pointer;
        transition: all 0.2s ease-in-out;
    }
    .qvink_memory_text:hover {
        background-color: var(--black70a, rgba(0, 0, 0, 0.4));
        opacity: 1;
    }
    .qvink_memory_loading {
        opacity: 0.5;
        animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
        0%, 100% { opacity: 0.5; }
        50% { opacity: 0.8; }
    }
`;

// Append styles to head
if (!document.getElementById('memory-summarize-styles')) {
    const styleSheet = document.createElement('style');
    styleSheet.id = 'memory-summarize-styles';
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
}

const defaultSettings = {
    enabled: true,
    autoSummarize: true,

    // Thresholds
    messageThreshold: 20,
    messageLag: 0,

    // Prompting - Improved with better instructions
    summaryPrompt: `Summarize the following message concisely in past tense. Focus on key events, information, and character actions. Do not include any preamble, commentary, or "Summary:" prefix. Output only the summary itself.\n\nMessage to summarize:\n{{message}}`,

    // Display options
    displayMemories: true,
    showInlineMemories: true,

    // Injection settings
    includeUserMessages: false,
    includeSystemMessages: false,
    includeCharacterMessages: true,

    // Injection template with better formatting
    memoryTemplate: `[Previous conversation summary]:\n{{memories}}\n`,

    // Advanced settings
    maxSummaryLength: 200,
    batchSummarize: false,
    debugMode: false
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get extension settings with fallback to defaults
 */
function getSettings(key) {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = { ...defaultSettings };
    }
    return extension_settings[extensionName]?.[key] ?? defaultSettings[key];
}

/**
 * Set extension settings and save
 */
function setSettings(key, value) {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = { ...defaultSettings };
    }
    extension_settings[extensionName][key] = value;
    saveSettingsDebounced();
}

/**
 * Debug logging utility
 */
function log(msg, ...args) {
    if (getSettings('debugMode')) {
        console.log(`[${extensionName}] ${msg}`, ...args);
    }
}

/**
 * Error logging utility
 */
function logError(msg, error) {
    console.error(`[${extensionName}] ${msg}`, error);
}

// ============================================================================
// CORE LOGIC: VISUALS
// ============================================================================

/**
 * Update message visuals with summary display
 */
function updateMessageVisuals(index) {
    if (!getSettings('displayMemories') || !getSettings('showInlineMemories')) {
        return;
    }

    const context = getContext();
    if (!context.chat || !context.chat[index]) {
        return;
    }

    const mesElement = $(`#chat .mes[mesid="${index}"]`);
    if (mesElement.length === 0) {
        return;
    }

    // Remove existing summary display
    mesElement.find(`.${summaryDivClass}`).remove();

    const message = context.chat[index];
    const summary = message.extensions?.[extensionName]?.summary;

    if (summary) {
        const messageTextDiv = mesElement.find('.mes_text');
        const summaryHtml = `
            <div class="${summaryDivClass}" data-message-id="${index}" title="Click to edit summary">
                <i class="fa-solid fa-brain fa-sm"></i> ${summary}
            </div>
        `;
        messageTextDiv.after(summaryHtml);

        // Add click handler for editing
        mesElement.find(`.${summaryDivClass}`).on('click', () => editSummary(index));
    }
}

/**
 * Update visuals for all messages in chat
 */
function updateAllMessageVisuals() {
    const context = getContext();
    if (!context.chat) return;

    context.chat.forEach((_, index) => {
        updateMessageVisuals(index);
    });
}

// ============================================================================
// CORE LOGIC: SUMMARIZATION
// ============================================================================

/**
 * Generate summary for a message
 */
async function generateSummary(message, messageIndex) {
    if (!getSettings('enabled')) {
        return null;
    }

    try {
        log('Generating summary for message:', messageIndex);

        const prompt = getSettings('summaryPrompt').replace('{{message}}', message.mes || '');

        // Use modern Generate API
        const summary = await Generate(prompt, {
            max_length: getSettings('maxSummaryLength'),
            temperature: 0.7,
            top_p: 0.9,
        });

        if (!summary || summary.trim().length === 0) {
            logError('Generated summary is empty');
            return null;
        }

        log('Generated summary:', summary);
        return summary.trim();

    } catch (error) {
        logError('Failed to generate summary', error);
        toastr.error(`Failed to generate summary: ${error.message}`, 'Memory Summarize');
        return null;
    }
}

/**
 * Save summary to message
 */
async function saveSummary(messageIndex, summary) {
    const context = getContext();
    if (!context.chat || !context.chat[messageIndex]) {
        return;
    }

    const message = context.chat[messageIndex];

    if (!message.extensions) {
        message.extensions = {};
    }
    if (!message.extensions[extensionName]) {
        message.extensions[extensionName] = {};
    }

    message.extensions[extensionName].summary = summary;
    message.extensions[extensionName].timestamp = Date.now();

    await context.saveChat();
    updateMessageVisuals(messageIndex);

    log('Saved summary for message', messageIndex);
}

/**
 * Summarize a specific message
 */
async function summarizeMessage(messageIndex) {
    const context = getContext();
    if (!context.chat || !context.chat[messageIndex]) {
        return;
    }

    const message = context.chat[messageIndex];

    // Check if message should be summarized
    if (!shouldSummarizeMessage(message)) {
        return;
    }

    // Show loading indicator
    const mesElement = $(`#chat .mes[mesid="${messageIndex}"]`);
    const existingSummary = mesElement.find(`.${summaryDivClass}`);
    if (existingSummary.length > 0) {
        existingSummary.addClass('qvink_memory_loading');
    }

    try {
        const summary = await generateSummary(message, messageIndex);
        if (summary) {
            await saveSummary(messageIndex, summary);
            toastr.success('Summary generated successfully', 'Memory Summarize');
        }
    } finally {
        existingSummary.removeClass('qvink_memory_loading');
    }
}

/**
 * Check if message should be summarized based on settings
 */
function shouldSummarizeMessage(message) {
    const includeUser = getSettings('includeUserMessages');
    const includeSystem = getSettings('includeSystemMessages');
    const includeCharacter = getSettings('includeCharacterMessages');

    if (message.is_user && !includeUser) return false;
    if (message.is_system && !includeSystem) return false;
    if (!message.is_user && !message.is_system && !includeCharacter) return false;

    return true;
}

/**
 * Auto-summarize recent messages based on threshold
 */
async function autoSummarize() {
    if (!getSettings('enabled') || !getSettings('autoSummarize')) {
        return;
    }

    const context = getContext();
    if (!context.chat || context.chat.length === 0) {
        return;
    }

    const threshold = getSettings('messageThreshold');
    const lag = getSettings('messageLag');

    // Check if we should trigger auto-summarize
    if (context.chat.length < threshold) {
        return;
    }

    // Summarize messages that don't have summaries yet
    const messagesToSummarize = context.chat
        .map((msg, idx) => ({ msg, idx }))
        .filter(({ msg, idx }) => 
            !msg.extensions?.[extensionName]?.summary && 
            shouldSummarizeMessage(msg) &&
            idx < context.chat.length - lag
        );

    if (messagesToSummarize.length === 0) {
        return;
    }

    log(`Auto-summarizing ${messagesToSummarize.length} messages`);

    if (getSettings('batchSummarize')) {
        // Batch processing
        for (const { idx } of messagesToSummarize) {
            await summarizeMessage(idx);
        }
    } else {
        // Summarize only the oldest unsummarized message
        await summarizeMessage(messagesToSummarize[0].idx);
    }
}

/**
 * Edit summary interactively
 */
async function editSummary(messageIndex) {
    const context = getContext();
    const message = context.chat[messageIndex];
    const currentSummary = message.extensions?.[extensionName]?.summary || '';

    const newSummary = await callGenericPopup(
        'Edit summary for this message:',
        Popup.TYPES.INPUT,
        currentSummary,
        { 
            wide: true, 
            large: true,
            okButton: 'Save',
            cancelButton: 'Cancel'
        }
    );

    if (newSummary !== false && newSummary !== null) {
        await saveSummary(messageIndex, newSummary);
        toastr.success('Summary updated', 'Memory Summarize');
    }
}

/**
 * Delete summary from message
 */
async function deleteSummary(messageIndex) {
    const context = getContext();
    const message = context.chat[messageIndex];

    if (message.extensions?.[extensionName]) {
        delete message.extensions[extensionName].summary;
        await context.saveChat();
        updateMessageVisuals(messageIndex);
        toastr.info('Summary deleted', 'Memory Summarize');
    }
}

// ============================================================================
// PROMPT INJECTION
// ============================================================================

/**
 * Get all summaries for context injection
 */
function getAllSummaries() {
    const context = getContext();
    if (!context.chat) return [];

    return context.chat
        .map((msg, idx) => ({
            index: idx,
            summary: msg.extensions?.[extensionName]?.summary,
            timestamp: msg.extensions?.[extensionName]?.timestamp
        }))
        .filter(item => item.summary);
}

/**
 * Build memory injection string
 */
function buildMemoryInjection() {
    if (!getSettings('enabled')) {
        return '';
    }

    const summaries = getAllSummaries();
    if (summaries.length === 0) {
        return '';
    }

    const lag = getSettings('messageLag');
    const context = getContext();
    const maxIndex = context.chat.length - lag - 1;

    // Filter summaries based on lag setting
    const relevantSummaries = summaries
        .filter(item => item.index <= maxIndex)
        .map(item => item.summary)
        .join('\n');

    if (!relevantSummaries) {
        return '';
    }

    const template = getSettings('memoryTemplate');
    return template.replace('{{memories}}', relevantSummaries);
}

/**
 * Inject memories into prompt
 */
function injectMemories(chat) {
    const injection = buildMemoryInjection();

    if (injection) {
        log('Injecting memories into prompt');
        // Add as a system message-like injection
        return [
            { role: 'system', content: injection },
            ...chat
        ];
    }

    return chat;
}

// ============================================================================
// UI INTEGRATION
// ============================================================================

/**
 * Add message action buttons
 */
function addMessageButtons() {
    $(document).on('click', '.mes', function() {
        const messageId = $(this).attr('mesid');
        if (!messageId) return;

        const existingButton = $(this).find('.qvink_summarize_button');
        if (existingButton.length > 0) return;

        const context = getContext();
        const message = context.chat[parseInt(messageId)];
        if (!message) return;

        const hasSummary = message.extensions?.[extensionName]?.summary;
        const extraButtons = $(this).find('.extraMesButtons');

        if (extraButtons.length > 0) {
            const buttonHtml = `
                <div class="extraMesButton qvink_summarize_button" title="${hasSummary ? 'Edit summary' : 'Generate summary'}">
                    <i class="fa-solid fa-brain"></i>
                </div>
            `;

            extraButtons.prepend(buttonHtml);

            $(this).find('.qvink_summarize_button').on('click', async (e) => {
                e.stopPropagation();
                const idx = parseInt($(e.target).closest('.mes').attr('mesid'));
                await summarizeMessage(idx);
            });
        }
    });
}

/**
 * Load settings HTML
 */
async function loadSettingsHTML() {
    const settingsHtml = await $.get(`scripts/extensions/third-party/${extensionName}/settings.html`);
    $('#extensions_settings2').append(settingsHtml);

    // Bind settings controls
    bindSettingsControls();
}

/**
 * Bind settings UI controls
 */
function bindSettingsControls() {
    // Enable/disable toggle
    $('#memory_summarize_enabled').prop('checked', getSettings('enabled')).on('change', function() {
        setSettings('enabled', $(this).prop('checked'));
    });

    // Auto-summarize toggle
    $('#memory_summarize_auto').prop('checked', getSettings('autoSummarize')).on('change', function() {
        setSettings('autoSummarize', $(this).prop('checked'));
    });

    // Message threshold
    $('#memory_summarize_threshold').val(getSettings('messageThreshold')).on('input', function() {
        setSettings('messageThreshold', parseInt($(this).val()));
    });

    // Message lag
    $('#memory_summarize_lag').val(getSettings('messageLag')).on('input', function() {
        setSettings('messageLag', parseInt($(this).val()));
    });

    // Summary prompt
    $('#memory_summarize_prompt').val(getSettings('summaryPrompt')).on('input', function() {
        setSettings('summaryPrompt', $(this).val());
    });

    // Display memories toggle
    $('#memory_summarize_display').prop('checked', getSettings('displayMemories')).on('change', function() {
        setSettings('displayMemories', $(this).prop('checked'));
        updateAllMessageVisuals();
    });

    // Message type toggles
    $('#memory_summarize_include_user').prop('checked', getSettings('includeUserMessages')).on('change', function() {
        setSettings('includeUserMessages', $(this).prop('checked'));
    });

    $('#memory_summarize_include_character').prop('checked', getSettings('includeCharacterMessages')).on('change', function() {
        setSettings('includeCharacterMessages', $(this).prop('checked'));
    });

    $('#memory_summarize_include_system').prop('checked', getSettings('includeSystemMessages')).on('change', function() {
        setSettings('includeSystemMessages', $(this).prop('checked'));
    });

    // Memory template
    $('#memory_summarize_template').val(getSettings('memoryTemplate')).on('input', function() {
        setSettings('memoryTemplate', $(this).val());
    });

    // Debug mode
    $('#memory_summarize_debug').prop('checked', getSettings('debugMode')).on('change', function() {
        setSettings('debugMode', $(this).prop('checked'));
    });

    // Batch summarize
    $('#memory_summarize_batch').prop('checked', getSettings('batchSummarize')).on('change', function() {
        setSettings('batchSummarize', $(this).prop('checked'));
    });

    // Bulk actions
    $('#memory_summarize_all').on('click', async function() {
        const context = getContext();
        if (!context.chat) return;

        const confirmed = await callGenericPopup(
            `Summarize all ${context.chat.length} messages? This may take a while.`,
            Popup.TYPES.CONFIRM
        );

        if (confirmed) {
            for (let i = 0; i < context.chat.length; i++) {
                await summarizeMessage(i);
            }
            toastr.success('All messages summarized', 'Memory Summarize');
        }
    });

    $('#memory_summarize_clear_all').on('click', async function() {
        const confirmed = await callGenericPopup(
            'Delete all summaries? This cannot be undone.',
            Popup.TYPES.CONFIRM
        );

        if (confirmed) {
            const context = getContext();
            context.chat.forEach(msg => {
                if (msg.extensions?.[extensionName]) {
                    delete msg.extensions[extensionName];
                }
            });
            await context.saveChat();
            updateAllMessageVisuals();
            toastr.success('All summaries cleared', 'Memory Summarize');
        }
    });
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle message events
 */
function setupEventHandlers() {
    // When a new message is received
    eventSource.on(event_types.MESSAGE_RECEIVED, async (messageIndex) => {
        log('Message received:', messageIndex);
        updateMessageVisuals(messageIndex);
        await autoSummarize();
    });

    // When a message is sent
    eventSource.on(event_types.MESSAGE_SENT, async (messageIndex) => {
        log('Message sent:', messageIndex);
        updateMessageVisuals(messageIndex);
        await autoSummarize();
    });

    // When chat is loaded
    eventSource.on(event_types.CHAT_CHANGED, () => {
        log('Chat changed');
        updateAllMessageVisuals();
    });

    // When a message is edited
    eventSource.on(event_types.MESSAGE_EDITED, (messageIndex) => {
        log('Message edited:', messageIndex);
        updateMessageVisuals(messageIndex);
    });

    // When a message is deleted
    eventSource.on(event_types.MESSAGE_DELETED, (messageIndex) => {
        log('Message deleted:', messageIndex);
    });

    // Inject memories before generation
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (data) => {
        if (getSettings('enabled')) {
            const injection = buildMemoryInjection();
            if (injection) {
                // Add to system prompt or as a separate message
                data.messages = injectMemories(data.messages);
                log('Injected memories into prompt');
            }
        }
    });
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the extension
 */
jQuery(async () => {
    try {
        log('Initializing Memory Summarize extension');

        // Initialize settings
        if (!extension_settings[extensionName]) {
            extension_settings[extensionName] = { ...defaultSettings };
        }

        // Load settings UI
        try {
            await loadSettingsHTML();
        } catch (error) {
            logError('Failed to load settings HTML', error);
        }

        // Setup event handlers
        setupEventHandlers();

        // Add message buttons
        addMessageButtons();

        // Initial visual update
        updateAllMessageVisuals();

        // Add slash command
        if (window.registerSlashCommand) {
            window.registerSlashCommand('summarize', async (args) => {
                const messageIndex = parseInt(args.trim());
                if (isNaN(messageIndex)) {
                    toastr.error('Usage: /summarize <message_index>', 'Memory Summarize');
                    return;
                }
                await summarizeMessage(messageIndex);
            }, [], 'Summarize a specific message by index');

            window.registerSlashCommand('summarize-all', async () => {
                const context = getContext();
                if (!context.chat) return;

                for (let i = 0; i < context.chat.length; i++) {
                    await summarizeMessage(i);
                }
                toastr.success('All messages summarized', 'Memory Summarize');
            }, [], 'Summarize all messages in the current chat');
        }

        log('Memory Summarize extension initialized successfully');
        console.log(`[${extensionName}] Loaded successfully v2.0.0`);

    } catch (error) {
        logError('Failed to initialize extension', error);
        toastr.error('Failed to load Memory Summarize extension', 'Error');
    }
});

// Export for external access
export {
    summarizeMessage,
    deleteSummary,
    editSummary,
    getAllSummaries,
    buildMemoryInjection
};
