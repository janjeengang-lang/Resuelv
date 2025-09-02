// options.js
const els = {
  aiProvider: document.getElementById('aiProvider'),
  openrouterKey: document.getElementById('openrouterKey'),
  openrouterModel: document.getElementById('openrouterModel'),
  geminiKey: document.getElementById('geminiKey'),
  cerebrasKey: document.getElementById('cerebrasKey'),
  ocrKey: document.getElementById('ocrKey'),
  ipdataKey: document.getElementById('ipdataKey'),
  typingSpeed: document.getElementById('typingSpeed'),
  ocrLang: document.getElementById('ocrLang'),
  test: document.getElementById('test'),
  testIpdata: document.getElementById('testIpdata'),
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
  siteName: document.getElementById('siteName'),
  siteUrl: document.getElementById('siteUrl'),
  addSite: document.getElementById('addSite'),
  sitesList: document.getElementById('sitesList'),
  webWidth: document.getElementById('webWidth'),
  webHeight: document.getElementById('webHeight'),
};

function notify(msg, isErr = false) {
  // Add guard to prevent errors if the status element is missing.
  if (!els.status) return;
  els.status.textContent = msg;
  els.status.className = 'status' + (isErr ? ' error' : '');
}

async function load() {
  try {
    const s = await chrome.storage.local.get([
      'aiProvider',
      'openrouterApiKey',
      'openrouterModel',
      'geminiApiKey',
      'cerebrasApiKey',
      'ocrApiKey',
      'ipdataApiKey',
      'typingSpeed',
      'ocrLang',
      'customWebSize',
    ]);

    els.aiProvider.value     = s.aiProvider || 'openrouter';
    els.openrouterKey.value  = s.openrouterApiKey || '';
    els.openrouterModel.value= s.openrouterModel || 'google/gemini-2.0-flash-exp:free';
    els.geminiKey.value      = s.geminiApiKey || '';
    els.cerebrasKey.value    = s.cerebrasApiKey || '';
    els.ocrKey.value         = s.ocrApiKey || '';
    els.ipdataKey.value      = s.ipdataApiKey || '';
    els.typingSpeed.value    = s.typingSpeed || 'normal';
    els.ocrLang.value        = s.ocrLang || 'eng';
    els.webWidth.value       = s.customWebSize?.width || 1000;
    els.webHeight.value      = s.customWebSize?.height || 800;

    await loadPrompts();
    await loadSites();
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

async function loadSites(){
  const { customSites = [] } = await chrome.storage.local.get('customSites');
  renderSites(customSites);
}

function renderPromptTable(list) {
  if (!els.promptTable) return;
  els.promptTable.innerHTML = '';

  for (const p of list) {
    const tr = document.createElement('tr');

    // Add checks for potentially undefined properties for robustness.
    const tags = Array.isArray(p.tags) ? p.tags.join(', ') : '';
    const hot  = (p.hotkey || '');

    tr.innerHTML = `
      <td>${p.name}</td>
      <td>${tags}</td>
      <td>${hot}</td>
      <td>
        <button class="btn small" data-edit="${p.id}">Edit</button>
        <button class="btn small warn" data-del="${p.id}">Delete</button>
      </td>
    `;

    els.promptTable.appendChild(tr);
  }

  // Edit
  els.promptTable.querySelectorAll('button[data-edit]').forEach(btn =>
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-edit');
      const { customPrompts = [] } = await chrome.storage.sync.get('customPrompts');
      const pr = customPrompts.find(x => x.id === id);
      if (!pr) return;
      els.promptName.value   = pr.name;
      els.promptTags.value   = (Array.isArray(pr.tags) ? pr.tags.join(', ') : '');
      els.promptHotkey.value = pr.hotkey || '';
      els.promptText.value   = pr.text || '';
      editingId = id;
    })
  );

  // Delete
  els.promptTable.querySelectorAll('button[data-del]').forEach(btn =>
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-del');
      const { customPrompts = [] } = await chrome.storage.sync.get('customPrompts');
      const list = customPrompts.filter(p => p.id !== id);
      await chrome.storage.sync.set({ customPrompts: list });
      loadPrompts();
    })
  );
}

function renderSites(list){
  if(!els.sitesList) return;
  els.sitesList.innerHTML = '';
  list.forEach((s, idx) => {
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.alignItems = 'center';
    li.style.marginBottom = '6px';
    li.innerHTML = `<span>${s.name}</span><button class="btn small warn" data-del="${idx}">Delete</button>`;
    els.sitesList.appendChild(li);
  });
  els.sitesList.querySelectorAll('button[data-del]').forEach(btn =>
    btn.addEventListener('click', async e => {
      const idx = Number(e.currentTarget.getAttribute('data-del'));
      list.splice(idx,1);
      await chrome.storage.local.set({customSites: list});
      renderSites(list);
    })
  );
}

function resetPromptForm() {
  els.promptName.value = '';
  els.promptTags.value = '';
  els.promptHotkey.value = '';
  els.promptText.value = '';
  editingId = null;
}

els.cancelPrompt?.addEventListener('click', resetPromptForm);

els.addSite?.addEventListener('click', async () => {
  const name = els.siteName.value.trim();
  const url = els.siteUrl.value.trim();
  if (!name || !url) { notify('Name and URL required', true); return; }
  const { customSites = [] } = await chrome.storage.local.get('customSites');
  customSites.push({ name, url });
  await chrome.storage.local.set({ customSites });
  els.siteName.value = '';
  els.siteUrl.value = '';
  renderSites(customSites);
});

els.savePrompt?.addEventListener('click', async () => {
  const name = els.promptName.value.trim();
  const text = els.promptText.value.trim();
  if (!name || !text) { notify('Name and prompt required', true); return; }

  const tags = els.promptTags.value
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);

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
    await chrome.storage.local.set({
      aiProvider:        els.aiProvider.value,
      openrouterApiKey:  els.openrouterKey.value.trim(),
      openrouterModel:   els.openrouterModel.value,
      geminiApiKey:      els.geminiKey.value.trim(),
      cerebrasApiKey:    els.cerebrasKey.value.trim(),
      ocrApiKey:         els.ocrKey.value.trim(),
      ipdataApiKey:      els.ipdataKey.value.trim(),
      typingSpeed:       els.typingSpeed.value,
      ocrLang:           els.ocrLang.value,
      customWebSize:     {
        width: Number(els.webWidth.value) || 1000,
        height: Number(els.webHeight.value) || 800,
      },
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
    // تِست بسيط عبر خدمة الخلفية (اضبط الرسالة حسب مزودك)
    const res = await chrome.runtime.sendMessage({
      type: 'GEMINI_GENERATE',
      prompt: 'Respond with: OK'
    });
    if (!res?.ok) throw new Error(res?.error || 'OpenRouter failed');
    if (!/\bOK\b/i.test(res.result)) notify('API responded, not strictly OK: ' + res.result);
    else notify('API OK');
  } catch (e) {
    notify(String(e?.message || e), true);
  }
});

els.testIpdata?.addEventListener('click', async () => {
  try {
    notify('Testing ipdata…');
    const key = els.ipdataKey.value.trim();
    if (!key) { notify('Enter API key', true); return; }
    const res = await chrome.runtime.sendMessage({ type: 'TEST_IPDATA', key });
    if (!res?.ok) throw new Error(res?.error || 'ipdata failed');
    notify('ipdata OK');
  } catch (e) { notify(String(e?.message || e), true); }
});

load();