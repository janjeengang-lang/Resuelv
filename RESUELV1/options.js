// options.js
const els = {
  aiProvider: document.getElementById('aiProvider'),
  openrouterKey: document.getElementById('openrouterKey'),
  openrouterModel: document.getElementById('openrouterModel'),
  geminiKey: document.getElementById('geminiKey'),
  ocrKey: document.getElementById('ocrKey'),
  typingSpeed: document.getElementById('typingSpeed'),
  ocrLang: document.getElementById('ocrLang'),
  test: document.getElementById('test'),
  save: document.getElementById('save'),
  clear: document.getElementById('clear'),
  status: document.getElementById('status'),
};

function notify(msg, isErr=false){ els.status.textContent = msg; els.status.className = 'status' + (isErr?' error':''); }

async function load(){
  try {
    const s = await chrome.storage.local.get(['aiProvider','openrouterApiKey','openrouterModel','geminiApiKey','ocrApiKey','typingSpeed','ocrLang']);
    els.aiProvider.value = s.aiProvider || 'openrouter';
    els.openrouterKey.value = s.openrouterApiKey || '';
    els.openrouterModel.value = s.openrouterModel || 'google/gemini-2.0-flash-exp:free';
    els.geminiKey.value = s.geminiApiKey || '';
    els.ocrKey.value = s.ocrApiKey || '';
    els.typingSpeed.value = s.typingSpeed || 'normal';
    els.ocrLang.value = s.ocrLang || 'eng';
    console.log('Settings loaded successfully');
  } catch (e) {
    console.error('Error loading settings:', e);
    notify('Error loading settings: ' + e.message, true);
  }
}

els.save.addEventListener('click', async () => {
  try {
    await chrome.storage.local.set({
      aiProvider: els.aiProvider.value,
      openrouterApiKey: els.openrouterKey.value.trim(),
      openrouterModel: els.openrouterModel.value,
      geminiApiKey: els.geminiKey.value.trim(),
      ocrApiKey: els.ocrKey.value.trim(),
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

els.clear.addEventListener('click', async () => {
  await chrome.storage.local.clear();
  await load();
  notify('Cleared');
});

els.test.addEventListener('click', async () => {
  try {
    notify('Testing…');
    const res = await chrome.runtime.sendMessage({ type:'GEMINI_GENERATE', prompt: 'Respond with: OK' });
    if (!res?.ok) throw new Error(res?.error||'OpenRouter failed');
    if (!/\bOK\b/i.test(res.result)) notify('API responded, not strictly OK: ' + res.result);
    else notify('API OK');
  } catch(e){ notify(String(e?.message||e), true); }
});

load();

