const grid = document.getElementById('grid');
const createBtn = document.getElementById('create');
const createAIBtn = document.getElementById('createAI');
const panel = document.getElementById('identityPanel');
const panelTitle = document.getElementById('panelTitle');
const closePanelBtn = document.getElementById('closePanel');
const aiSetup = document.getElementById('aiSetup');
const aiPrompt = document.getElementById('aiPrompt');
const aiGenerate = document.getElementById('aiGenerate');
const aiSkeleton = document.getElementById('aiSkeleton');
const form = document.getElementById('identityForm');
const saveIdentity = document.getElementById('saveIdentity');

let identities = [];
let activeId = null;

function uid(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function load(){
  chrome.storage.local.get(['identities','activeIdentityId'], res => {
    identities = res.identities || [];
    activeId = res.activeIdentityId || null;
    render();
  });
}

function render(){
  grid.innerHTML = '';
  const editIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
  const trashIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
  for(const id of identities){
    const card = document.createElement('div');
    card.className = 'identity-card' + (id.id===activeId ? ' active' : '');
    card.innerHTML = `
      ${id.id===activeId?'<div class="badge">Active</div>':''}
      <div class="card-actions">
        <button class="edit" title="Edit">${editIcon}</button>
        <button class="del" title="Delete">${trashIcon}</button>
      </div>
      <div class="pic-wrap"><video autoplay loop muted src="${id.profilePictureUrl||'src/media/zepra.webm'}"></video></div>
      <div class="name">${id.identityName||'No name'}</div>
      <div class="full">${id.fullName||''}</div>
      <div class="email">${id.email||''}</div>
      <div class="actions"><button class="btn act">${id.id===activeId?'Deactivate':'Activate'}</button></div>
    `;
    card.querySelector('.act').addEventListener('click',()=>toggleActive(id.id));
    card.querySelector('.edit').addEventListener('click',()=>openPanel(id));
    card.querySelector('.del').addEventListener('click',()=>remove(id.id));
    grid.appendChild(card);
  }
}

function openPanel(data, mode='manual'){
  form.reset();
  form.id.value = data?.id || '';
  for(const k of Object.keys(data||{})){
    if(form[k]) form[k].value = data[k];
  }
  if(mode==='ai'){
    panelTitle.textContent = 'Create Identity with AI';
    aiSetup.classList.remove('hidden');
    form.classList.add('hidden');
  } else {
    panelTitle.textContent = data ? 'Edit Identity' : 'Create New Identity';
    aiSetup.classList.add('hidden');
    form.classList.remove('hidden');
  }
  panel.classList.add('open');
}

function closePanel(){
  panel.classList.remove('open');
  aiSetup.classList.add('hidden');
  aiSkeleton.classList.add('hidden');
  form.classList.remove('hidden');
}

function remove(id){
  identities = identities.filter(i=>i.id!==id);
  if(activeId===id) activeId = null;
  save();
  render();
}

function save(){
  chrome.storage.local.set({identities, activeIdentityId: activeId});
}

function toggleActive(id){
  if(activeId===id){
    activeId = null;
  } else {
    activeId = id;
  }
  save();
  render();
}

form.addEventListener('submit', e=>{
  e.preventDefault();
  const fd = new FormData(form);
  const obj = {};
  fd.forEach((v,k)=>{obj[k]=v;});
  if(obj.id){
    const idx = identities.findIndex(i=>i.id===obj.id);
    if(idx>-1) identities[idx] = Object.assign(identities[idx], obj);
  } else {
    obj.id = uid();
    identities.push(obj);
  }
  closePanel();
  save();
  render();
});
createBtn.addEventListener('click', ()=>openPanel());
createAIBtn.addEventListener('click', ()=>{
  aiPrompt.value='';
  openPanel({}, 'ai');
});
closePanelBtn.addEventListener('click', closePanel);
aiGenerate.addEventListener('click', async () => {
  const prompt = aiPrompt.value.trim();
  if (!prompt) return;
  aiSkeleton.classList.remove('hidden');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GENERATE_IDENTITY', prompt });
    if (!res?.ok) throw new Error('fetch');
    let data;
    try {
      data = JSON.parse(res.result);
    } catch (e) {
      console.error('Zepra Debug: Failed to parse AI response. Raw response was:', res?.result);
      alert('Error: AI provided an invalid response format.');
      aiSkeleton.classList.add('hidden');
      return;
    }
    data.profilePictureUrl = '';
    aiSkeleton.classList.add('hidden');
    openPanel(data, 'manual');
  } catch (e) {
    aiSkeleton.classList.add('hidden');
    alert('Error: Could not connect to the AI service. Please check your API key and network connection.');
  }
});

load();

