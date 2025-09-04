const sel = document.getElementById('siteSelect');
const toggleBtn = document.getElementById('toggleSelect');
const writeBtn = document.getElementById('writeHereBtn');
const clearBtn = document.getElementById('clearDataBtn');
const container = document.getElementById('container');

const params = new URLSearchParams(location.search);
const targetTabId = Number(params.get('tabId')) || 0;
const initialUrl = params.get('url');
const urlsParam = params.get('urls');
let extraUrls = [];
if(urlsParam){
  try{ extraUrls = JSON.parse(urlsParam); }catch{}
}

const frames = {};
let current = '';

const DEFAULT_SITES = [
  { name:'Easemate Chat', url:'https://www.easemate.ai/webapp/chat' },
  { name:'Whoer', url:'https://whoer.net/' },
  { name:'AI Humanizer', url:'https://bypassai.writecream.com/' },
  { name:'Prinsh Notepad', url:'https://notepad.prinsh.com/' }
];

const NAME_MAP = {
  'app.apponfly.com': 'Windows Session',
  'cloud.vmoscloud.com': 'Android Session (6H)',
  'myandroid.org': 'Android Session (UL)',
  'fakemail.net': 'Temp Mail'
};

function getDisplayName(url, existing){
  try{
    const host = new URL(url).hostname.replace(/^www\./,'');
    if(NAME_MAP[host]) return NAME_MAP[host];
    return existing || host;
  }catch{
    return existing || url;
  }
}

async function init(){
  let { customSites = [] } = await chrome.storage.local.get('customSites');
  if(!customSites.length){
    customSites = DEFAULT_SITES;
  }
  customSites = customSites.map(s=>({ url:s.url, name:getDisplayName(s.url, s.name) }));
  for(const u of extraUrls){
    if(!customSites.some(s=>s.url===u)){
      const name = getDisplayName(u);
      customSites.push({ name, url: u });
    }
  }
  if(initialUrl && !customSites.some(s=>s.url===initialUrl)){
    const name = getDisplayName(initialUrl);
    customSites.push({ name, url: initialUrl });
  }
  await chrome.storage.local.set({ customSites });
  sel.innerHTML = '<option value="">Select site</option>';
  customSites.forEach((s)=>{
    const opt = document.createElement('option');
    opt.value = s.url;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
  if(initialUrl){
    sel.value = initialUrl;
    sel.dispatchEvent(new Event('change'));
  }
  else if(extraUrls.length){
    sel.value = extraUrls[0];
    sel.dispatchEvent(new Event('change'));
  }
}

sel.addEventListener('change', ()=>{
  const val = sel.value;
  if(!val) return;
  current = val;
  if(!frames[val]){
    const iframe = document.createElement('iframe');
    iframe.src = val;
    container.appendChild(iframe);
    frames[val] = iframe;
  }
  for(const [url, frame] of Object.entries(frames)){
    frame.style.display = (url === val) ? 'block' : 'none';
  }
});

toggleBtn.addEventListener('click', ()=>{
  const hidden = sel.style.display === 'none';
  sel.style.display = hidden ? '' : 'none';
  toggleBtn.textContent = hidden ? 'Hide' : 'Show';
});

writeBtn.addEventListener('click', async ()=>{
  if(!current) return;
  const frame = frames[current];
  if(!frame) return;
  let text = '';
  try{
    text = frame.contentWindow.getSelection().toString();
  }catch(e){ /* cross-origin */ }
  if(!text){
    try{
      frame.contentWindow.focus();
      document.execCommand('copy');
      await new Promise(r=>setTimeout(r,50));
      text = await navigator.clipboard.readText();
    }catch(e){ console.error(e); }
  }
  if(text && targetTabId){
    const { typingSpeed='normal' } = await chrome.storage.local.get('typingSpeed');
    try{ await chrome.tabs.update(targetTabId,{active:true}); }catch{}
    await chrome.tabs.sendMessage(targetTabId, { type:'TYPE_TEXT', text, options:{ speed: typingSpeed } });
  }
});

clearBtn.addEventListener('click', async ()=>{
  if(!current) return;
  if(!confirm('Are you sure you want to clear all site data? This action cannot be undone.')) return;
  const origin = new URL(current).origin;
  try{
    await chrome.browsingData.remove({origins:[origin]}, {cookies:true, localStorage:true, indexedDB:true, cache:true});
  }catch(e){ console.error(e); }
  try{
    const frame = frames[current];
    frame.contentWindow.localStorage.clear();
    frame.contentWindow.sessionStorage.clear();
  }catch{}
  const frame = frames[current];
  if(frame) frame.src = current;
});

function saveSize(){
  chrome.storage.local.set({ customWebSize: { width: window.outerWidth, height: window.outerHeight } });
}

window.addEventListener('resize', saveSize);
window.addEventListener('beforeunload', saveSize);

init();
