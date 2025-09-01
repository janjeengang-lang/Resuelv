--- START OF FILE src/options.js ---
// options.js
const els = {
  aiProvider: document.getElementById('aiProvider'),
  openrouterKey: document.getElementById('openrouterKey'),
  openrouterModel: document.getElementById('openrouterModel'),
  geminiKey: document.getElementById('geminiKey'),
  cerebrasKey: document.getElementById('cerebrasKey'),
  ocrKey: document.getElementById('ocrKey'),
  ipdataKey: document.getElementById('ipdataKey'),
  tempMailKey: document.getElementById('tempMailKey'),
  ipqsKey: document.getElementById('ipqsKey'),
  typingSpeed: document.getElementById('typingSpeed'),
  ocrLang: document.getElementById('ocrLang'),
  test: document.getElementById('test'),
  testIpdata: document.getElementById('testIpdata'),
  testIpqs: document.getElementById('testIpqs'),
  save: document.getElementById('save'),
  clear: document.getElementById('clear'),
  status: document.getElementById('status'),
  promptForm: document.getElementById('promptForm'),
  promptName: document.getElementById('promptName'),
  promptTags: document.getElementById('promptTags'),
  promptHotkey: document.getElementById('promptHotkey'),
  promptText: document.getElementById('promptText'),
  savePrompt: document.getElementById('savePrompt'),
  cancelPrompt: document.getElementById('cancelPrompt'),
  promptTable: document.getElementById('promptTable')?.querySelector('tbody'),
};

function notify(msg, isErr = false) {
  // Add guard to prevent errors if the status element is missing.
  if (!els.status) return;
  els.status.textContent = msg;
  els.status.className = 'status' + (isErr ? ' error' : '');
}

async function load() {
  try {
    // Merged all API keys from both branches to ensure all features are configured.
    const s = await chrome.storage.local.get([
      'aiProvider',
      'openrouterApiKey',
      'openrouterModel',
      'geminiApiKey',
      'cerebrasApiKey',
      'ocrApiKey',
      'ipdataApiKey',
      'tempMailApiKey',
      'ipqsApiKey',
      'typingSpeed',
      'ocrLang',
    ]);
    els.aiProvider.value = s.aiProvider || 'openrouter';
    els.openrouterKey.value = s.openrouterApiKey || '';
    els.openrouterModel.value = s.openrouterModel || 'google/gemini-2.0-flash-exp:free';
    els.geminiKey.value = s.geminiApiKey || '';
    els.cerebrasKey.value = s.cerebrasApiKey || '';
    els.ocrKey.value = s.ocrApiKey || '';
    els.ipdataKey.value = s.ipdataApiKey || '';
    els.tempMailKey.value = s.tempMailApiKey || '';
    els.ipqsKey.value = s.ipqsApiKey || '';
    els.typingSpeed.value = s.typingSpeed || 'normal';
    els.ocrLang.value = s.ocrLang || 'eng';
    await loadPrompts();
    console.log('Settings loaded successfully');
  } catch (e) {
    console.error('Error loading settings:', e);
    notify('Error loading settings: ' + e.message, true);
  }
}

let editingId = null;

async function loadPrompts() {
  const { customPrompts = [] } = await chrome.storage.sync.get('customPrompts');
  renderPromptTable(customPrompts);
}

function renderPromptTable(list) {
  if (!els.promptTable) return;
  els.promptTable.innerHTML = '';
  for (const p of list) {
    const tr = document.createElement('tr');
    // Add defensive checks for potentially undefined properties.
    const tags = Array.isArray(p.tags) ? p.tags.join(', ') : '';
    const hotkey = p.hotkey || '';
    tr.innerHTML = `<td>${p.name}</td><td>${tags}</td><td>${hotkey}</td>` +
      `<td><button class="btn small" data-edit="${p.id}">Edit</button> ` +
      `<button class="btn small warn" data-del="${p.id}">Delete</button></td>`;
    els.promptTable.appendChild(tr);
  }
  els.promptTable.querySelectorAll('button[data-edit]').forEach(btn => btn.addEventListener('click', async e => {
    const id = e.currentTarget.getAttribute('data-edit');
    const { customPrompts = [] } = await chrome.storage.sync.get('customPrompts');
    const pr = customPrompts.find(x => x.id === id);
    if (!pr) return;
    els.promptName.value = pr.name;
    els.promptTags.value = (Array.isArray(pr.tags) ? pr.tags.join(', ') : '');
    els.promptHotkey.value = pr.hotkey || '';
    els.promptText.value = pr.text || '';
    editingId = id;
  }));
  els.promptTable.querySelectorAll('button[data-del]').forEach(btn => btn.addEventListener('click', async e => {
    const id = e.currentTarget.getAttribute('data-del');
    const { customPrompts = [] } = await chrome.storage.sync.get('customPrompts');
    const list = customPrompts.filter(p => p.id !== id);
    await chrome.storage.sync.set({ customPrompts: list });
    loadPrompts();
  }));
}

