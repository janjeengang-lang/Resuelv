// options.js
const els = {
  cerebrasKey: document.getElementById('cerebrasKey'),
  cerebrasModel: document.getElementById('cerebrasModel'),
  ocrKey: document.getElementById('ocrKey'),
  ipdataKey: document.getElementById('ipdataKey'),
  typingSpeed: document.getElementById('typingSpeed'),
  ocrLang: document.getElementById('ocrLang'),
  iflytekAppId: document.getElementById('iflytekAppId'),
  iflytekApiKey: document.getElementById('iflytekApiKey'),
  iflytekApiSecret: document.getElementById('iflytekApiSecret'),
  dubLang: document.getElementById('dubLang'),
  dubVoice: document.getElementById('dubVoice'),
  dubDialect: document.getElementById('dubDialect'),
  dubSpeed: document.getElementById('dubSpeed'),
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

const DEFAULT_SITES = [
  { name:'Easemate Chat', url:'https://www.easemate.ai/webapp/chat' },
  { name:'Whoer', url:'https://whoer.net/' },
  { name:'AI Humanizer', url:'https://bypassai.writecream.com/' },
  { name:'Prinsh Notepad', url:'https://notepad.prinsh.com/' }
];

const IFLYTEK_LANGS = [
  'Arabic', 'English', 'Chinese', 'Japanese', 'German', 'Spanish',
  'Korean', 'Russian', 'French', 'Portuguese', 'Italian', 'Hindi',
  'Thai', 'Vietnamese', 'Indonesian', 'Turkish'
];

const DEFAULT_VOICES = ['Male Voice 1', 'Female Voice 1'];
const DEFAULT_DIALECTS = ['Default'];

function notify(msg, isErr = false) {
  // Add guard to prevent errors if the status element is missing.
  if (!els.status) return;
  els.status.textContent = msg;
  els.status.className = 'status' + (isErr ? ' error' : '');
}

async function load() {
  try {
    const s = await chrome.storage.local.get([
      'cerebrasApiKey',
      'cerebrasModel',
      'ocrApiKey',
      'ipdataApiKey',
      'typingSpeed',
      'ocrLang',
      'iflytekAppId',
      'iflytekApiKey',
      'iflytekApiSecret',
      'dubDefaultLang',
      'dubVoice',
      'dubDialect',
      'dubSpeed',
      'customWebSize',
    ]);

    els.cerebrasKey.value    = s.cerebrasApiKey || '';
    els.cerebrasModel.value  = s.cerebrasModel || 'gpt-oss-120b';
    els.ocrKey.value         = s.ocrApiKey || '';
    els.ipdataKey.value      = s.ipdataApiKey || '';
    els.typingSpeed.value    = s.typingSpeed || 'normal';
    els.ocrLang.value        = s.ocrLang || 'eng';
    populateLanguages();
    els.iflytekAppId.value  = s.iflytekAppId || '';
    els.iflytekApiKey.value = s.iflytekApiKey || '';
    els.iflytekApiSecret.value = s.iflytekApiSecret || '';
    els.dubLang.value       = s.dubDefaultLang || 'English';
    populateVoices();
    populateDialects();
    els.dubVoice.value      = s.dubVoice || DEFAULT_VOICES[0];
    els.dubDialect.value    = s.dubDialect || DEFAULT_DIALECTS[0];
    els.dubSpeed.value      = s.dubSpeed || 1;
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

function populateLanguages(){
  if(!els.dubLang) return;
  els.dubLang.innerHTML = '';
  IFLYTEK_LANGS.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l;
    opt.textContent = l;
    els.dubLang.appendChild(opt);
  });
}

function populateVoices(){
  if(!els.dubVoice) return;
  els.dubVoice.innerHTML = '';
  DEFAULT_VOICES.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    els.dubVoice.appendChild(opt);
  });
}

function populateDialects(){
  if(!els.dubDialect) return;
  els.dubDialect.innerHTML = '';
  DEFAULT_DIALECTS.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    els.dubDialect.appendChild(opt);
  });
}

let editingId = null;

async function loadPrompts() {
  const { customPrompts = [] } = await chrome.storage.sync.get('customPrompts');
  renderPromptTable(customPrompts);
}

async function loadSites(){
  let { customSites = [] } = await chrome.storage.local.get('customSites');
  if(!customSites.length){
    customSites = DEFAULT_SITES;
    await chrome.storage.local.set({ customSites });
  }
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
      cerebrasApiKey:    els.cerebrasKey.value.trim(),
      cerebrasModel:     els.cerebrasModel.value,
      ocrApiKey:         els.ocrKey.value.trim(),
      ipdataApiKey:      els.ipdataKey.value.trim(),
      typingSpeed:       els.typingSpeed.value,
      ocrLang:           els.ocrLang.value,
      iflytekAppId:      els.iflytekAppId.value.trim(),
      iflytekApiKey:     els.iflytekApiKey.value.trim(),
      iflytekApiSecret:  els.iflytekApiSecret.value.trim(),
      dubDefaultLang:    els.dubLang.value,
      dubVoice:          els.dubVoice.value,
      dubDialect:        els.dubDialect.value,
      dubSpeed:          Number(els.dubSpeed.value) || 1,
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
    // Simple test via Cerebras backend
    const res = await chrome.runtime.sendMessage({
      type: 'CEREBRAS_GENERATE',
      prompt: 'Respond with: OK'
    });
    if (!res?.ok) throw new Error(res?.error || 'Cerebras failed');
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