// background.js (MV3 service worker)
// - OpenRouter chat completions
// - OCR via OCR.space
// - Public IP via ipdata with fallback services

const DEFAULTS = {
  openrouterModel: 'google/gemini-2.0-flash-exp:free',
  typingSpeed: 'normal', // fast | normal | slow
  ocrLang: 'eng',
};

const TM_BASE = 'https://api.mail.tm';
const TM_KEY = 'tempMail';
const TM_ALARM = 'TEMP_MAIL_POLL';

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const cur = await chrome.storage.local.get(Object.keys(DEFAULTS));
    const toSet = {};
    for (const [k, v] of Object.entries(DEFAULTS)) if (cur[k] === undefined) toSet[k] = v;
    if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
    
    // Create context menu
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: 'sendToResuelv',
      title: 'Send to Resuelv',
      contexts: ['selection'],
      documentUrlPatterns: ['<all_urls>']
    });
  } catch (e) {
    console.error('Error initializing defaults:', e);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'sendToResuelv' && info.selectionText) {
    try {
      // Ensure content script is injected
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      
      // Wait a bit for script to load
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'SHOW_RESUELV_MODAL',
            text: info.selectionText
          });
        } catch (e) {
          console.error('Error sending message to content script:', e);
        }
      }, 100);
    } catch (e) {
      console.error('Error injecting content script:', e);
    }
  }
});

initTempMail();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'GEMINI_GENERATE': {
          const result = await callOpenRouter(message.prompt);
          sendResponse({ ok: true, result });
          break;
        }
        case 'CAPTURE_AND_OCR': {
          const { rect, tabId, ocrLang } = message;
          const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
          let croppedDataUrl;
          try {
            croppedDataUrl = await cropImageInWorker(dataUrl, rect);
          } catch (e) {
            const cropResp = await chrome.tabs.sendMessage(tabId, {
              type: 'CROP_IMAGE_IN_CONTENT',
              dataUrl,
              rect
            });
            if (!cropResp?.ok) throw new Error('Crop fallback failed');
            croppedDataUrl = cropResp.dataUrl;
          }
          const text = await performOCR(croppedDataUrl, ocrLang);
          sendResponse({ ok: true, text });
          break;
        }
        case 'CAPTURE_FULL_PAGE_OCR': {
          const { tabId, ocrLang } = message;
          const text = await captureFullPageOCR(tabId, ocrLang);
          sendResponse(text);
          break;
        }
        case 'GET_PUBLIC_IP': {
          const info = await getPublicIP();
          sendResponse({ ok: true, info });
          break;
        }
        case 'TEST_IPDATA': {
          const info = await testIPData(message.key);
          sendResponse(info);
          break;
        }
        case 'SHOW_NOTIFICATION': {
          const { title, message: body } = message;
          if (title && body) {
            chrome.notifications.create('', {
              type: 'basic',
              iconUrl: 'icons/icon128.png',
              title,
              message: body
            });
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false, error: 'Missing fields' });
          }
          break;
        }
        case 'GET_TAB_ID': {
          const id = sender?.tab?.id || (await getActiveTabId());
          sendResponse({ ok: true, tabId: id });
          break;
        }
        case 'RUN_CUSTOM_PROMPT': {
          const { id, text } = message;
          const { customPrompts = [] } = await chrome.storage.sync.get('customPrompts');
          const pr = customPrompts.find(p => p.id === id);
          if (!pr) { sendResponse({ ok: false, error: 'Prompt not found' }); break; }
          const fullPrompt = pr.text + '\n\n' + text;
          const result = await callOpenRouter(fullPrompt);
          sendResponse({ ok: true, result, promptName: pr.name });
          break;
        }
        case 'GENERATE_FAKE_INFO': {
          const { gender, nat, force } = message;
          const data = await fetchRandomUser({ gender, nat, force });
          sendResponse({ ok: true, data });
          break;
        }
        case 'TM_GET_STATE': {
          const state = await getTempMailState();
          sendResponse({ ok: true, state });
          break;
        }
        case 'TM_CREATE': {
          const state = await createTempMailAccount();
          sendResponse({ ok: true, state });
          break;
        }
        case 'TM_DELETE': {
          await deleteTempMailAccount();
          sendResponse({ ok: true });
          break;
        }
        case 'TM_EXTEND': {
          const expiry = await extendTempMail();
          sendResponse({ ok: true, expiry });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();
  return true; // async
});

