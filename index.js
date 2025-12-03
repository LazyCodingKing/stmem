/* index.js - qvink_memory (updated) */

/*
  Defensive, minimal integration with SillyTavern.
  - Exposes window.memory_intercept_messages for the manifest "generate_interceptor".
  - Loads/saves extension settings using SillyTavern.libs.localforage if available.
  - Wires up the settings panel markup (settings.html) if present in the DOM.
*/

(async function () {
  // Helper: safe getter for SillyTavern context
  function stContextSafe() {
    try {
      if (typeof SillyTavern !== "undefined" && SillyTavern.getContext) {
        return SillyTavern.getContext();
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  const ctx = stContextSafe();

  // local persistence (fallback to localStorage if localforage not present)
  const store = (function () {
    if (ctx && ctx.libs && ctx.libs.localforage) {
      const lf = ctx.libs.localforage;
      return {
        async get(key){ return lf.getItem(key); },
        async set(key, value){ return lf.setItem(key, value); }
      };
    }
    return {
      async get(key){ try { return JSON.parse(localStorage.getItem(key)); } catch(e){ return null; } },
      async set(key, value){ try { localStorage.setItem(key, JSON.stringify(value)); } catch(e){} }
    };
  })();

  // default settings
  const DEFAULT_SETTINGS = {
    auto_summarize: false,
    short_term_context_limit: 2000,
    long_term_context_limit: 8000,
    // ... add any defaults you need
  };

  async function loadSettings() {
    const s = await store.get('qvink_memory_settings');
    return Object.assign({}, DEFAULT_SETTINGS, s || {});
  }
  async function saveSettings(s) {
    await store.set('qvink_memory_settings', s);
  }

  // Provide the interceptor function expected in manifest.generate_interceptor
  // SillyTavern will call this on generation requests; adapt to your logic.
  window.memory_intercept_messages = async function (generateArgs = {}) {
    try {
      // Example: inspect the prompt and optionally modify it
      const settings = await loadSettings();
      // If user disabled summarization, return null (no changes)
      if (!settings.auto_summarize) return null;

      // This is a minimal example: append a short marker to the prompt to show interception.
      if (generateArgs?.prompt) {
        generateArgs.prompt = `${generateArgs.prompt}\n\n<!-- qvink-memory marker -->`;
      }
      // You can return either modified args or null to indicate no change.
      return generateArgs;
    } catch (err) {
      console.error('qvink_memory interceptor error:', err);
      return null;
    }
  };

  // When DOM becomes available, try to wire up UI (settings.html) controls (defensive).
  async function wireSettingsUI() {
    // settings markup (settings.html) likely gets loaded by ST; look for root id
    const root = document.getElementById('qvink_memory_settings');
    if (!root) return; // nothing to wire (ok)
    const settings = await loadSettings();

    // helper to find inputs by id and set/get
    function byId(id){ return root.querySelector(`#${id}`); }

    // populate known inputs (only examples — add more as needed)
    const autoSummCheckbox = byId('auto_summarize');
    if (autoSummCheckbox) {
      autoSummCheckbox.checked = !!settings.auto_summarize;
      autoSummCheckbox.addEventListener('change', async () => {
        settings.auto_summarize = !!autoSummCheckbox.checked;
        await saveSettings(settings);
      });
    }

    const stLimit = byId('short_term_context_limit');
    if (stLimit) {
      stLimit.value = settings.short_term_context_limit ?? DEFAULT_SETTINGS.short_term_context_limit;
      stLimit.addEventListener('change', async () => {
        settings.short_term_context_limit = parseInt(stLimit.value || 0, 10);
        await saveSettings(settings);
      });
    }

    const ltLimit = byId('long_term_context_limit');
    if (ltLimit) {
      ltLimit.value = settings.long_term_context_limit ?? DEFAULT_SETTINGS.long_term_context_limit;
      ltLimit.addEventListener('change', async () => {
        settings.long_term_context_limit = parseInt(ltLimit.value || 0, 10);
        await saveSettings(settings);
      });
    }

    // Add convenience "Revert Settings" wiring if button exists
    const revertBtn = root.querySelector('#revert_settings');
    if (revertBtn) {
      revertBtn.addEventListener('click', async () => {
        await saveSettings(DEFAULT_SETTINGS);
        // refresh UI values
        if (autoSummCheckbox) autoSummCheckbox.checked = DEFAULT_SETTINGS.auto_summarize;
        if (stLimit) stLimit.value = DEFAULT_SETTINGS.short_term_context_limit;
        if (ltLimit) ltLimit.value = DEFAULT_SETTINGS.long_term_context_limit;
        if (ctx && ctx.notify) ctx.notify('qvink_memory', 'Settings reverted to defaults');
      });
    }

    // Optionally register for ST events (if available)
    if (ctx && ctx.on) {
      try {
        // Example: react when presets or API change
        ctx.on('PRESET_CHANGED', () => { /* update UI if necessary */ });
      } catch (e) { /* ignore */ }
    }
  }

  // Wait for DOM ready then attempt to wire UI
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireSettingsUI);
  } else {
    wireSettingsUI();
  }

  // expose a tiny debug helper on window if needed
  window.qvink_memory = {
    loadSettings,
    saveSettings,
    getContext: () => ctx
  };

  console.log('qvink_memory: initialized (manifest interceptor available).');

})();
