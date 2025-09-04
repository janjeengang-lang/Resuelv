// popup.js

  const els = {
    status: document.getElementById('status'),
    preview: document.getElementById('preview'),
    btnWrite: document.getElementById('btnWrite'),
    btnCopy: document.getElementById('btnCopy'),
    openOptions: document.getElementById('openOptions'),
    openCustomWeb: document.getElementById('openCustomWeb'),
    openActivityLog: document.getElementById('openActivityLog'),
    ipInfoText: document.getElementById('ipInfoText'),
    btnCustomPrompt: document.getElementById('btnCustomPrompt'),
    btnUseLastPrompt: document.getElementById('btnUseLastPrompt'),
    userEmail: document.getElementById('userEmail'),
    sessionTimer: document.getElementById('sessionTimer'),
    logoutBtn: document.getElementById('logoutBtn'),
  };

(async function initSession(){
  const { loggedIn, userEmail, loginTime } = await chrome.storage.local.get(['loggedIn','userEmail','loginTime']);
  if (!loggedIn) { window.location.href = 'login.html'; return; }
  const res = await chrome.runtime.sendMessage({ type: 'CHECK_AUTH' });
  if (!res?.ok) { window.location.href = 'login.html'; return; }
  els.userEmail.textContent = userEmail || '';
  startCountdown(loginTime);
})();

function startCountdown(loginTime){
  if(!loginTime) return;
  const end = loginTime + 3*60*60*1000;
  const tick = async () => {
    const diff = end - Date.now();
    if(diff <= 0){
      els.sessionTimer.textContent = '00:00:00';
      await chrome.runtime.sendMessage({ type:'LOGOUT', reason:'Session expired' });
      window.location.href = 'login.html';
      return;
    }
    const h = Math.floor(diff/3600000);
    const m = Math.floor((diff%3600000)/60000);
    const s = Math.floor((diff%60000)/1000);
    els.sessionTimer.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
    setTimeout(tick,1000);
  };
  tick();
}

function pad(n){ return String(n).padStart(2,'0'); }

els.logoutBtn?.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type:'LOGOUT', reason:'Logged out' });
  window.location.href = 'login.html';
});

const btnMap = {
  btnOpen: 'open',
  btnMCQ: 'mcq',
  btnScale: 'scale',
  btnYesNo: 'yesno',
  btnAuto: 'auto',
  btnOCR: 'ocr',
  btnTranslate: 'translate',
  btnReset: 'reset'
};

let lastQuestion = '';

// Navigation state
let currentPage = 0;
const buttonsPerPage = 3;
const allButtons = ['btnOpen', 'btnMCQ', 'btnScale', 'btnYesNo', 'btnAuto', 'btnOCR', 'btnTranslate'];

function updateButtonVisibility() {
  const startIndex = currentPage * buttonsPerPage;
  const endIndex = startIndex + buttonsPerPage;

  allButtons.forEach((btnId, index) => {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.style.display = (index >= startIndex && index < endIndex) ? 'flex' : 'none';
    }
  });

  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  if (prevBtn) prevBtn.disabled = currentPage === 0;
  if (nextBtn) nextBtn.disabled = (currentPage + 1) * buttonsPerPage >= allButtons.length;
}

document.getElementById('prevBtn')?.addEventListener('click', () => {
  if (currentPage > 0) {
    currentPage--;
    updateButtonVisibility();
  }
});

document.getElementById('nextBtn')?.addEventListener('click', () => {
  if ((currentPage + 1) * buttonsPerPage < allButtons.length) {
    currentPage++;
    updateButtonVisibility();
  }
});

for (const id of Object.keys(btnMap)) {
  document.getElementById(id)?.addEventListener('click', () => handleMode(btnMap[id]));
}

updateButtonVisibility();

  els.openOptions?.addEventListener('click', () => chrome.runtime.openOptionsPage());
  els.openCustomWeb?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    await chrome.runtime.sendMessage({ type:'OPEN_CUSTOM_WEB', openerTabId: tab.id });
  });
  els.openActivityLog?.addEventListener('click', () => {
    window.location.href = 'history.html';
  });


