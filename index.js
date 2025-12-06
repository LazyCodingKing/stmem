import {
    getContext,
    extension_settings,
    saveMetadataDebounced,
    eventSource,
    event_types
} from "../../../extensions.js";
import {
    saveSettingsDebounced,
    generateRaw,
    main_api,
    chat_metadata
} from "../../../../script.js";

const MODULENAME = "titan-memory";
const MODULENAME_FANCY = "Titan Memory";

// --- DEFAULT SETTINGS (Upgraded for Structured Memory) ---
const defaults = {
    enabled: true,
    debug: true,
    show_toasts: false, 
    
    // Summarization / Librarian Mode
    autosummarize: true,
    threshold: 20, // Summarize every 20 messages by default
    maxsummarylength: 1500,
    
    // NEW: Structured Prompt for "Entity Splitter"
    prompttemplate: `[System Note: You are an advanced Memory Manager. 
Analyze the Recent Conversation. 
Identify new facts about Characters, Locations, or Current Goals.
Do NOT write a narrative summary. Break updates into distinct ENTRIES.

OUTPUT FORMAT:
ENTRY: [Topic Name]
KEYWORDS: [comma, separated, tags]
CONTENT: [Concise facts. Use present tense.]

RULES:
1. If a topic exists, merge new info.
2. Ignore trivial chit-chat.
3. Create separate entries for distinct entities.

EXAMPLE:
ENTRY: The Old Mill
KEYWORDS: location, base
CONTENT: Secured by the party. Roof is leaking.

ENTRY: Princess Kael
KEYWORDS: character, ally
CONTENT: Injured left arm. Trusts the player now.]`,

    // Aggressive Pruning
    pruningenabled: true,
    tokenbudget: 1000, 

    // Lorebook
    lorebooksync: true, // Default to TRUE for Entity Splitter
    injectprompt: false, // Default to FALSE to prevent "Double Dip"

    // RAG
    ragenabled: false,
    ragurl: "https://api.openai.com/v1/embeddings",
    ragkey: "",
    ragdepth: 3
};

let isProcessing = false;

// --- LOGGING & TOASTS ---
function log(...args) { console.log(`[${MODULENAME_FANCY}]`, ...args); }
function debug(...args) { if (extension_settings[MODULENAME]?.debug) console.log(`[DEBUG ${MODULENAME_FANCY}]`, ...args); }
function error(...args) { console.error(`[${MODULENAME_FANCY}]`, ...args); toastr.error(args.join(" "), MODULENAME_FANCY); }

function toast(message, type = "info") {
    if (type === "success" && !getSetting("show_toasts")) return;
    if (window.toastr && window.toastr[type]) window.toastr[type](message, MODULENAME_FANCY);
}

// --- SETTINGS HELPERS ---
function getSetting(key) {
    return extension_settings[MODULENAME]?.[key] ?? defaults[key];
}
function setSetting(key, value) {
    if (!extension_settings[MODULENAME]) extension_settings[MODULENAME] = {};
    extension_settings[MODULENAME][key] = value;
    saveSettingsDebounced();
}
function getChatMetadata(key) {
    return chat_metadata[MODULENAME]?.[key];
}
function setChatMetadata(key, value) {
    if (!chat_metadata[MODULENAME]) chat_metadata[MODULENAME] = {};
    chat_metadata[MODULENAME][key] = value;
    saveMetadataDebounced();
}

// --- UI & BUTTONS (ReMemory Feature) ---
function initializeUI() {
    // Watch for new messages to inject buttons
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1 && $(node).hasClass('mes')) {
                    injectTitanButtons($(node));
                }
            });
        });
    });
    
    // Start observing
    const chatContainer = document.querySelector('#chat');
    if (chatContainer) {
        observer.observe(chatContainer, { childList: true, subtree: true });
    }
}

