const sel = document.getElementById('siteSelect');
const toggleBtn = document.getElementById('toggleSelect');
const writeBtn = document.getElementById('writeHereBtn');
const container = document.getElementById('container');

const params = new URLSearchParams(location.search);
const targetTabId = Number(params.get('tabId')) || 0;

const frames = {};
let current = '';

async function init(){
  const { customSites = [] } = await chrome.storage.local.get('customSites');
  sel.innerHTML = '<option value="">Select site</option>';
  customSites.forEach((s)=>{
    const opt = document.createElement('option');
    opt.value = s.url;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
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

function saveSize(){
  chrome.storage.local.set({ customWebSize: { width: window.outerWidth, height: window.outerHeight } });
}

window.addEventListener('resize', saveSize);
window.addEventListener('beforeunload', saveSize);

init();