async function handleMode(mode){
    if (mode === 'reset') {
      await chrome.storage.local.set({ contextQA: [] });
      return notify('Context cleared');
    }

  if (mode === 'ocr') {
    try {
      const tab = await getActiveTab();
      await ensureContentScript(tab.id);
      const rectRes = await chrome.tabs.sendMessage(tab.id, { type: 'START_OCR_SELECTION' });
      if (!rectRes?.width || !rectRes?.height) throw new Error('OCR canceled');
      const { ocrLang='eng' } = await chrome.storage.local.get('ocrLang');
      const ocr = await chrome.runtime.sendMessage({ type:'CAPTURE_AND_OCR', rect: rectRes, tabId: tab.id, ocrLang });
      if (!ocr?.ok) throw new Error(ocr?.error||'OCR failed');
      els.preview.value = ocr.text;
      lastQuestion = ocr.text;
      notify('OCR completed');
    } catch(e){ notify('OCR failed: ' + String(e?.message||e), true); }
    return;
  }
  if (mode === 'translate') { notify('Translation feature coming soon!'); return; }

  setBusy(true); notify('');
  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);

    let questionText = (await getSelectedOrDomText(tab.id)).trim();
    if (!questionText || questionText.length < 2){
      const rectRes = await chrome.tabs.sendMessage(tab.id, { type: 'START_OCR_SELECTION' });
      if (!rectRes?.width || !rectRes?.height) throw new Error('OCR canceled');
      const { ocrLang='eng' } = await chrome.storage.local.get('ocrLang');
      const ocr = await chrome.runtime.sendMessage({ type:'CAPTURE_AND_OCR', rect: rectRes, tabId: tab.id, ocrLang });
      if (!ocr?.ok) throw new Error(ocr?.error||'OCR failed');
      questionText = ocr.text;
      if (!questionText) throw new Error('OCR returned empty text');
    }

    lastQuestion = questionText;

    const ctx   = await getContext();
    const prompt= buildPrompt(mode, questionText, ctx);
    const gen   = await chrome.runtime.sendMessage({ type:'CEREBRAS_GENERATE', prompt });

    if (!gen?.ok) throw new Error(gen?.error||'Generate failed');

    const answer = postProcess(mode, gen.result);
    els.preview.value = answer;

      await chrome.storage.local.set({ lastAnswer: answer });
      await saveContext({ q: questionText, a: answer, promptName: mode });
      notify('Ready');
  } catch(e){ notify(String(e?.message||e), true); }
  finally { setBusy(false); }
}

function buildPrompt(mode, question, context){
  const ctxLines = (context||[]).map((c,i)=>`Q${i+1}: ${c.q}\nA${i+1}: ${c.a}`).join('\n');
  const rules = `You are answering a survey question. Use prior context if helpful and choose answers that keep the participant qualified for the survey.\nSTRICT OUTPUT RULES:\n- Output ONLY the final answer; no extra words or punctuation unless part of the answer.\n- Language: match the question language.`;
  const tasks = {
    open: 'Open-ended: write 1-3 short natural sentences.',
    mcq: 'Multiple Choice: return the EXACT option text from the provided question/options.',
    scale: 'Scale: return ONLY a single integer (e.g., 1-5 or 1-10).',
    yesno: 'Yes/No: return ONLY "Yes" or "No".',
    auto: 'Auto-detect the type (Open-ended, MCQ, Scale, Yes/No) and answer accordingly.'
  };
  const task = tasks[mode] || tasks.auto;
  return `${rules}\n${task}\n\nPRIOR CONTEXT (last Q/A):\n${ctxLines || 'None'}\n\nQUESTION:\n${question}\n\nANSWER:`;
}

function postProcess(mode, t){
  const s = (t||'').trim(); if(!s) return '';
  if (mode==='scale'){ const m=s.match(/\b(10|[1-9])\b/); return m?m[0]: s.replace(/[^0-9]/g,'').slice(0,2); }
  if (mode==='yesno'){ if(/^y(es)?$/i.test(s)) return 'Yes'; if(/^no?$/i.test(s)) return 'No'; const w=s.split(/\s+/)[0]; if(/^y/i.test(w)) return 'Yes'; if(/^n/i.test(w)) return 'No'; return s; }
  if (mode==='mcq'){ return s.split(/\s*[\n,\r]\s*/)[0]; }
  return s;
}

