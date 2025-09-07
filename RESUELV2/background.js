// background.js (MV3 service worker)
// - Cerebras chat completions
// - OCR via OCR.space
// - Public IP via ipdata with fallback services

const DEFAULTS = {
  cerebrasModel: 'gpt-oss-120b',
  typingSpeed: 'normal', // fast | normal | slow
  ocrLang: 'eng',
};

const SESSION_DURATION = 3 * 60 * 60 * 1000; // 3 hours

const transcriptCache = {}; // tabId -> last caption XML

chrome.webRequest.onCompleted.addListener(async details => {
  try {
    if (details.tabId < 0) return;
    if (/timedtext|\.srv1|\.srv2|\.srv3|get_transcript/.test(details.url)) {
      const resp = await fetch(details.url);
      const text = await resp.text();
      transcriptCache[details.tabId] = text;
    }
  } catch (e) {
    console.error('Transcript capture error:', e);
  }
}, { urls: ['https://www.youtube.com/*'] });

async function forceLogout(reason = 'Your session has expired. Please log in again.') {
  await chrome.storage.local.remove(['loggedIn', 'loginTime', 'userEmail', 'idToken', 'refreshToken', 'lastAuthCheck']);
  await chrome.storage.local.set({ logoutMsg: reason });
  updatePopup();
  updateContextMenu();
}

async function checkSession() {
  const { loggedIn, loginTime } = await chrome.storage.local.get(['loggedIn', 'loginTime']);
  if (!loggedIn || !loginTime) {
    await forceLogout();
    return { ok: false };
  }
  const remaining = SESSION_DURATION - (Date.now() - loginTime);
  if (remaining <= 0) {
    await forceLogout();
    return { ok: false };
  }
  return { ok: true, remaining };
}

async function updatePopup() {
  const { loggedIn } = await chrome.storage.local.get('loggedIn');
  const popup = loggedIn ? 'popup.html' : 'login.html';
  await chrome.action.setPopup({ popup });
}

async function updateContextMenu() {
  const { loggedIn } = await chrome.storage.local.get('loggedIn');
  await chrome.contextMenus.removeAll();
  if (loggedIn) {
    chrome.contextMenus.create({
      id: 'sendToZepra',
      title: 'Send to Zepra',
      contexts: ['selection'],
      documentUrlPatterns: ['<all_urls>']
    });
  }
}