function injectTitanButtons($msg) {
    if ($msg.find('.titan-memory-btn').length > 0) return;

    // The "Brain Button"
    const $btn = $(`<div class="titan-memory-btn fa-solid fa-brain" title="Titan Memory: Force Save this detail"></div>`);
    
    $btn.css({
        'cursor': 'pointer', 'margin-left': '8px', 'opacity': '0.3', 
        'display': 'inline-block', 'transition': 'opacity 0.2s'
    });

    $btn.hover(
        function() { $(this).css('opacity', '1'); },
        function() { $(this).css('opacity', '0.3'); }
    );

    $btn.click(async function(e) {
        e.stopPropagation();
        const messageText = $msg.find('.mes_text').text();
        
        $(this).css('color', '#00ff00').addClass('fa-spin');
        toast("Archiving specific memory...", "info");

        try {
            // Force save to Vector Storage
            await archiveMessageAsVector(messageText);
            // Optional: Also force an entity update if you want
            // await processStructuredMemory(messageText); 
            toast("Memory permanently pinned.", "success");
        } catch (err) {
            toast("Failed to archive.", "error");
            console.error(err);
        } finally {
            $(this).removeClass('fa-spin');
        }
    });

    const $target = $msg.find('.name_text');
    if ($target.length) $target.after($btn);
    else $msg.prepend($btn);
}

// --- SLASH COMMANDS ---
function registerTitanCommands() {
    if (window.SlashCommandParser) {
        window.SlashCommandParser.addCommandObject({
            name: "endscene",
            callback: async () => {
                toast("Closing scene and processing memory...", "info");
                await runSummarization();
                return "Scene closed. Memory banks updated.";
            },
            help: "Force Titan Memory to summarize the current scene immediately."
        });
    }
}

// --- CORE: VECTOR / RAG ---
async function getEmbedding(text) {
    if (!text) return null;
    const context = SillyTavern.getContext();
    const vectorSettings = context.extensionSettings?.vectors;

    // Use global vector settings if available
    if (vectorSettings && vectorSettings.enableFiles) {
         // This is a simplified hook. In a real scenario, you'd match the specific provider logic (OpenAI/Ollama)
         // For now, we fallback to manual logic if using standard OpenAI compatible API
         if (vectorSettings.vectorProvider === 'openai') {
             return await fetchOpenAIEmbedding(text, vectorSettings.api_url, vectorSettings.api_key || context.api_connections?.openai?.key, "text-embedding-3-small");
         }
    }
    
    // Fallback to manual settings
    if (getSetting("ragenabled")) {
        return await fetchOpenAIEmbedding(text, getSetting("ragurl"), getSetting("ragkey"), "text-embedding-3-small");
    }
    return null;
}

async function fetchOpenAIEmbedding(text, url, key, model) {
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
            body: JSON.stringify({ input: text, model: model })
        });
        const data = await response.json();
        return data?.data?.[0]?.embedding || null;
    } catch (e) { console.error(e); return null; }
}

async function archiveMessageAsVector(text) {
    const vector = await getEmbedding(text);
    if (!vector) return;

    let store = getChatMetadata("vector_store") || [];
    store.push({ text: text.substring(0, 500), vector: vector, timestamp: Date.now() });
    setChatMetadata("vector_store", store);
    debug("Archived to Vector Store:", text.substring(0, 20) + "...");
}

async function retrieveRAGContext(query) {
    const vector = await getEmbedding(query);
    if (!vector) return "";

    let store = getChatMetadata("vector_store") || [];
    if (store.length === 0) return "";

    // Cosine Similarity
    const similarity = (a, b) => {
        let dot = 0, magA = 0, magB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i];
        }
        return dot / (Math.sqrt(magA) * Math.sqrt(magB));
    };

    let scored = store.map(item => ({ text: item.text, score: similarity(vector, item.vector) }));
    scored.sort((a, b) => b.score - a.score);
    
    const matches = scored.slice(0, getSetting("ragdepth") || 3).filter(m => m.score > 0.7);
    return matches.map(m => m.text).join("\n");
}