async function callOpenRouter(prompt) {
  const { openrouterApiKey = '', openrouterModel, geminiApiKey = '', cerebrasApiKey = '', aiProvider = 'openrouter' } = await chrome.storage.local.get([
    'openrouterApiKey', 'openrouterModel', 'geminiApiKey', 'cerebrasApiKey', 'aiProvider'
  ]);

  if (aiProvider === 'gemini' && geminiApiKey) {
    return await callGemini(prompt, geminiApiKey);
  }
  if (aiProvider === 'cerebras' && cerebrasApiKey) {
    return await callCerebras(prompt, cerebrasApiKey);
  }

  if (!openrouterApiKey) {
    const e = new Error('Missing OpenRouter API key (set it in Options).');
    e.code = 401; throw e;
  }
  const model = openrouterModel || DEFAULTS.openrouterModel;
  const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2
  };
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${openrouterApiKey}`
  };
  const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  if (res.status === 401 || res.status === 403) {
    const t = await res.text().catch(() => '');
    const e = new Error('Unauthorized (401/403). ' + t);
    e.code = res.status; throw e;
  }
  if (res.status === 429) {
    const e = new Error('Rate limited (429). Try again later.');
    e.code = 429; throw e;
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`OpenRouter error ${res.status}: ${t}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  return sanitize(text);
}

async function callGemini(prompt, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;
  const body = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1000
    }
  };
  const headers = {
    'Content-Type': 'application/json'
  };
  const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Gemini error ${res.status}: ${t}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return sanitize(text);
}

async function callCerebras(prompt, apiKey) {
  // Cerebras currently exposes its chat completions API under the v1 path.
  // Using v2 returns 404 Not Found, so ensure we call the correct endpoint.
  const endpoint = 'https://api.cerebras.ai/v1/chat/completions';
  const body = {
    model: 'gpt-oss-120b',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_completion_tokens: 1024
  };
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };
  const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Cerebras error ${res.status}: ${t}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.delta?.content || '';
  return sanitize(text);
}

async function performOCR(imageDataUrl, lang) {
  const { ocrApiKey = '', ocrLang } = await chrome.storage.local.get(['ocrApiKey', 'ocrLang']);
  const language = lang || ocrLang || DEFAULTS.ocrLang;
  const endpoint = 'https://api.ocr.space/parse/image';
  const form = new FormData();
  form.append('language', language);
  form.append('isOverlayRequired', 'false');
  form.append('base64Image', imageDataUrl);
  if (ocrApiKey) form.append('apikey', ocrApiKey);
  const res = await fetch(endpoint, { method: 'POST', body: form });
  if (res.status === 429) throw new Error('OCR rate limited (429)');
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`OCR error ${res.status}: ${t}`);
  }
  const data = await res.json();
  const text = data?.ParsedResults?.[0]?.ParsedText || '';
  return sanitize(text);
}

