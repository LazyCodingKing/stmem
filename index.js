import {
    getContext,
    extension_settings,
    saveMetadataDebounced
} from "../../../extensions.js";
import {
    saveSettingsDebounced,
    generateRaw,
    main_api,
    chat_metadata
} from "../../../../script.js";

const MODULENAME = "titan-memory";
const MODULENAME_FANCY = "Titan Memory";

// Default Settings
const defaults = {
    enabled: true,
    debug: true,
    show_toasts: false, // Default OFF as requested
    
    // Summarization
    autosummarize: true,
    threshold: 2,
    maxsummarylength: 1500,
    prompttemplate: `[System Note: You are an AI managing the long-term memory of a story. 
Your job is to update the existing summary with new events.
EXISTING MEMORY:
"{{EXISTING}}"

RECENT CONVERSATION:
{{NEWLINES}}

INSTRUCTION:
1. Write a consolidated summary in the past tense. Merge the new conversation into the existing memory. Keep it concise. 
2. On a new line, output keywords for this memory in this format: KEYWORDS: name1, location2, item3
3. Do not output anything else.]`,

    // Aggressive Pruning
    pruningenabled: true,
    tokenbudget: 1000, // Aggressive default

    // Lorebook
    lorebooksync: false,
    injectprompt: true, // If false, only relies on lorebook

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
    // Feature: Hide success toasts if setting is off
    if (type === "success" && !getSetting("show_toasts")) return;
    toastr?.[type]?.(message, MODULENAME_FANCY);
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

// --- CORE LOGIC: RAG / VECTOR ---
async function getEmbedding(text) {
    const apiKey = getSetting("ragkey");
    const apiUrl = getSetting("ragurl");
    if (!apiKey || !text) return null;

    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({ input: text, model: "text-embedding-3-small" })
        });
        const data = await response.json();
        return data?.data?.[0]?.embedding || null;
    } catch (e) {
        debug("Embedding Error:", e);
        return null;
    }
}