async function runCustomPrompt(pr){
  if(!pr) return;
  if(!lastQuestion){
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);
    lastQuestion = (await getSelectedOrDomText(tab.id)).trim();
    if(!lastQuestion){ notify('No text for prompt', true); return; }
  }
  setBusy(true); notify('');
  try {
    const fullPrompt = pr.text + '\n\n' + lastQuestion;
    const gen = await chrome.runtime.sendMessage({ type:'CEREBRAS_GENERATE', prompt: fullPrompt });
    if (!gen?.ok) throw new Error(gen?.error||'Generate failed');
    const answer = gen.result.trim();
    els.preview.value = answer;
    await chrome.storage.local.set({ lastAnswer: answer, lastCustomPromptId: pr.id });
    await saveContext({ q: lastQuestion, a: answer, promptName: pr.name });
    notify('Ready');
  } catch(e){ notify(String(e?.message||e), true); }
  finally { setBusy(false); }
}

async function getActiveTab(){ const tabs = await chrome.tabs.query({active:true,currentWindow:true}); return tabs[0]; }
async function ensureContentScript(tabId){ try{ await chrome.tabs.sendMessage(tabId,{type:'PING'});}catch{ await chrome.scripting.executeScript({target:{tabId}, files:['content.js']}); await chrome.tabs.sendMessage(tabId,{type:'PING'});} }
async function getSelectedOrDomText(tabId){ const r = await chrome.tabs.sendMessage(tabId,{type:'GET_SELECTED_OR_DOM_TEXT'}); return r?.ok? r.text: ''; }
async function getContext(){ const o = await chrome.storage.local.get('contextQA'); return o.contextQA||[]; }
async function saveContext(entry){ const list = await getContext(); list.push(entry); while(list.length>50) list.shift(); await chrome.storage.local.set({contextQA:list}); }

function notify(msg,isErr=false){ els.status.textContent = msg; els.status.className = 'status' + (isErr?' error':''); }
function setBusy(on){ document.body.style.opacity = on? '0.8':'1'; }

els.btnCopy?.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(els.preview.value); notify('Copied'); }
  catch(e){ notify('Copy failed', true); }
});

els.btnWrite?.addEventListener('click', async () => {
  try {
    const tab = await getActiveTab();
    const { typingSpeed='normal' } = await chrome.storage.local.get('typingSpeed');
    await chrome.tabs.sendMessage(tab.id, { type:'TYPE_TEXT', text: els.preview.value, options: { speed: typingSpeed } });
    notify('Typed');
  } catch(e){ notify('Type failed: '+(e?.message||e), true); }
});