async function captureFullPageOCR(tabId, ocrLang) {
  try {
    const dims = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_DIMENSIONS' });
    const shots = [];
    for (let y = 0; y < dims.height; y += dims.viewHeight) {
      await chrome.tabs.sendMessage(tabId, { type: 'SCROLL_TO', y });
      await new Promise(r => setTimeout(r, 300));
      shots.push(await chrome.tabs.captureVisibleTab({ format: 'png' }));
    }
    await chrome.tabs.sendMessage(tabId, { type: 'SCROLL_TO', y: 0 });
    const stitched = await stitchImages(shots);
    const text = await performOCR(stitched, ocrLang);
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function stitchImages(images) {
  const bitmaps = await Promise.all(images.map(async dataUrl => {
    const blob = await (await fetch(dataUrl)).blob();
    return await createImageBitmap(blob);
  }));
  const width = Math.max(...bitmaps.map(b => b.width));
  const totalHeight = bitmaps.reduce((s, b) => s + b.height, 0);
  const canvas = new OffscreenCanvas(width, totalHeight);
  const ctx = canvas.getContext('2d');
  let y = 0;
  for (const bmp of bitmaps) {
    ctx.drawImage(bmp, 0, y);
    y += bmp.height;
  }
  const blob = await canvas.convertToBlob();
  return await blobToDataURL(blob);
}

function blobToDataURL(blob) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function getPublicIP() {
  const { ipdataApiKey = '' } = await chrome.storage.local.get('ipdataApiKey');
  if (ipdataApiKey) {
    try {
      const data = await fetchIPData(ipdataApiKey);
      return {
        ip: data?.ip || 'Unknown',
        country: data?.country_name || data?.country_code || 'Unknown',
        city: data?.city || 'Unknown',
        postal: data?.postal || 'Unknown',
        isp: data?.asn?.name || 'Unknown',
        timezone: data?.time_zone?.name || 'Unknown',
        raw: data
      };
    } catch (e) {
      console.error('ipdata error:', e);
    }
  }

  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };

  const services = [
    {
      url: 'https://ipapi.co/json/',
      map: (d) => ({
        ip: d?.ip,
        country: d?.country_name || d?.country,
        city: d?.city,
        postal: d?.postal,
        isp: d?.org,
        timezone: d?.timezone
      })
    },
    {
      url: 'https://ipinfo.io/json',
      map: (d) => ({
        ip: d?.ip,
        country: d?.country,
        city: d?.city,
        postal: d?.postal,
        isp: d?.org,
        timezone: d?.timezone
      })
    },
    {
      url: 'https://ip-api.com/json/',
      map: (d) => ({
        ip: d?.query,
        country: d?.country,
        city: d?.city,
        postal: d?.zip,
        isp: d?.isp,
        timezone: d?.timezone
      })
    }
  ];

  for (const svc of services) {
    try {
      const res = await fetch(svc.url, { method: 'GET', headers });
      if (!res.ok) throw new Error(`IP API failed: ${res.status}`);
      const data = await res.json();
      if (data?.error) throw new Error(data.error);
      const info = svc.map(data);
      if (info && info.ip) {
        return {
          ip: info.ip || 'Unknown',
          country: info.country || 'Unknown',
          city: info.city || 'Unknown',
          postal: info.postal || 'Unknown',
          timezone: info.timezone || 'Unknown',
          isp: info.isp || 'Unknown'
        };
      }
    } catch (e) {
      console.error('IP service error:', svc.url, e);
    }
  }

  // Final fallback: ipify for IP only
  try {
    const r = await fetch('https://api.ipify.org?format=json');
    if (r.ok) {
      const d = await r.json();
      return {
        ip: d?.ip || 'Unknown',
        country: 'Unknown',
        city: 'Unknown',
        postal: 'Unknown',
        timezone: 'Unknown',
        isp: 'Unknown'
      };
    }
  } catch (e) {
    console.error('Fallback IP fetch error:', e);
  }
  throw new Error('Unable to retrieve IP information');
}

async function fetchIPData(key) {
  const url = `https://api.ipdata.co/?api-key=${key}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`ipdata API failed: ${res.status}`);
  return await res.json();
}

async function testIPData(key) {
  try {
    const data = await fetchIPData(key);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function fetchRandomUser({ gender = '', nat = '', force = false } = {}) {
  const cacheKey = `fi_${gender || 'any'}_${nat || 'any'}`;
  const { fakeCache = {} } = await chrome.storage.local.get('fakeCache');
  if (!force) {
    const entry = fakeCache[cacheKey];
    if (entry && Date.now() - entry.ts < 5 * 60 * 1000) {
      return entry.data;
    }
  }

  const url = new URL('https://randomuser.me/api/');
  if (gender) url.searchParams.set('gender', gender);
  if (nat) url.searchParams.set('nat', nat);
  url.searchParams.set('noinfo', '');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`RandomUser API failed: ${res.status}`);
  const data = await res.json();
  const user = data?.results?.[0];
  if (!user) throw new Error('RandomUser returned no data');
  fakeCache[cacheKey] = { ts: Date.now(), data: user };
  await chrome.storage.local.set({ fakeCache });
  return user;
}

function sanitize(s) {
  return (s || '')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .replace(/[\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function cropImageInWorker(dataUrl, rect) {
  if (typeof OffscreenCanvas === 'undefined') throw new Error('No OffscreenCanvas');
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const sx = Math.max(0, Math.round(rect.x * rect.dpr));
  const sy = Math.max(0, Math.round(rect.y * rect.dpr));
  const sw = Math.min(bitmap.width - sx, Math.round(rect.width * rect.dpr));
  const sh = Math.min(bitmap.height - sy, Math.round(rect.height * rect.dpr));
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  const out = await canvas.convertToBlob({ type: 'image/png' });
  const arr = await out.arrayBuffer();
  const base64 = arrayBufferToBase64(arr);
  return `data:image/png;base64,${base64}`;
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0]?.id || 0;
}

// ---- Temporary Mail (mail.tm) integration ----
async function tmHttpError(res) {
  if (!res.ok) {
    const map = { 400: 'Bad Request', 401: 'Unauthorized', 429: 'Too Many Requests' };
    const txt = map[res.status] || res.statusText || '';
    throw new Error(`Error ${res.status}${txt ? ': ' + txt : ''}`);
  }
  return res;
}

async function getTempMailState() {
  const { [TM_KEY]: data } = await chrome.storage.local.get(TM_KEY);
  return data || null;
}

async function saveTempMailState(data) {
  await chrome.storage.local.set({ [TM_KEY]: data });
}

async function clearTempMailState() {
  await chrome.storage.local.remove(TM_KEY);
}

function scheduleTempMail() {
  chrome.alarms.create(TM_ALARM, { periodInMinutes: 0.5 });
}

function clearTempMailSchedule() {
  chrome.alarms.clear(TM_ALARM);
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === TM_ALARM) pollTempMail();
});

async function initTempMail() {
  const state = await getTempMailState();
  if (state?.account) scheduleTempMail();
}

async function createTempMailAccount() {
  const domRes = await tmHttpError(await fetch(`${TM_BASE}/domains`));
  const domData = await domRes.json();
  const domains = domData['hydra:member'] || [];
  if (!domains.length) throw new Error('No domains available');
  const domain = domains[Math.floor(Math.random() * domains.length)].domain;
  const username = Math.random().toString(36).slice(2, 10);
  const password = Math.random().toString(36).slice(2, 10);
  const address = `${username}@${domain}`;
  const accRes = await tmHttpError(await fetch(`${TM_BASE}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, password })
  }));
  const accData = await accRes.json();
  const tokRes = await tmHttpError(await fetch(`${TM_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, password })
  }));
  const tokData = await tokRes.json();
  const state = {
    account: { id: accData.id, address, token: tokData.token },
    messages: [],
    expiry: Date.now() + 7 * 24 * 60 * 60 * 1000
  };
  await saveTempMailState(state);
  scheduleTempMail();
  await pollTempMail(true);
  return state;
}

async function deleteTempMailAccount() {
  const state = await getTempMailState();
  if (state?.account) {
    try {
      await fetch(`${TM_BASE}/accounts/${state.account.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${state.account.token}` }
      });
    } catch (_) { }
  }
  clearTempMailSchedule();
  await clearTempMailState();
}

async function extendTempMail() {
  const state = await getTempMailState();
  if (!state?.account) throw new Error('No mailbox');
  const now = Date.now();
  state.expiry = Math.max(state.expiry || 0, now) + 7 * 24 * 60 * 60 * 1000;
  await saveTempMailState(state);
  return state.expiry;
}

async function pollTempMail(silent = false) {
  const state = await getTempMailState();
  if (!state?.account) return;
  if (Date.now() > state.expiry) {
    await deleteTempMailAccount();
    return;
  }
  try {
    const res = await tmHttpError(await fetch(`${TM_BASE}/messages`, {
      headers: { Authorization: `Bearer ${state.account.token}` }
    }));
    const data = await res.json();
    const msgs = data['hydra:member'] || [];
    const oldIds = new Set(state.messages.map(m => m.id));
    const newMsgs = msgs.filter(m => !oldIds.has(m.id));
    if (!silent) {
      for (const m of newMsgs) {
        chrome.notifications.create('', {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: m.from?.address || 'Temp Mail',
          message: m.subject || ''
        });
      }
    }
    state.messages = msgs;
    await saveTempMailState(state);
  } catch (e) {
    console.error('Temp mail poll error', e);
  }
}