// --- CORE: LOREBOOK (The Librarian) ---
async function updateSpecificLorebookEntry(title, keywords, content) {
    const ctx = SillyTavern.getContext();
    if (!ctx.characterId) return;

    const charName = ctx.characters[ctx.characterId].name;
    const bookName = `Titan Memory - ${charName}`;
    
    // 1. Ensure Book Exists
    let lorebook = ctx.lorebook.lorebooks.find(lb => lb.name === bookName);
    if (!lorebook) {
        lorebook = { name: bookName, entries: [], is_active: true };
        ctx.lorebook.lorebooks.push(lorebook);
        debug("Created new Lorebook:", bookName);
    }

    // 2. Find or Create Entry
    let entry = lorebook.entries.find(e => e.displayName.toLowerCase() === title.toLowerCase());
    
    if (entry) {
        // Merge Logic
        entry.content += `\n${content}`;
        // Update keys if new list is longer
        if (keywords.length > entry.keys.length) entry.keys = keywords.split(',').map(k => k.trim());
        debug(`Updated entry: ${title}`);
    } else {
        // Create Logic
        const newEntry = {
            uid: Date.now(),
            displayName: title,
            keys: keywords.split(',').map(k => k.trim()),
            content: content,
            enabled: true,
            insertion_order: 100,
            case_sensitive: false
        };
        lorebook.entries.push(newEntry);
        debug(`Created entry: ${title}`);
    }
    
    // Save
    ctx.saveLorebook();
}

async function processStructuredMemory(responseText) {
    const entryRegex = /ENTRY:\s*(.*?)\nKEYWORDS:\s*(.*?)\nCONTENT:\s*([\s\S]*?)(?=(?:ENTRY:|$))/gi;
    let match;
    let entriesFound = 0;

    while ((match = entryRegex.exec(responseText)) !== null) {
        const title = match[1].trim();
        const keywords = match[2].trim();
        const content = match[3].trim();

        if (title && content) {
            await updateSpecificLorebookEntry(title, keywords, content);
            entriesFound++;
        }
    }
    return entriesFound;
}

// --- CORE: PRUNING (Budget Aware) ---
async function handlePruning() {
    if (!getSetting("enabled") || !getSetting("pruningenabled")) return;

    const ctx = getContext();
    const chat = ctx.chat;
    if (!chat || chat.length === 0) return;

    // 1. Calculate Summary Cost (approximate)
    // In Entity mode, we can't easily count all Lorebook entries, 
    // so we assume a 'Active Memory Load' reserve of 300 tokens.
    const summaryReserve = 300; 
    
    const maxBudget = getSetting("tokenbudget") || 1000;
    const availableChatBudget = Math.max(200, maxBudget - summaryReserve);

    let currentTokens = 0;
    let prunePoint = -1;

    // 2. Count Backwards
    for (let i = chat.length - 1; i >= 0; i--) {
        const msg = chat[i];
        if (msg.extra && msg.extra.excludefromcontext) continue;

        const tokens = ctx.getTokenCount ? ctx.getTokenCount(msg.mes) : (msg.mes.length / 3.5);
        currentTokens += tokens;

        if (currentTokens > availableChatBudget) {
            prunePoint = i;
            break;
        }
    }

    // 3. Prune
    if (prunePoint > -1) {
        debug(`Budget exceeded. Pruning older than index ${prunePoint}.`);
        for (let i = 0; i <= prunePoint; i++) {
            if (!chat[i].extra) chat[i].extra = {};
            if (!chat[i].extra.excludefromcontext) {
                // Last chance archive
                if (getSetting("ragenabled")) await archiveMessageAsVector(chat[i].mes);
                chat[i].extra.excludefromcontext = true;
            }
        }
    }
}

