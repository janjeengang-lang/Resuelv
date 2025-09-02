const sel = document.getElementById('siteSelect');
const toggleBtn = document.getElementById('toggleSelect');
const container = document.getElementById('container');

const frames = {};
let current = '';

async function init(){
  const { customSites = [] } = await chrome.storage.local.get('customSites');
  sel.innerHTML = '<option value="">Select site</option>';
  // populate sites
  customSites.forEach((s)=>{
    const opt = document.createElement('option');
    opt.value = s.url;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
  // write here option
  const writeOpt = document.createElement('option');
  writeOpt.value = '__write';
  writeOpt.textContent = 'Write Here';
  sel.appendChild(writeOpt);
}

sel.addEventListener('change', async ()=>{
  const val = sel.value;
  if(!val) return;
  if(val === '__write'){
    try{
      document.execCommand('copy');
      const text = await navigator.clipboard.readText();
      if(text){
        const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
        const { typingSpeed='normal' } = await chrome.storage.local.get('typingSpeed');
        await chrome.tabs.sendMessage(tab.id, { type:'TYPE_TEXT', text, options:{ speed: typingSpeed } });
      }
    }catch(e){ console.error(e); }
    sel.value = current || '';
    return;
  }
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

function saveSize(){
  chrome.storage.local.set({ customWebSize: { width: window.outerWidth, height: window.outerHeight } });
}

window.addEventListener('resize', saveSize);
window.addEventListener('beforeunload', saveSize);

init();