function resetPromptForm() {
  els.promptName.value = '';
  els.promptTags.value = '';
  els.promptHotkey.value = '';
  els.promptText.value = '';
  editingId = null;
}

els.cancelPrompt?.addEventListener('click', resetPromptForm);

els.savePrompt?.addEventListener('click', async () => {
  const name = els.promptName.value.trim();
  const text = els.promptText.value.trim();
  if (!name || !text) { notify('Name and prompt required', true); return; }
  const tags = els.promptTags.value.split(',').map(t => t.trim()).filter(Boolean);
  const hotkey = els.promptHotkey.value.trim();
  const { customPrompts = [] } = await chrome.storage.sync.get('customPrompts');
  if (editingId) {
    const idx = customPrompts.findIndex(p => p.id === editingId);
    if (idx >= 0) customPrompts[idx] = { ...customPrompts[idx], name, text, tags, hotkey };
  } else {
    customPrompts.push({ id: Date.now().toString(), name, text, tags, hotkey });
  }
  await chrome.storage.sync.set({ customPrompts });
  resetPromptForm();
  loadPrompts();
});

els.save?.addEventListener('click', async () => {
  try {
    // Merged all API keys from both branches to save all features' configurations.
    await chrome.storage.local.set({
      aiProvider: els.aiProvider.value,
      openrouterApiKey: els.openrouterKey.value.trim(),
      openrouterModel: els.openrouterModel.value,
      geminiApiKey: els.geminiKey.value.trim(),
      cerebrasApiKey: els.cerebrasKey.value.trim(),
      ocrApiKey: els.ocrKey.value.trim(),
      ipdataApiKey: els.ipdataKey.value.trim(),
      tempMailApiKey: els.tempMailKey.value.trim(),
      ipqsApiKey: els.ipqsKey.value.trim(),
      typingSpeed: els.typingSpeed.value,
      ocrLang: els.ocrLang.value,
    });
    notify('Saved');
    console.log('Settings saved successfully');
  } catch (e) {
    console.error('Error saving settings:', e);
    notify('Error saving: ' + e.message, true);
  }
});

els.clear?.addEventListener('click', async () => {
  await chrome.storage.local.clear();
  await load();
  notify('Cleared');
});

els.test?.addEventListener('click', async () => {
  try {
    notify('Testing…');
    // Test through the background service.
    const res = await chrome.runtime.sendMessage({
      type: 'GEMINI_GENERATE',
      prompt: 'Respond with: OK'
    });
    if (!res?.ok) throw new Error(res?.error || 'API failed');
    if (!/\bOK\b/i.test(res.result)) notify('API responded, not strictly OK: ' + res.result);
    else notify('API OK');
  } catch (e) {
    notify(String(e?.message || e), true);
  }
});

// Merged both test buttons as their functionality is distinct and non-overlapping.
els.testIpdata?.addEventListener('click', async () => {
  try {
    notify('Testing IPData…');
    const key = els.ipdataKey.value.trim();
    if (!key) { notify('Enter API key', true); return; }
    const res = await chrome.runtime.sendMessage({ type: 'TEST_IPDATA', key });
    if (!res?.ok) throw new Error(res?.error || 'IPData failed');
    notify('IPData OK');
  } catch (e) { notify(String(e?.message || e), true); }
});

els.testIpqs?.addEventListener('click', async () => {
  try {
    notify('Testing IPQS…');
    const key = els.ipqsKey.value.trim();
    if (!key) { notify('Enter API key', true); return; }
    const res = await chrome.runtime.sendMessage({ type: 'TEST_IPQS', key });
    if (!res?.ok) throw new Error(res?.error || 'IPQS failed');
    notify('IPQS OK');
  } catch (e) { notify(String(e?.message || e), true); }
});

load();
--- END OF FILE src/options.js ---