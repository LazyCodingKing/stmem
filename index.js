import {
    getContext,
    extension_settings,
    saveMetadataDebounced
} from "../../../extensions.js";

import {
    saveSettingsDebounced,
    generateRaw,
    main_api,
    chat_metadata,
    eventSource,
    event_types,
    saveMetadata,
} from "../../../../script.js";

import {
    loadWorldInfo,
    saveWorldInfo,
    createWorldInfoEntry,
    createNewWorldInfo,
    world_names,
    reloadEditor,
    METADATA_KEY 
} from "../../../world-info.js";

import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../../slash-commands/SlashCommandArgument.js';

const MODULENAME = "titan-memory";
const MODULENAME_FANCY = "Titan Memory";

// --- SETTINGS ---
const defaults = {
    enabled: true,
    debug: true,
    show_toasts: false, 
    autosummarize: true,
    threshold: 20,
    min_message_length: 50,
    
    // Consolidation
    consolidation_enabled: true,
    consolidation_threshold: 10, 
    
    // Prompt
    prompttemplate: `[System Note: You are a strict Database Archivist.
Your goal is to extract facts from the provided text for a wiki.

CONTEXT:
- The Main Character is: "{{CHAR}}".
- The User is: "{{USER}}".

RULES:
1. First, write a concise, numbered list (1-3 points) summarizing the key events.
2. Follow the list with the exact delimiter: --- ENTITY DATA ---
3. Below the delimiter, extract ONLY facts explicitly written in the Input Text.
4. NORMALIZE ENTITIES: If the text refers to "{{CHAR}}" by a nickname, alias, or description (e.g., "The Witch", "She"), file it under "ENTRY: {{CHAR}}". Do not create separate entries for the same person.
5. If the input contains no new factual information, output ONLY the delimiter and the "NO DATA" flag.

INPUT TEXT:
"""
{{NEWLINES}}
"""

OUTPUT FORMAT:
1. [Summary Point 1]
2. [Summary Point 2]
--- ENTITY DATA ---
ENTRY: [Subject Name]
KEYWORDS: [tag1, tag2]
CONTENT: [The specific fact found in the text]

BEGIN LOG:`,
    
    merge_prompt: `[System Note: You are a Historian. Your task is to merge several fragmented records into a single cohesive entry.
    
    INPUT RECORDS:
    """
    {{RECORDS}}
    """
    
    INSTRUCTIONS:
    1. Combine the facts from the records above.
    2. Remove duplicates and resolve contradictions (favoring the latest info).
    3. Output a single JSON object.
    
    FORMAT:
    {
        "title": "Combined Archive",
        "keywords": ["tag1", "tag2"],
        "content": "The combined narrative summary of these events..."
    }
    ]`,

    pruningenabled: true,
    tokenbudget: 1000, 
    lorebooksync: true
};

let isProcessing = false;

// --- HELPERS ---
function log(...args) { console.log(`[${MODULENAME_FANCY}]`, ...args); }
function debug(...args) { if (extension_settings[MODULENAME]?.debug) console.log(`[DEBUG ${MODULENAME_FANCY}]`, ...args); }
function toast(msg, type = "info") { 
    if (window.toastr && getSetting("show_toasts")) window.toastr[type](msg, MODULENAME_FANCY); 
}

function getSetting(key) { return extension_settings[MODULENAME]?.[key] ?? defaults[key]; }
function setSetting(key, val) { 
    if (!extension_settings[MODULENAME]) extension_settings[MODULENAME] = {};
    extension_settings[MODULENAME][key] = val;
    saveSettingsDebounced();
}
function getChatMetadata(key) { return chat_metadata[MODULENAME]?.[key]; }
function setChatMetadata(key, val) {
    if (!chat_metadata[MODULENAME]) chat_metadata[MODULENAME] = {};
    chat_metadata[MODULENAME][key] = val;
    saveMetadataDebounced();
}

// --- ROBUST JSON PARSER ---
function normalizeText(s) {
    return String(s || '').replace(/\r\n/g, '\n').replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\u2060]/g, '');
}