updatePopup();
updateContextMenu();
checkSession();
chrome.runtime.onStartup.addListener(() => {
  updatePopup();
  updateContextMenu();
  checkSession();
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.loggedIn) {
    updatePopup();
    updateContextMenu();
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const cur = await chrome.storage.local.get(Object.keys(DEFAULTS));
    const toSet = {};
    for (const [k, v] of Object.entries(DEFAULTS)) if (cur[k] === undefined) toSet[k] = v;
    if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
  } catch (e) {
    console.error('Error initializing defaults:', e);
  }
  updatePopup();
  updateContextMenu();
  checkSession();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'sendToZepra' && info.selectionText) {
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
            type: 'SHOW_ZEPRA_MODAL',
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'CEREBRAS_GENERATE': {
          const result = await callCerebras(message.prompt);
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
        case 'CHECK_AUTH': {
          const res = await checkSession();
          sendResponse(res);
          break;
        }
        case 'LOGOUT': {
          await forceLogout(message.reason || 'Logged out');
          sendResponse({ ok: true });
          break;
        }
        case 'GET_PUBLIC_IP': {
          const info = await getPublicIP();
          sendResponse({ ok: true, info });
          break;
        }
        case 'GET_IP_QUALIFICATION': {
          try {
            const resp = await fetch('https://ip-score.com/fulljson');
            const data = await resp.json();
            sendResponse({ ok: true, data });
          } catch (err) {
            sendResponse({ ok: false, error: err?.message || String(err) });
          }
          break;
        }
        case 'IFLYTEK_TTS': {
          try {
            const audio = await callIflytekTTS(message.text, message.opts || {});
            sendResponse({ ok: true, audio });
          } catch (e) {
            sendResponse({ ok: false, error: e.message });
          }
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
        case 'OPEN_CUSTOM_WEB': {
          const openerTabId = message.openerTabId || sender?.tab?.id || (await getActiveTabId());
          const { customWebSize = { width: 1000, height: 800 } } = await chrome.storage.local.get('customWebSize');
          let url = `custom_web.html?tabId=${openerTabId}`;
          if (message.initialUrl) url += `&url=${encodeURIComponent(message.initialUrl)}`;
          if (message.urls) url += `&urls=${encodeURIComponent(JSON.stringify(message.urls))}`;
          await chrome.windows.create({
            url: chrome.runtime.getURL(url),
            type: 'popup',
            width: customWebSize.width || 1000,
            height: customWebSize.height || 800
          });
          sendResponse({ ok: true });
          break;
        }
        case 'GET_CAPTURED_TRANSCRIPT': {
          const xml = transcriptCache[sender.tab?.id];
          sendResponse({ xml: xml || null });
          break;
        }
        case 'OPEN_OR_FOCUS_CUSTOM_WEB': {
          const siteUrl = message.url;
          const openerTabId = message.openerTabId || sender?.tab?.id || (await getActiveTabId());
          const { customWebSize = { width: 1000, height: 800 } } = await chrome.storage.local.get('customWebSize');
          const encoded = encodeURIComponent(siteUrl || '');
          const wins = await chrome.windows.getAll({ populate: true });
          for (const win of wins) {
            const tab = (win.tabs || []).find(t => t.url && t.url.includes('custom_web.html') && t.url.includes(`url=${encoded}`));
            if (tab) {
              await chrome.windows.update(win.id, { focused: true });
              await chrome.tabs.update(tab.id, { active: true });
              sendResponse({ ok: true, focused: true });
              return;
            }
          }
          await chrome.windows.create({
            url: chrome.runtime.getURL(`custom_web.html?tabId=${openerTabId}&url=${encoded}`),
            type: 'popup',
            width: customWebSize.width || 1000,
            height: customWebSize.height || 800
          });
          sendResponse({ ok: true, created: true });
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
          const result = await callCerebras(fullPrompt);
          sendResponse({ ok: true, result, promptName: pr.name });
          break;
        }
        case 'GENERATE_FAKE_INFO': {
          const { gender, nat, force } = message;
          const data = await fetchRandomUser({ gender, nat, force });
          sendResponse({ ok: true, data });
          break;
        }
        case 'GENERATE_REAL_ADDRESS': {
          const { country = '', state = '', city = '' } = message;
          const prompt = `Generate a real mailing address based on the following details.\nCountry: ${country}\nState/Province: ${state}\nCity/Zip Code: ${city}\nRespond ONLY with a JSON object: {"address_1": "", "address_2": "", "zip_code": ""}`;
          const result = await callCerebras(prompt);
          sendResponse({ ok: true, result });
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

async function callCerebras(prompt) {
  const { cerebrasApiKey = '', cerebrasModel } = await chrome.storage.local.get([
    'cerebrasApiKey', 'cerebrasModel'
  ]);
  if (!cerebrasApiKey) {
    const e = new Error('Missing Cerebras API key (set it in Options).');
    e.code = 401;
    throw e;
  }
  const model = cerebrasModel || DEFAULTS.cerebrasModel;
  const endpoint = 'https://api.cerebras.ai/v1/chat/completions';
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_completion_tokens: 1024
  };
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cerebrasApiKey}`
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

async function callIflytekTTS(text, opts) {
  const cfg = await chrome.storage.local.get([
    'iflytekAppId', 'iflytekApiKey', 'iflytekApiSecret',
    'dubVoice', 'dubDialect', 'dubSpeed'
  ]);
  const appId = cfg.iflytekAppId || '';
  const apiKey = cfg.iflytekApiKey || '';
  const apiSecret = cfg.iflytekApiSecret || '';
  if (!appId || !apiKey || !apiSecret) throw new Error('Missing iFlytek credentials');
  const voice = opts.voice || cfg.dubVoice || 'Female Voice 1';
  const speed = opts.speed || cfg.dubSpeed || 1;
  const lang = opts.lang || 'English';
  const curTime = Math.floor(Date.now() / 1000).toString();
  const param = {
    auf: 'audio/L16;rate=16000',
    aue: 'lame',
    voice_name: voice,
    speed,
    language: lang,
    engine_type: 'intp65'
  };
  const paramStr = btoa(JSON.stringify(param));
  const checksum = await md5Hex(apiKey + curTime + paramStr + apiSecret);
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    'X-Appid': appId,
    'X-CurTime': curTime,
    'X-Param': paramStr,
    'X-CheckSum': checksum
  };
  const body = 'text=' + encodeURIComponent(text);
  const res = await fetch('https://itsapi.xfyun.cn/v2/tts', { method: 'POST', headers, body });
  if (!res.ok) throw new Error('iFlytek TTS failed');
  const blob = await res.blob();
  return await blobToDataURL(blob);
}

async function md5Hex(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
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