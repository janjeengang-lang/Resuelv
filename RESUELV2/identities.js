const cards = document.getElementById('cards');
const createBtn = document.getElementById('createAI');
const modal = document.getElementById('aiModal');
const generateBtn = document.getElementById('generate');
const promptEl = document.getElementById('aiPrompt');

let identities = [];
let activeId = null;

function render(){
  cards.innerHTML = '';
  identities.forEach((id, idx)=>{
    const card = document.createElement('div');
    card.className = 'identity-card';
    card.innerHTML = `
      <div class="avatar"><video src="videos/zepra.webm" autoplay loop muted></video></div>
      <h3>${id.fullName || 'Unnamed'}</h3>
      <div class="actions">
        ${activeId === idx ? '<button class="btn warn" data-act="deactivate">Deactivate</button>' : '<button class="btn primary" data-act="activate">Activate</button>'}
        <button class="btn" data-act="delete">Delete</button>
      </div>
    `;
    card.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>handleAction(idx,b.dataset.act)));
    cards.appendChild(card);
  });
}

function handleAction(index, act){
  if(act==='activate') activeId = index;
  if(act==='deactivate') activeId = null;
  if(act==='delete') identities.splice(index,1);
  chrome.storage.local.set({identities, activeId}, render);
}

createBtn.addEventListener('click',()=>{ modal.style.display='flex'; });
modal.addEventListener('click',e=>{ if(e.target===modal) modal.style.display='none'; });

generateBtn.addEventListener('click', async ()=>{
  const prompt = promptEl.value.trim();
  if(!prompt) return;
  const body = {
    model: 'gpt-3.5-turbo',
    messages: [{role:'user', content:`Generate a JSON identity for: ${prompt}`}] ,
    temperature:0.7
  };
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer YOUR_API_KEY'},
      body: JSON.stringify(body)
    });
    const data = await res.json();
    const text = data.choices[0].message.content;
    const json = JSON.parse(text);
    identities.push(json);
    chrome.storage.local.set({identities},()=>{ render(); modal.style.display='none'; });
  } catch(err){
    console.error(err);
  }
});

chrome.storage.local.get(['identities','activeId'], res=>{
  identities = res.identities || [];
  activeId = res.activeId ?? null;
  render();
});