function extractFencedBlocks(s) {
    const re = /```([\w+-]*)\s*([\s\S]*?)```/g;
    const out = [];
    let m;
    while ((m = re.exec(s)) !== null) out.push((m[2] || '').trim());
    return out;
}

function extractBalancedJson(s) {
    const start = s.search(/[\{\[]/);
    if (start === -1) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') {
            depth--;
            if (depth === 0) return s.slice(start, i + 1).trim();
        }
    }
    return null;
}

function robustJSONParse(text) {
    const normalized = normalizeText(text);
    const candidates = [];
    const fenced = extractFencedBlocks(normalized);
    if (fenced.length) candidates.push(...fenced);
    const balanced = extractBalancedJson(normalized);
    if (balanced) candidates.push(balanced);
    candidates.push(normalized);

    for (const cand of candidates) {
        try {
            const cleaned = cand
                .replace(/\/\/.*$/gm, '') 
                .replace(/\/\*[\s\S]*?\*\//g, '') 
                .replace(/,\s*([\]}])/g, '$1'); 
            return JSON.parse(cleaned);
        } catch (e) { continue; }
    }
    return null;
}

// --- CORE: LOREBOOK MANAGEMENT ---
async function batchUpdateLorebook(entriesToProcess) {
    const ctx = getContext();
    if (!ctx.characterId && !ctx.groupId) return 0;
    
    let charName = "Unknown";
    if (ctx.characterId) {
        charName = ctx.characters[ctx.characterId].name;
    } else if (ctx.groupId && ctx.groups) {
        const group = ctx.groups.find(g => g.id === ctx.groupId);
        if (group) charName = group.name;
    }
    const bookName = `Titan Memory - ${charName}`.replace(/[\/\\:*?"<>|]/g, '_');

    if (!world_names.includes(bookName)) {
        try {
            await createNewWorldInfo(bookName);
            chat_metadata[METADATA_KEY] = bookName;
            await saveMetadata();
            toast(`Created & Bound: ${bookName}`, "success");
        } catch (e) {
            console.error("Creation Failed", e);
            return 0;
        }
    } else if (chat_metadata[METADATA_KEY] !== bookName) {
        chat_metadata[METADATA_KEY] = bookName;
        await saveMetadata();
    }

    let lorebookData = await loadWorldInfo(bookName);
    if (!lorebookData) return 0;

    let updates = 0;
    for (const item of entriesToProcess) {
        let title = item.title.replace(/\*\*/g, '').trim();
        if (title.toUpperCase() === "NO DATA" || title.includes("Input Text")) continue; 

        if (title.toLowerCase() === "you" || title.toLowerCase() === "she" || title.toLowerCase() === "he") {
            title = charName;
        }

        const content = item.content.trim();
        const keywords = Array.isArray(item.keywords) ? item.keywords.join(',') : item.keywords;
        const searchTitle = title.toLowerCase().trim();

        const entriesArray = Object.values(lorebookData.entries || {});
        let entry = entriesArray.find(e => (e.displayName || e.comment || "").toLowerCase().trim() === searchTitle);

        if (entry) {
            if (!entry.content.includes(content)) entry.content += `\n${content}`;
            const newKeys = keywords.split(',').map(k => k.trim());
            entry.key = [...new Set([...(entry.key || []), ...newKeys])];
            updates++;
        } else {
            let newEntry = createWorldInfoEntry(bookName, lorebookData);
            if (newEntry) {
                newEntry.displayName = title;
                newEntry.comment = title;
                newEntry.key = keywords.split(',').map(k => k.trim());
                newEntry.content = content;
                newEntry.enabled = true;
                newEntry.stmemorybooks = true; 
                updates++;
            }
        }
    }

    if (updates > 0) {
        await saveWorldInfo(bookName, lorebookData, true);
        if (typeof reloadEditor === 'function') reloadEditor(bookName);
        if (getSetting("debug") || getSetting("show_toasts")) toast(`Saved ${updates} memories.`, "success");
    }
    
    if (getSetting("consolidation_enabled")) {
        await runJanitor(bookName, lorebookData);
    }
    
    return updates;
}

// --- CORE: THE JANITOR (Consolidation) ---
async function runJanitor(bookName, lorebookData) {
    const entries = Object.values(lorebookData.entries || {});
    const candidates = entries.filter(e => 
        e.enabled && 
        !e.constant && 
        !e.comment.includes("Consolidated") &&
        e.stmemorybooks
    );

    const threshold = getSetting("consolidation_threshold") || 10;
    
    if (candidates.length > threshold) {
        debug(`Janitor: Found ${candidates.length} candidates. Threshold is ${threshold}. Consolidating...`);
        const toMerge = candidates.slice(0, 3);
        const recordsText = toMerge.map(e => `Title: ${e.comment}\nKeywords: ${e.key.join(', ')}\nContent: ${e.content}`).join("\n---\n");
        const prompt = getSetting("merge_prompt").replace("{{RECORDS}}", recordsText);
        
        try {
            const result = await generateRaw({ prompt: prompt, temperature: 0.3 }, main_api);
            const parsed = robustJSONParse(result);
            
            if (parsed && parsed.content) {
                let newEntry = createWorldInfoEntry(bookName, lorebookData);
                newEntry.displayName = parsed.title || "Consolidated Archive";
                newEntry.comment = `Consolidated Archive [${new Date().toLocaleDateString()}]`;
                newEntry.key = parsed.keywords || ["archive", "history"];
                newEntry.content = parsed.content;
                newEntry.stmemorybooks = true;
                newEntry.enabled = true;

                toMerge.forEach(e => { delete lorebookData.entries[e.uid]; });

                await saveWorldInfo(bookName, lorebookData, true);
                if (typeof reloadEditor === 'function') reloadEditor(bookName);
                console.log(`[Titan Janitor] Merged ${toMerge.length} entries into 1.`);
                toast("Titan Janitor: Optimized Memory", "success");
            }
        } catch (e) {
            console.error("Janitor Failed:", e);
        }
    }
}

// --- CORE: PROCESSING ---
async function runSummarization(forcedCount = null) {
    if (isProcessing) return;
    isProcessing = true;

    const $btn = $(".titan-memory-btn");
    $btn.addClass("fa-spin"); 

    const ctx = getContext();
    const chat = ctx.chat;
    
    let newMessages;
    if (forcedCount) {
        newMessages = chat.slice(-forcedCount);
        debug(`Manual trigger: Processing last ${forcedCount} messages.`);
    } else {
        const lastIndex = getChatMetadata("last_index") || 0;
        newMessages = chat.slice(lastIndex);
    }
    
    if (newMessages.length === 0) { 
        isProcessing = false; 
        $btn.removeClass("fa-spin");
        return; 
    }

    const newLines = newMessages.map(m => `${m.name}: ${m.mes}`).join("\n");
    
    if (!forcedCount && newLines.length < (getSetting("min_message_length") || 50)) {
        debug("Input too short (Smart Filter). Skipping.");
        isProcessing = false;
        $btn.removeClass("fa-spin");
        return;
    }

    let charName = "Character";
    let userName = "User";
    if (ctx.characterId && ctx.characters[ctx.characterId]) charName = ctx.characters[ctx.characterId].name;
    if (chat.length > 0 && chat[0].is_user) userName = chat[0].name; 

    let prompt = getSetting("prompttemplate")
        .replace("{{NEWLINES}}", newLines)
        .replace(/{{CHAR}}/g, charName)
        .replace(/{{USER}}/g, userName);

    const genOverrides = {
        prompt: prompt,
        temperature: 0.1,    
        top_k: 0,           
        top_p: 0.1,         
        min_p: 0,
        repetition_penalty: 1.0,
        max_length: 500,    
    };

    try {
        let result;
        try { 
            result = await generateRaw(genOverrides, main_api); 
        } catch { 
            result = await generateRaw(prompt, main_api); 
        }

        if (!result) throw new Error("No response");

        let summaryText = "";
        let entityData = result;

        if (result.includes("--- ENTITY DATA ---")) {
            const parts = result.split("--- ENTITY DATA ---", 2);
            summaryText = parts[0].trim();
            entityData = parts[1].trim();
        } 
        
        if (summaryText) {
            console.log(`%c[TITAN SUMMARY]:\n${summaryText}`, "color: #ffcc00; font-weight: bold;");
        }
        
        if (entityData.includes("NO DATA")) {
            debug("AI reported no new data.");
            if (!forcedCount) setChatMetadata("last_index", chat.length);
        } else {
            const entryRegex = /[\*\#\s]*ENTRY[\*\#\s]*:\s*(.*?)\n[\*\#\s]*KEYWORDS[\*\#\s]*:\s*(.*?)\n[\*\#\s]*CONTENT[\*\#\s]*:\s*([\s\S]*?)(?=(?:[\*\#\s]*ENTRY|$))/gi;
            let match;
            const batch = [];
            
            while ((match = entryRegex.exec(entityData)) !== null) {
                if (match[1] && match[3]) batch.push({ title: match[1], keywords: match[2], content: match[3] });
            }

            if (batch.length > 0) {
                await batchUpdateLorebook(batch);
                setChatMetadata("last_index", chat.length);
                $btn.css("color", "#00ff00");
                setTimeout(() => $btn.css("color", ""), 2000);
            }
        }

    } catch (e) {
        console.error("Analysis Failed", e);
        toast("Titan Memory Error", "error");
        $btn.css("color", "#ff0000"); 
    } finally {
        isProcessing = false;
        $btn.removeClass("fa-spin");
        // No pruning call needed here anymore! The interceptor handles it.
    }
}

// --- CORE: PHANTOM INTERCEPTOR (Replacement for Pruning) ---
// This function runs automatically by SillyTavern BEFORE sending context to AI.
globalThis.titan_memory_interceptor = function (chat, _contextSize, _abort, type) {
    if (!getSetting("enabled") || !getSetting("pruningenabled")) return;

    const ctx = getContext();
    const IGNORE_SYMBOL = ctx.symbols ? ctx.symbols.ignore : Symbol("ignore");
    
    // Safety check: Don't mess with group chats dry-runs sometimes having odd types
    if (type === 'dry') return; 

    const summaryReserve = 500; 
    const maxBudget = getSetting("tokenbudget") || 1000;
    const availableChatBudget = Math.max(200, maxBudget - summaryReserve);

    let currentTokens = 0;
    let prunedCount = 0;

    // Iterate BACKWARDS (Newest -> Oldest)
    for (let i = chat.length - 1; i >= 0; i--) {
        // Crucial: Create a shallow copy of the message so we don't modify the real chat history on disk
        // We only modify the "extra" flags for this specific generation request.
        chat[i] = { ...chat[i], extra: { ...chat[i].extra } };

        // If the message is already ignored manually, skip it
        if (chat[i].extra[IGNORE_SYMBOL]) continue;

        // Calculate tokens
        const tokens = ctx.getTokenCount ? ctx.getTokenCount(chat[i].mes) : (chat[i].mes.length / 3.5);
        
        // Check budget
        if (currentTokens + tokens > availableChatBudget) {
            // Budget exceeded: Mark this message as IGNORED
            chat[i].extra[IGNORE_SYMBOL] = true;
            prunedCount++;
        } else {
            currentTokens += tokens;
        }
    }
    
    if (prunedCount > 0 && getSetting("debug")) {
        console.log(`[Titan Interceptor] Hid ${prunedCount} old messages from AI context. (Used ${Math.round(currentTokens)}/${availableChatBudget} tokens)`);
    }
};

// --- UI: BRAIN BUTTON INJECTION ---
function injectBrainButton() {
    if ($(".titan-memory-btn").length > 0) return;
    
    const $target = $("#send_but_sheld"); 
    if ($target.length) {
        const $btn = $(`<div id="titan-manual-trigger" class="titan-memory-btn fa-solid fa-brain" title="Force Titan Memory Analysis"></div>`);
        $btn.css({
            "cursor": "pointer",
            "padding": "10px",
            "opacity": "0.5",
            "transition": "opacity 0.2s"
        });
        
        $btn.hover(
            function() { $(this).css("opacity", "1"); },
            function() { $(this).css("opacity", "0.5"); }
        );

        $btn.click((e) => {
            e.stopPropagation();
            toast("Analyzing Last 50 Messages...", "info");
            runSummarization(50);
        });

        $target.prepend($btn);
    }
}

// --- INIT ---
jQuery(document).ready(function () {
    console.log("%c [TITAN MEMORY] v11.0 (Phantom Protocol) Loaded ", "background: #00ff00; color: black; font-weight: bold;");

    const registerCommands = () => {
        if (!window.SlashCommandParser) return;

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'tm-now',
            callback: () => { 
                toast("Forcing analysis...", "info");
                runSummarization(0); 
            },
            helpString: 'Force Titan Memory to analyze new messages immediately.'
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'tm-scene',
            callback: (namedArgs, unnamedArgs) => {
                const count = parseInt(unnamedArgs[0]);
                if (isNaN(count)) return toast("Please specify number of messages. e.g., /tm-scene 50", "warning");
                toast(`Analyzing last ${count} messages...`, "info");
                runSummarization(count);
            },
            helpString: 'Force Titan Memory to analyze the last X messages. Usage: /tm-scene 50',
            unnamedArgumentList: [
                SlashCommandArgument.fromProps({ 
                    description: 'Number of messages', 
                    typeList: [ARGUMENT_TYPE.NUMBER], 
                    isRequired: true 
                })
            ]
        }));
    };

    setTimeout(registerCommands, 2000);
    setTimeout(injectBrainButton, 2500);

    if (eventSource) {
        eventSource.on(event_types.USER_MESSAGE_RENDERED, () => {
            const chat = getContext().chat;
            const lastIndex = getChatMetadata("last_index") || 0;
            if (getSetting("autosummarize") && (chat.length - lastIndex >= getSetting("threshold"))) {
                runSummarization();
            }
            // No handlePruning() call needed here!
        });
        
        eventSource.on(event_types.CHAT_CHANGED, () => {
            setTimeout(injectBrainButton, 500);
        });
    }

    const loadUI = async () => {
        const scriptPath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
        const response = await fetch(`${scriptPath}/settings.html`);
        const html = await response.text();
        $('#extensions_settings').append(html);

        const bind = (id, key) => {
            const $el = $(id);
            const isChk = $el.attr("type") === "checkbox";
            if (isChk) $el.prop("checked", getSetting(key)); else $el.val(getSetting(key));
            $el.on("change input", function() {
                setSetting(key, isChk ? $(this).prop("checked") : $(this).val());
            });
        };
        
        bind("#titan-enabled", "enabled");
        bind("#titan-debug", "debug");
        bind("#titan-auto-summarize", "autosummarize");
        bind("#titan-threshold", "threshold");
        bind("#titan-min-length", "min_message_length");
        
        bind("#titan-consolidation", "consolidation_enabled");
        bind("#titan-consolidation-threshold", "consolidation_threshold");
        bind("#titan-merge-prompt", "merge_prompt");

        bind("#titan-pruning", "pruningenabled");
        bind("#titan-token-budget", "tokenbudget");
        bind("#titan-prompt-template", "prompttemplate");
        
        $("#titan-now").click(() => runSummarization());
        $("#titan-save").click(() => toast("Settings Saved", "success"));
        $("#titan-wipe").click(() => {
            if(confirm("Wipe memory?")) {
                setChatMetadata("last_index", 0);
                toast("Memory Wiped", "error");
            }
        });
    };
    
    loadUI();
});
