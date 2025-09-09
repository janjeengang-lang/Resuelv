document.addEventListener('DOMContentLoaded', () => {
  const forms = document.forms;
  if(forms.length){
    const helper = document.createElement('div');
    helper.id = 'helperBar';
    helper.innerHTML = '<button id="fillForm" class="btn primary">Fill Form</button>';
    document.body.appendChild(helper);
    helper.style.display = 'block';
    document.getElementById('fillForm').addEventListener('click',()=>fill(forms[0]));
  }

  const bubble = document.createElement('div');
  bubble.id = 'zepraBubble';
  bubble.innerHTML = `<video src="${chrome.runtime.getURL('videos/zepra.webm')}" autoplay loop muted></video>`;
  document.body.appendChild(bubble);
  bubble.addEventListener('click',togglePanel);

  const panel = document.createElement('div');
  panel.id = 'quickCopyPanel';
  document.body.appendChild(panel);
  loadPanel();

  document.addEventListener('input',e=>{
    const text = e.target.value;
    chrome.runtime.sendMessage({type:'checkConsistency', text}, res=>{
      if(res && res.warn){
        e.target.style.outline = `2px solid var(--warn)`;
        setTimeout(()=>{e.target.style.outline='';},1500);
      }
    });
  }, true);
});

function loadPanel(){
  chrome.storage.local.get(['identities','activeId'],res=>{
    const panel = document.getElementById('quickCopyPanel');
    panel.innerHTML='';
    const active = res.identities?.[res.activeId];
    if(!active){ panel.textContent = 'No active identity'; return; }
    for(const [k,v] of Object.entries(active)){
      const div = document.createElement('div');
      div.style.marginBottom='6px';
      div.innerHTML = `<strong>${k}:</strong> ${v} <button data-copy="${v}" class="btn" style="margin-left:4px;">Copy</button>`;
      panel.appendChild(div);
    }
    panel.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>navigator.clipboard.writeText(b.dataset.copy)));
  });
}

function togglePanel(){
  const panel = document.getElementById('quickCopyPanel');
  panel.classList.toggle('open');
  if(panel.classList.contains('open')) loadPanel();
}

function fill(form){
  const html = form.outerHTML;
  chrome.storage.local.get(['identities','activeId'],res=>{
    const active = res.identities?.[res.activeId];
    if(!active) return;
    chrome.runtime.sendMessage({type:'mapForm', html}, response=>{
      const mapping = response.mapping || {};
      for(const name in mapping){
        const el = form.querySelector(`[name="${name}"]`) || form.querySelector(`#${name}`);
        if(el) el.value = active[mapping[name]] || '';
      }
    });
  });
}