// --- CORE: SUMMARIZATION ---
async function runSummarization() {
    if (isProcessing) return;
    isProcessing = true;

    const ctx = getContext();
    const chat = ctx.chat;
    const lastIndex = getChatMetadata("last_index") || 0;
    
    // Gather new messages
    const newMessages = chat.slice(lastIndex);
    if (newMessages.length === 0) { isProcessing = false; return; }

    const newLines = newMessages.map(m => `${m.name}: ${m.mes}`).join("\n");

    // Prepare Prompt
    let prompt = getSetting("prompttemplate").replace("{{NEWLINES}}", newLines);

    debug("Running Entity Splitter...");
    toast("Updating Memory Banks...", "info");

    try {
        const result = await generateRaw(prompt, main_api);
        if (!result) throw new Error("Empty response from AI");

        // Parse and Update Lorebook
        const count = await processStructuredMemory(result);

        if (count > 0) {
            toast(`Memory Updated: ${count} entities modified.`, "success");
            setChatMetadata("last_index", chat.length);
        } else {
            debug("AI returned no structured entries.");
        }

    } catch (e) {
        error("Summarization failed:", e);
    } finally {
        isProcessing = false;
        handlePruning();
    }
}

// --- EVENT LISTENERS ---
function onNewMessage() {
    if (!getSetting("enabled")) return;
    const ctx = getContext();
    const chat = ctx.chat;
    const lastIndex = getChatMetadata("last_index") || 0;
    const threshold = getSetting("threshold") || 20;

    if (getSetting("autosummarize") && (chat.length - lastIndex >= threshold)) {
        runSummarization();
    }
    handlePruning();
}

// --- INITIALIZATION ---
jQuery(document).ready(function () {
    const ctx = getContext();
    
    // Hook RAG Injection
    if (ctx.eventSource) {
        ctx.eventSource.on(event_types.GENERATION_STARTED, async () => {
            if (!getSetting("enabled") || !getSetting("ragenabled")) return;
            const chat = ctx.chat;
            const lastMsg = chat[chat.length - 1];
            if (!lastMsg.is_user) return;

            const context = await retrieveRAGContext(lastMsg.mes);
            if (context) {
                const ragText = `\n[Relevant Past Memories:\n${context}\n]`;
                ctx.setExtensionPrompt(MODULENAME + 'rag', ragText, 0, 0, true);
                debug("Injected RAG Context");
            }
        });

        // Hook Messages
        ctx.eventSource.on(event_types.USER_MESSAGE_RENDERED, onNewMessage);
        ctx.eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onNewMessage);
        
        // Hook Scene Load (to reset buttons)
        ctx.eventSource.on(event_types.CHAT_CHANGED, initializeUI);
    }

    // Register Extras
    registerTitanCommands();
    initializeUI(); // Initial run
    
    // Load Settings UI
    loadSettingsHTML();
});

// --- UI LOADING ---
async function loadSettingsHTML() {
    const response = await fetch(`${import.meta.url.substring(0, import.meta.url.lastIndexOf('/'))}/settings.html`);
    const html = await response.text();
    $('#extensions_settings').append(html);

    // Bindings
    bindInput("#titan-enabled", "enabled");
    bindInput("#titan-debug", "debug");
    bindInput("#titan-pruning", "pruningenabled");
    bindInput("#titan-token-budget", "tokenbudget");
    bindInput("#titan-auto-summarize", "autosummarize");
    bindInput("#titan-threshold", "threshold");
    bindInput("#titan-lorebook-sync", "lorebooksync");
    bindInput("#titan-rag-enabled", "ragenabled");
    bindInput("#titan-rag-key", "ragkey");
    bindInput("#titan-prompt-template", "prompttemplate");

    $("#titan-now").click(() => runSummarization());
    $("#titan-save").click(() => toast("Settings Saved", "success"));
    $("#titan-wipe").click(() => {
        if(confirm("Wipe memory?")) {
            setChatMetadata("last_index", 0);
            setChatMetadata("vector_store", []);
            toast("Memory Wiped", "error");
        }
    });
    
    log("Titan Memory (Librarian Edition) Loaded");
}

function bindInput(selector, key) {
    const $el = $(selector);
    const type = $el.attr("type") === "checkbox" ? "checked" : "val";
    const val = getSetting(key);
    if (type === "checked") $el.prop("checked", val); else $el.val(val);

    $el.on("change input", function() {
        const newVal = type === "checked" ? $(this).prop("checked") : $(this).val();
        setSetting(key, newVal);
    });
}
