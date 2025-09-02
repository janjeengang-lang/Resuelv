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
  frame.contentWindow.focus();
  try{
    document.execCommand('copy');
    const text = await navigator.clipboard.readText();
    if(text && targetTabId){
      const { typingSpeed='normal' } = await chrome.storage.local.get('typingSpeed');
      await chrome.tabs.sendMessage(targetTabId, { type:'TYPE_TEXT', text, options:{ speed: typingSpeed } });
    }
  }catch(e){ console.error(e); }
});

function saveSize(){
  chrome.storage.local.set({ customWebSize: { width: window.outerWidth, height: window.outerHeight } });
}

window.addEventListener('resize', saveSize);
window.addEventListener('beforeunload', saveSize);

init();
