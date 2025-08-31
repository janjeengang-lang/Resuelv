// popup.js
const els = {
  status: document.getElementById('status'),
  preview: document.getElementById('preview'),
  btnWrite: document.getElementById('btnWrite'),
  btnCopy: document.getElementById('btnCopy'),
  openOptions: document.getElementById('openOptions'),
  history: document.getElementById('history'),
  ipInfoText: document.getElementById('ipInfoText'),
};

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
  
  // Update navigation buttons
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  
  if (prevBtn) prevBtn.disabled = currentPage === 0;
  if (nextBtn) nextBtn.disabled = (currentPage + 1) * buttonsPerPage >= allButtons.length;
}

// Navigation event listeners
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

// Initialize button visibility
updateButtonVisibility();

els.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

async function handleMode(mode){
  if (mode === 'reset') { await chrome.storage.local.set({ contextQA: [] }); renderHistory([]); return notify('Context cleared'); }
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
      notify('OCR completed');
    } catch(e){ notify('OCR failed: ' + String(e?.message||e), true); }
    return;
  }
  if (mode === 'translate') {
    notify('Translation feature coming soon!');
    return;
  }
  
  setBusy(true); notify('');
  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);
    let questionText = (await getSelectedOrDomText(tab.id)).trim();
    if (!questionText || questionText.length < 2){
      // OCR path
      const rectRes = await chrome.tabs.sendMessage(tab.id, { type: 'START_OCR_SELECTION' });
      if (!rectRes?.width || !rectRes?.height) throw new Error('OCR canceled');
      const { ocrLang='eng' } = await chrome.storage.local.get('ocrLang');
      const ocr = await chrome.runtime.sendMessage({ type:'CAPTURE_AND_OCR', rect: rectRes, tabId: tab.id, ocrLang });
      if (!ocr?.ok) throw new Error(ocr?.error||'OCR failed');
      questionText = ocr.text;
      if (!questionText) throw new Error('OCR returned empty text');
    }
    const ctx = await getContext();
    const prompt = buildPrompt(mode, questionText, ctx);
    const gen = await chrome.runtime.sendMessage({ type:'GEMINI_GENERATE', prompt });
    if (!gen?.ok) throw new Error(gen?.error||'Generate failed');
    const answer = postProcess(mode, gen.result);
    els.preview.value = answer;
    await chrome.storage.local.set({ lastAnswer: answer });
    await saveContext({ q: questionText, a: answer });
    renderHistory(await getContext());
    notify('Ready');
  } catch(e){ notify(String(e?.message||e), true); }
  finally { setBusy(false); }
}

function buildPrompt(mode, question, context){
  const ctxLines = (context||[]).slice(-5).map((c,i)=>`Q${i+1}: ${c.q}\nA${i+1}: ${c.a}`).join('\n');
  const rules = `You are answering a survey question. Use prior context if helpful.\nSTRICT OUTPUT RULES:\n- Output ONLY the final answer; no extra words or punctuation unless part of the answer.\n- Language: match the question language.`;
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

async function getActiveTab(){ const tabs = await chrome.tabs.query({active:true,currentWindow:true}); return tabs[0]; }
async function ensureContentScript(tabId){ try{ await chrome.tabs.sendMessage(tabId,{type:'PING'});}catch{ await chrome.scripting.executeScript({target:{tabId}, files:['content.js']}); await chrome.tabs.sendMessage(tabId,{type:'PING'});} }
async function getSelectedOrDomText(tabId){ const r = await chrome.tabs.sendMessage(tabId,{type:'GET_SELECTED_OR_DOM_TEXT'}); return r?.ok? r.text: ''; }
async function getContext(){ const o = await chrome.storage.local.get('contextQA'); return o.contextQA||[]; }
async function saveContext(entry){ const list = await getContext(); list.push(entry); while(list.length>5) list.shift(); await chrome.storage.local.set({contextQA:list}); }

function notify(msg,isErr=false){ els.status.textContent = msg; els.status.className = 'status' + (isErr?' error':''); }
function setBusy(on){ document.body.style.opacity = on? '0.8':'1'; }

els.btnCopy.addEventListener('click', async () => { try{ await navigator.clipboard.writeText(els.preview.value); notify('Copied'); } catch(e){ notify('Copy failed', true); } });
els.btnWrite.addEventListener('click', async () => {
  try {
    const tab = await getActiveTab();
    const { typingSpeed='normal' } = await chrome.storage.local.get('typingSpeed');
    await chrome.tabs.sendMessage(tab.id, { type:'TYPE_TEXT', text: els.preview.value, options: { speed: typingSpeed } });
    notify('Typed');
  } catch(e){ notify('Type failed: '+(e?.message||e), true); }
});

async function loadIP(){
  try {
    const r = await chrome.runtime.sendMessage({ type:'GET_PUBLIC_IP' });
    if(!r?.ok) throw new Error(r?.error||'IP error');
    const { ip, country, city, postal, isp, timezone } = r.info || {};
    els.ipInfoText.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
        <strong>IP:</strong> ${ip || 'Unknown'}
        <button onclick="navigator.clipboard.writeText('${ip || ''}')" style="background: #22c55e; border: none; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; cursor: pointer;">Copy</button>
      </div>
      <div><strong>Location:</strong> ${city || 'Unknown'}, ${country || 'Unknown'}</div>
      <div><strong>Postal:</strong> ${postal || 'Unknown'} | <strong>ISP:</strong> ${isp || 'Unknown'}</div>
      <div><strong>Timezone:</strong> ${timezone || 'Unknown'}</div>
    `;
  }
  catch(e){
    els.ipInfoText.textContent = 'IP: unavailable';
  }
}

function renderHistory(list){ const items = (list||[]).slice(-5).map(x=>`- ${x.q} → ${x.a}`).join('\n'); els.history.textContent = items || 'No history'; }

(async function init(){ renderHistory(await getContext()); loadIP(); })();

