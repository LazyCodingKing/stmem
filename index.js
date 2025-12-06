import { getContext, extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const MODULE_NAME = 'memory-summarize';

const default_settings = {
  enabled: true,
  auto_summarize: true,
  summary_length: 'medium',
  max_history: 50,
  update_interval: 5,
  api_endpoint: 'http://127.0.0.1:5000/api/v1/generate',
  api_key: '',
  debug: false,
};

let settings = {};
let memory_buffer = [];

// --- Logging ---
function log(message) { console.log(`[${MODULE_NAME}]`, message); }
function debug(message, ...args) { if (settings.debug) { console.log(`[${MODULE_NAME} DEBUG]`, message, ...args); } }
function error(message) { console.error(`[${MODULE_NAME}]`, message); }

// --- UI Update Functions ---
function update_status(message, isError = false) {
  const statusEl = $('#ms-status-text');
  statusEl.text(message);
  statusEl.closest('.status-display').toggleClass('error', isError);
}

function update_display() {
  const context = getContext();
  if (!context || !context.character) return;
  
  const metadata = context.character.metadata?.[MODULE_NAME] || {};
  $('#ms-buffer-count').text(`${memory_buffer.length} messages`);
  
  if (metadata.last_summary_time) {
    $('#ms-last-summary').text(new Date(metadata.last_summary_time).toLocaleTimeString());
  } else {
    $('#ms-last-summary').text('Never');
  }
}

// --- Core Logic ---
function save_settings() {
  extension_settings[MODULE_NAME] = settings;
  saveSettingsDebounced();
}

async function summarize_memory() {
  if (memory_buffer.length === 0) {
    log('No content in buffer to summarize.');
    return;
  }
  if (!settings.api_endpoint) {
    update_status('API Endpoint is not configured.', true);
    return error('Cannot summarize: API endpoint is missing.');
  }

  update_status('Summarizing...');
  debug(`Summarizing ${memory_buffer.length} messages.`);

  const conversation = memory_buffer.map(msg => `${msg.speaker}: ${msg.text}`).join('\n');
  const length_map = { short: 'around 100 words', medium: 'around 200 words', long: 'around 300 words' };
  const prompt = `Human: Summarize the following conversation in the third person. The summary should be a concise narrative, capturing the key events, character actions, and emotional tone. The summary should be ${length_map[settings.summary_length]}.\n\nCONVERSATION:\n${conversation}\n\nAssistant: Here is a summary of the conversation:\n`;

  try {
    const response = await fetch(settings.api_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': settings.api_key ? `Bearer ${settings.api_key}` : undefined },
      body: JSON.stringify({ prompt, max_new_tokens: 400, temperature: 0.7, top_p: 0.9, stop: ['Human:', 'Assistant:'] }),
    });

    if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
    const data = await response.json();
    const summary = data.results?.[0]?.text?.trim();
    if (!summary) throw new Error('API response did not contain a valid summary.');

    const context = getContext();
    if (!context.character.metadata[MODULE_NAME]) context.character.metadata[MODULE_NAME] = {};
    context.character.metadata[MODULE_NAME].summary = summary;
    context.character.metadata[MODULE_NAME].last_summary_time = Date.now();
    saveMetadataDebounced();

    log('Summary generated and saved to character metadata.');
    debug('Summary:', summary);
    update_status('Summary complete!');
    memory_buffer = [];
    update_display();
  } catch (err) {
    error(`Summarization failed: ${err.message}`);
    update_status(`Error: ${err.message}`, true);
  }
}

// --- Event Handlers ---
function onNewMessage(data) {
  if (!settings.enabled || !data.mes || data.is_system) return;
  memory_buffer.push({ timestamp: Date.now(), text: data.mes, speaker: data.name || 'Unknown' });
  update_display();

  if (settings.auto_summarize && memory_buffer.length >= settings.max_history) {
    const metadata = getContext().character.metadata?.[MODULE_NAME] || {};
    const lastTime = metadata.last_summary_time || 0;
    if ((Date.now() - lastTime) / 60000 >= settings.update_interval) {
      log('Auto-summarize triggered by buffer size and interval.');
      summarize_memory();
    }
  }
}

function add_summary_to_context(context, text) {
  if (!settings.enabled) return text;
  const summary = context.character?.metadata?.[MODULE_NAME]?.summary;
  if (summary) {
    debug('Injecting summary into context.');
    return `[This is a summary of the conversation so far:\n${summary}\n]\n${text}`;
  }
  return text;
}

// --- Setup ---
function setup_settings_ui() {
  const panel = $('#memory-summarize-settings');
  panel.on('change', '#ms-enabled', function() { settings.enabled = this.checked; save_settings(); });
  panel.on('change', '#ms-auto-summarize', function() { settings.auto_summarize = this.checked; save_settings(); });
  panel.on('change', '#ms-length', function() { settings.summary_length = $(this).val(); save_settings(); });
  panel.on('input', '#ms-max-history', function() { settings.max_history = Number($(this).val()); save_settings(); });
  panel.on('input', '#ms-update-interval', function() { settings.update_interval = Number($(this).val()); save_settings(); });
  panel.on('input', '#ms-api-endpoint', function() { settings.api_endpoint = $(this).val().trim(); save_settings(); });
  panel.on('input', '#ms-api-key', function() { settings.api_key = $(this).val().trim(); save_settings(); });
  panel.on('change', '#ms-debug', function() { settings.debug = this.checked; save_settings(); });
  panel.on('click', '#ms-summarize-btn', async function() { $(this).prop('disabled', true); await summarize_memory(); $(this).prop('disabled', false); });
  panel.on('click', '#ms-reset-btn', function() { memory_buffer = []; update_status('Memory buffer has been reset.'); update_display(); });

  // Set initial values
  panel.find('#ms-enabled').prop('checked', settings.enabled);
  panel.find('#ms-auto-summarize').prop('checked', settings.auto_summarize);
  panel.find('#ms-length').val(settings.summary_length);
  panel.find('#ms-max-history').val(settings.max_history);
  panel.find('#ms-update-interval').val(settings.update_interval);
  panel.find('#ms-api-endpoint').val(settings.api_endpoint);
  panel.find('#ms-api-key').val(settings.api_key);
  panel.find('#ms-debug').prop('checked', settings.debug);
  update_status('Ready');
}

async function setup() {
  try {
    const loaded_settings = extension_settings[MODULE_NAME] || {};
    settings = { ...default_settings, ...loaded_settings };
    const context = getContext();
    
    const url = new URL(import.meta.url);
    const settings_path = `${url.pathname.substring(0, url.pathname.lastIndexOf('/'))}/settings.html`;
    const response = await fetch(settings_path);
    if (!response.ok) return error(`Failed to load settings.html: ${response.status}`);
    
    $('#extensions_settings2').append(await response.text());
    setup_settings_ui();

    context.eventSource.on('chat:new-message', onNewMessage);
    context.eventSource.on('chat_loaded', update_display);
    
    // *** THE FIX: The correct method is context.contextProcessors.push ***
    context.contextProcessors.push(add_summary_to_context);

    log('Extension setup complete.');
  } catch (err) {
    error(`Setup failed: ${err.message}`);
  }
}

setup();
