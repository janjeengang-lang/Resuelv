const grid = document.getElementById('grid');
const createBtn = document.getElementById('create');
const modal = document.getElementById('identityModal');
const form = document.getElementById('identityForm');
const cancelIdentity = document.getElementById('cancelIdentity');
const modalTitle = document.getElementById('modalTitle');
const personaPrompt = document.getElementById('personaPrompt');
const generatePersona = document.getElementById('generatePersona');
const generateCompany = document.getElementById('generateCompany');

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
  for(const id of identities){
    const card = document.createElement('div');
    card.className = 'card' + (id.id===activeId ? ' active' : '');
    card.innerHTML = `
      ${id.id===activeId?'<div class="badge">Active</div>':''}
      <div class="pic-wrap"><img src="${id.profilePictureUrl||'icons/zepra.svg'}" alt="pf"></div>
      <div class="name">${id.identityName||'No name'}</div>
      <div>${id.country||''}</div>
      <div class="actions">
        <button class="btn act">${id.id===activeId?'Deactivate':'Activate'}</button>
        <button class="btn edit">Edit</button>
        <button class="btn del">Delete</button>
      </div>
    `;
    card.querySelector('.act').addEventListener('click',()=>toggleActive(id.id));
    card.querySelector('.edit').addEventListener('click',()=>openForm(id));
    card.querySelector('.del').addEventListener('click',()=>remove(id.id));
    grid.appendChild(card);
  }
}

function openForm(data){
  form.reset();
  personaPrompt.value = '';
  form.id.value = data?.id || '';
  for(const k of Object.keys(data||{})){
    if(form[k]) form[k].value = data[k];
  }
  modalTitle.textContent = data? 'Edit Identity' : 'New Identity';
  modal.classList.remove('hidden');
}

function closeForm(){
  modal.classList.add('hidden');
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
  closeForm();
  save();
  render();
});

generatePersona.addEventListener('click', async ()=>{
  const prompt = personaPrompt.value.trim();
  if(!prompt) return;
  const res = await chrome.runtime.sendMessage({ type:'GENERATE_PERSONA', prompt });
  if(res?.ok){
    try{
      const data = JSON.parse(res.result);
      const fields=['fullName','firstName','lastName','age','email','username','password','phone','address1','address2','city','state','zipCode','country','macAddress'];
      for(const k of fields){ if(form[k]) form[k].value = data[k]||''; }
    }catch(e){ alert('Failed to parse persona'); }
  }
});

generateCompany.addEventListener('click', async ()=>{
  const res = await chrome.runtime.sendMessage({ type:'GENERATE_COMPANY' });
  if(res?.ok){
    try{
      const data = JSON.parse(res.result);
      const fields=['companyName','companyIndustry','companySize','companyAnnualRevenue','companyWebsite','companyAddress'];
      for(const k of fields){ if(form[k]) form[k].value = data[k]||''; }
    }catch(e){ alert('Failed to parse company info'); }
  }
});

cancelIdentity.addEventListener('click', closeForm);
createBtn.addEventListener('click', ()=>openForm());

load();

