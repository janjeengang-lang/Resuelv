// background.js (MV3 service worker)
// - OpenRouter chat completions
// - OCR via OCR.space
// - Public IP via ipapi.co

const DEFAULTS = {
  openrouterModel: 'google/gemini-2.0-flash-exp:free',
  typingSpeed: 'normal', // fast | normal | slow
  ocrLang: 'eng',
};

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const cur = await chrome.storage.local.get(Object.keys(DEFAULTS));
    const toSet = {};
    for (const [k, v] of Object.entries(DEFAULTS)) if (cur[k] === undefined) toSet[k] = v;
    if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);

    const syncDefaults = await chrome.storage.sync.get('customPrompts');
    if (!Array.isArray(syncDefaults.customPrompts)) {
      await chrome.storage.sync.set({ customPrompts: [] });
    }
    
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
        case 'GET_PUBLIC_IP': {
          const info = await getPublicIP();
          sendResponse({ ok: true, info });
          break;
        }
        case 'GET_TAB_ID': {
          const id = sender?.tab?.id || (await getActiveTabId());
          sendResponse({ ok: true, tabId: id });
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
  const { openrouterApiKey = '', openrouterModel, geminiApiKey = '', aiProvider = 'openrouter' } = await chrome.storage.local.get([
    'openrouterApiKey', 'openrouterModel', 'geminiApiKey', 'aiProvider'
  ]);
  
  if (aiProvider === 'gemini' && geminiApiKey) {
    return await callGemini(prompt, geminiApiKey);
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

async function getPublicIP() {
  try {
    const res = await fetch('https://ipapi.co/json/', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!res.ok) {
      throw new Error(`IP API failed: ${res.status} ${res.statusText}`);
    }
    
    const d = await res.json();
    
    if (d.error) {
      throw new Error(`IP API error: ${d.reason || d.error}`);
    }
    
    return {
      ip: d?.ip || 'Unknown',
      country: d?.country_name || d?.country || 'Unknown',
      city: d?.city || 'Unknown',
      postal: d?.postal || 'Unknown',
      region: d?.region || 'Unknown',
      timezone: d?.timezone || 'Unknown',
      isp: d?.org || 'Unknown',
      flag: d?.country_code ? `https://flagcdn.com/16x12/${d.country_code.toLowerCase()}.png` : ''
    };
  } catch (error) {
    console.error('IP fetch error:', error);
    // Fallback to a simpler service
    try {
      const fallbackRes = await fetch('https://api.ipify.org?format=json');
      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        return {
          ip: fallbackData.ip || 'Unknown',
          country: 'Unknown',
          city: 'Unknown',
          postal: 'Unknown',
          region: 'Unknown',
          timezone: 'Unknown',
          isp: 'Unknown',
          flag: ''
        };
      }
    } catch (fallbackError) {
      console.error('Fallback IP fetch error:', fallbackError);
    }
    
    throw error;
  }
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