// Modal selector for custom prompt
async function choosePromptModal(){
  const { customPrompts=[] } = await chrome.storage.sync.get('customPrompts');
  if(!customPrompts.length){ notify('No custom prompts', true); return null; }

  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.id = 'prompt-modal';
    overlay.innerHTML = `
      <div class="pm-content">
        <div class="pm-header"><h3>Select Prompt</h3><button class="pm-close">&times;</button></div>
        <input id="pmFilter" class="pm-filter" placeholder="Filter by tag" />
        <div class="pm-list"></div>
        <div class="pm-actions">
          <button class="pm-run">Generate</button>
          <button class="pm-cancel">Cancel</button>
        </div>
      </div>`;
    const style = document.createElement('style');
    style.textContent = `
      #prompt-modal{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:9999;}
      #prompt-modal .pm-content{background:linear-gradient(135deg,#23272b 0%,#120f12 100%);border-radius:15px;border:3px solid #39ff14;box-shadow:0 10px 30px rgba(0,0,0,0.3);width:90%;max-width:400px;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;}
      #prompt-modal .pm-header{display:flex;justify-content:space-between;align-items:center;padding:15px 20px;border-bottom:1px solid #292d33;}
      #prompt-modal .pm-header h3{margin:0;color:#39ff14;font-size:18px;font-weight:bold;}
      #prompt-modal .pm-close{background:none;border:none;color:#e2e8f0;font-size:24px;cursor:pointer;}
      #prompt-modal .pm-filter{margin:15px 20px;padding:8px 12px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;}
      #prompt-modal .pm-list{flex:1;overflow-y:auto;padding:0 20px 10px;}
      #prompt-modal .pm-item{padding:8px 12px;border:1px solid #334155;border-radius:6px;margin-bottom:8px;cursor:pointer;}
      #prompt-modal .pm-item.selected{border-color:#ffd600;background:rgba(255,214,0,0.1);}
      #prompt-modal .pm-actions{display:flex;justify-content:flex-end;gap:10px;padding:10px 20px;border-top:1px solid #292d33;}
      #prompt-modal .pm-actions button{background:#1f2937;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:8px 16px;cursor:pointer;transition:filter .2s;}
      #prompt-modal .pm-actions button:hover{filter:brightness(1.1);} 
      #prompt-modal .pm-run{background:#22c55e;border-color:#22c55e;color:#0b1215;font-weight:600;}
    `;

    document.body.appendChild(overlay);
    document.head.appendChild(style);

    const listEl = overlay.querySelector('.pm-list');
    let filtered = [...customPrompts];
    let selectedId = null;

    const render = () => {
      listEl.innerHTML = filtered.map(p => `<div class="pm-item" data-id="${p.id}">${p.name}</div>`).join('');
      listEl.querySelectorAll('.pm-item').forEach(it => {
        it.addEventListener('click', () => {
          selectedId = it.dataset.id;
          listEl.querySelectorAll('.pm-item').forEach(x => x.classList.remove('selected'));
          it.classList.add('selected');
        });
      });
    };
    render();

    overlay.querySelector('#pmFilter').addEventListener('input', e => {
      const tag = e.target.value.trim();
      filtered = customPrompts.filter(p => !tag || (p.tags||[]).includes(tag));
      selectedId = null;
      render();
    });

    function close(){ overlay.remove(); style.remove(); }
    overlay.querySelector('.pm-close') .addEventListener('click', () => { close(); resolve(null); });
    overlay.querySelector('.pm-cancel').addEventListener('click', () => { close(); resolve(null); });
    overlay.addEventListener('click', e => { if (e.target === overlay) { close(); resolve(null); } });
    overlay.querySelector('.pm-run').addEventListener('click', () => {
      const pr = customPrompts.find(p => p.id === selectedId);
      if (!pr) { notify('Select a prompt', true); return; }
      close(); resolve(pr);
    });
  });
}

els.btnCustomPrompt?.addEventListener('click', async () => {
  const pr = await choosePromptModal();
  if (pr) runCustomPrompt(pr);
});

els.btnUseLastPrompt?.addEventListener('click', async () => {
  const { lastCustomPromptId } = await chrome.storage.local.get('lastCustomPromptId');
  if (!lastCustomPromptId) { notify('No last prompt', true); return; }
  const { customPrompts=[] } = await chrome.storage.sync.get('customPrompts');
  const pr = customPrompts.find(p => p.id === lastCustomPromptId);
  if (!pr) { notify('Prompt missing', true); return; }
  runCustomPrompt(pr);
});

async function loadIP(){
  try {
    const r = await chrome.runtime.sendMessage({ type:'GET_PUBLIC_IP' });
    if(!r?.ok) throw new Error(r?.error||'IP error');
    const { ip, country, city, postal, isp, timezone, fraud_score, proxy, vpn, tor } = r.info || {};
    els.ipInfoText.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
        <strong>IP:</strong> ${ip || 'Unknown'}
        <button onclick="navigator.clipboard.writeText('${ip || ''}')" style="background: #22c55e; border: none; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; cursor: pointer;">Copy</button>
      </div>
      <div><strong>Location:</strong> ${city || 'Unknown'}, ${country || 'Unknown'}</div>
      <div><strong>Postal:</strong> ${postal || 'Unknown'} | <strong>ISP:</strong> ${isp || 'Unknown'}</div>
      <div><strong>Fraud:</strong> ${fraud_score ?? 'Unknown'} | <strong>Proxy:</strong> ${proxy ?? 'Unknown'} | <strong>VPN:</strong> ${vpn ?? 'Unknown'} | <strong>Tor:</strong> ${tor ?? 'Unknown'}</div>
      <div><strong>Timezone:</strong> ${timezone || 'Unknown'}</div>
    `;
  } catch(e){
    els.ipInfoText.textContent = 'IP: unavailable';
  }
}

(async function init(){
  loadIP();
})();