function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
        magA += vecA[i] * vecA[i];
        magB += vecB[i] * vecB[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function archiveMessageAsVector(text) {
    if (!getSetting("ragenabled")) return;
    const vector = await getEmbedding(text);
    if (!vector) return;

    let store = getChatMetadata("vector_store") || [];
    store.push({ text: text.substring(0, 500), vector: vector, timestamp: Date.now() }); // Limit text size
    setChatMetadata("vector_store", store);
    debug("Archived to Vector Store:", text.substring(0, 20) + "...");
}

async function retrieveRAGContext(query) {
    if (!getSetting("ragenabled")) return "";
    const vector = await getEmbedding(query);
    if (!vector) return "";

    let store = getChatMetadata("vector_store") || [];
    if (store.length === 0) return "";

    let scored = store.map(item => ({
        text: item.text,
        score: cosineSimilarity(vector, item.vector)
    }));

    scored.sort((a, b) => b.score - a.score);
    const depth = getSetting("ragdepth") || 3;
    const matches = scored.slice(0, depth).filter(m => m.score > 0.7); // Relevance threshold

    if (matches.length > 0) debug("RAG Found:", matches.map(m => m.text));
    return matches.map(m => m.text).join("\n");
}

// --- CORE LOGIC: LOREBOOK ---
async function updateLorebook(summary, keywordsRaw) {
    if (!getSetting("lorebooksync")) return;
    
    const ctx = getContext();
    if (!ctx.characterId) return;
    
    const charName = ctx.characters[ctx.characterId].name;
    const bookName = `Titan Memory - ${charName}`;
    
    // Parse keywords
    let keys = ["titan", "memory", "summary"];
    if (keywordsRaw) {
        keys = keywordsRaw.split(",").map(k => k.trim()).filter(k => k.length > 0);
    }

    // Find or Create Entry
    // Note: Implementation depends on ST version. Using generalized logic.
    let lorebook = ctx.lorebook; 
    if (!lorebook) return; // Safety

    let entry = lorebook.entries.find(e => e.displayName === bookName || e.key.includes("titan_memory_unique"));
    
    if (!entry) {
        // Create New
        // Assuming standard ST Lorebook Entry structure
        const newEntry = {
            uid: Date.now(),
            displayName: bookName,
            key: keys,
            content: summary,
            enabled: true,
            insertion_order: 100, // High priority
            case_sensitive: false,
            constant: false, // It relies on keywords!
            position: "before_char_defs"
        };
        lorebook.entries.push(newEntry);
        debug("Created new Lorebook entry.");
    } else {
        // Update
        entry.content = summary;
        entry.key = keys; // Update dynamic keys
        debug("Updated Lorebook entry with keys:", keys);
    }
    // Trigger ST save (usually automatic on change, but ensures persistence)
    // getContext().saveLorebook(); // Hypothetical helper, standard save works on debounced loop
}

// --- CORE LOGIC: PRUNING (AGGRESSIVE) ---
async function handlePruning() {
    if (!getSetting("enabled") || !getSetting("pruningenabled")) return;

    const ctx = getContext();
    const chat = ctx.chat;
    if (!chat || chat.length === 0) return;

    // Get the memory pointer (where we last summarized up to)
    const lastIndex = getChatMetadata("last_index") || 0;
    
    // Token Budget Logic
    const budget = getSetting("tokenbudget") || 1000;
    let currentTokens = 0;
    let prunePoint = -1;

    // Count backwards
    for (let i = chat.length - 1; i >= 0; i--) {
        const msg = chat[i];
        // Rough estimate if getTokenCount unavailable: 1 token ~ 4 chars
        const tokens = ctx.getTokenCount ? ctx.getTokenCount(msg.mes) : (msg.mes.length / 3.5);
        
        currentTokens += tokens;
        if (currentTokens > budget) {
            prunePoint = i;
            break;
        }
    }

    // Safety: Do not prune messages that haven't been summarized yet unless they are VERY old
    // But for "Aggressive" mode, we prioritize budget.
    // We should ideally only hide things older than lastIndex to avoid data loss gap.
    // Let's stick to: Prune anything older than the budget, but Archive it first.
    
    if (prunePoint > -1) {
        debug(`Pruning budget exceeded. Cutoff at index ${prunePoint}.`);
        
        for (let i = 0; i <= prunePoint; i++) {
            if (!chat[i].extra) chat[i].extra = {};
            
            if (!chat[i].extra.excludefromcontext) {
                // RAG HOOK: Archive before hiding
                await archiveMessageAsVector(chat[i].mes);
                chat[i].extra.excludefromcontext = true; // Hide from LLM
            }
        }
    }
}

// --- CORE LOGIC: SUMMARIZATION ---
async function runSummarization() {
    if (isProcessing) return;
    isProcessing = true;

    const ctx = getContext();
    const chat = ctx.chat;
    const lastIndex = getChatMetadata("last_index") || 0;

    // Get new messages
    const newMessages = chat.slice(lastIndex);
    if (newMessages.length === 0) { isProcessing = false; return; }

    // Format for prompt
    const newLines = newMessages.map(m => `${m.name}: ${m.mes}`).join("\n");
    const existingMemory = getChatMetadata("summary") || "No history yet.";

    // Prepare Prompt
    let prompt = getSetting("prompttemplate")
        .replace("{{EXISTING}}", existingMemory)
        .replace("{{NEWLINES}}", newLines);

    debug("Generating summary...");
    
    try {
        const result = await generateRaw(prompt, main_api);
        if (!result) throw new Error("Empty response");

        // Parse Output (Summary vs Keywords)
        let summary = result;
        let keywords = "";

        if (result.includes("KEYWORDS:")) {
            const parts = result.split("KEYWORDS:");
            summary = parts[0].trim();
            keywords = parts[1].trim();
        }
        
        // Clean Summary
        summary = summary.replace(/SUMMARY:/gi, "").trim();

        // Save Memory
        setChatMetadata("summary", summary);
        setChatMetadata("last_index", chat.length);
        setChatMetadata("last_updated", Date.now());

        // Trigger Lorebook Sync
        await updateLorebook(summary, keywords);

        toast("Memory updated successfully", "success");

    } catch (e) {
        error("Summarization failed:", e);
    } finally {
        isProcessing = false;
        handlePruning(); // Prune after update
        refreshMemoryInjection();
    }
}

// --- INJECTION HANDLERS ---
function refreshMemoryInjection() {
    const ctx = getContext();
    const summary = getChatMetadata("summary");

    // Clear existing injections
    ctx.setExtensionPrompt(MODULENAME + 'injection', '', 0, 0);
    
    // If using Lorebook Sync, we might NOT want to inject prompt (save tokens)
    if (getSetting("lorebooksync") && !getSetting("injectprompt")) {
        debug("Injection skipped (Lorebook mode active)");
        return;
    }

    if (summary && getSetting("enabled")) {
        const injectionText = `\n[Story Memory: ${summary}]\n`;
        ctx.setExtensionPrompt(MODULENAME + 'injection', injectionText, 0, 0, true);
    }
}

// --- EVENT LISTENERS ---
function onNewMessage() {
    if (!getSetting("enabled")) return;

    const ctx = getContext();
    const chat = ctx.chat;
    const lastIndex = getChatMetadata("last_index") || 0;
    const threshold = getSetting("threshold") || 2;

    // Auto Summarize Check
    if (getSetting("autosummarize") && (chat.length - lastIndex >= threshold)) {
        runSummarization();
    }

    // RAG Check (Pre-fetch for next turn)
    // Not blocking generation, just readying the archive
    handlePruning(); 
}

// Hook into Generation for RAG Injection
// We use a global interval or specific ST hook if available. 
// Standard extension method:
jQuery(document).ready(function () {
    const ctx = getContext();
    
    // Hook Generation Start for RAG
    // We try to grab the latest user message and find context
    if (ctx.eventSource) {
        ctx.eventSource.on(ctx.eventTypes.GENERATION_STARTED, async () => {
            if (!getSetting("enabled") || !getSetting("ragenabled")) return;
            
            const chat = ctx.chat;
            const lastMsg = chat[chat.length - 1];
            if (!lastMsg.is_user) return;

            const context = await retrieveRAGContext(lastMsg.mes);
            if (context) {
                const ragText = `\n[Relevant Past Memories (RAG):\n${context}\n]`;
                // Inject temporarily for this generation
                ctx.setExtensionPrompt(MODULENAME + 'rag', ragText, 0, 0, true);
                debug("Injected RAG Context");
            } else {
                ctx.setExtensionPrompt(MODULENAME + 'rag', '', 0, 0);
            }
        });

        // Normal triggers
        ctx.eventSource.on(ctx.eventTypes.USER_MESSAGE_RENDERED, onNewMessage);
        ctx.eventSource.on(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, onNewMessage);
    }

    // Load UI
    loadSettingsHTML();
});

// --- UI SETUP ---
async function loadSettingsHTML() {
    const response = await fetch(`${import.meta.url.substring(0, import.meta.url.lastIndexOf('/'))}/settings.html`);
    const html = await response.text();
    $('#extensions_settings').append(html); // Append to standard location

    // Bind Inputs
    bindInput("#titan-enabled", "enabled");
    bindInput("#titan-debug", "debug");
    bindInput("#titan-show-toasts", "show_toasts");
    bindInput("#titan-pruning", "pruningenabled");
    bindInput("#titan-token-budget", "tokenbudget");
    bindInput("#titan-auto-summarize", "autosummarize");
    bindInput("#titan-threshold", "threshold");
    bindInput("#titan-max-length", "maxsummarylength");
    bindInput("#titan-lorebook-sync", "lorebooksync");
    bindInput("#titan-inject-prompt", "injectprompt");
    bindInput("#titan-rag-enabled", "ragenabled");
    bindInput("#titan-rag-url", "ragurl");
    bindInput("#titan-rag-key", "ragkey");
    bindInput("#titan-rag-depth", "ragdepth");
    bindInput("#titan-prompt-template", "prompttemplate");

    // Buttons
    $("#titan-now").click(() => runSummarization());
    $("#titan-save").click(() => toast("Settings Saved"));
    $("#titan-wipe").click(() => {
        if(confirm("Wipe memory?")) {
            setChatMetadata("summary", "");
            setChatMetadata("last_index", 0);
            setChatMetadata("vector_store", []);
            toast("Memory Wiped", "error");
        }
    });
    
    log("Titan Memory UI Loaded");
}

function bindInput(selector, key) {
    const $el = $(selector);
    const type = $el.attr("type") === "checkbox" ? "checked" : "val";
    
    // Init value
    const val = getSetting(key);
    if (type === "checked") $el.prop("checked", val);
    else $el.val(val);

    // Bind change
    $el.on("change input", function() {
        const newVal = type === "checked" ? $(this).prop("checked") : $(this).val();
        setSetting(key, newVal);
    });
}
