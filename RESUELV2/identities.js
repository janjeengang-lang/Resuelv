const grid = document.getElementById('grid');
const createBtn = document.getElementById('create');
const quickBtn = document.getElementById('quickConnectBtn');
const modal = document.getElementById('identityModal');
const form = document.getElementById('identityForm');
const cancelIdentity = document.getElementById('cancelIdentity');
const modalTitle = document.getElementById('modalTitle');
const quickModal = document.getElementById('quickModal');
const quickCancel = document.getElementById('quickCancel');
const quickConnect = document.getElementById('quickConnect');
const quickTest = document.getElementById('quickTest');
const quickTestResult = document.getElementById('quickTestResult');
const connModal = document.getElementById('connModal');
const connInfo = document.getElementById('connInfo');
const connUsage = document.getElementById('connUsage');
const disconnectProxy = document.getElementById('disconnectProxy');

let identities = [];
let activeId = null;

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2); }

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
      <div class="toggle"><span>Use Proxy</span><label class="switch"><input type="checkbox" class="proxyToggle" ${id.useProxy?'checked':''}><span class="slider"></span></label></div>
    `;
    card.querySelector('.act').addEventListener('click',()=>toggleActive(id.id));
    card.querySelector('.edit').addEventListener('click',()=>openForm(id));
    card.querySelector('.del').addEventListener('click',()=>remove(id.id));
    card.querySelector('.proxyToggle').addEventListener('change',e=>{
      id.useProxy = e.target.checked;
      save();
      if(id.id===activeId){
        if(id.useProxy) applyProxy(id); else clearProxy();
      }
    });
    grid.appendChild(card);
  }
}

function openForm(data){
  form.reset();
  form.id.value = data?.id || '';
  for(const k of Object.keys(data||{})){
    if(form[k]) form[k].value = data[k];
  }
  modalTitle.textContent = data? 'Edit Identity' : 'New Identity';
  modal.classList.remove('hidden');
  const testBtn = document.getElementById('testProxy');
  const resultEl = document.getElementById('testResult');
  if(testBtn){
    testBtn.onclick = () => {
      const proxy = {
        proxyIp: form.proxyIp.value,
        proxyPort: form.proxyPort.value,
        proxyType: form.proxyType.value,
        proxyUsername: form.proxyUsername.value,
        proxyPassword: form.proxyPassword.value
      };
      testProxy(proxy, resultEl);
    };
  }
}

function closeForm(){ modal.classList.add('hidden'); }

function remove(id){
  identities = identities.filter(i=>i.id!==id);
  if(activeId===id){ activeId = null; clearProxy(); }
  save();
  render();
}

function save(){
  chrome.storage.local.set({identities, activeIdentityId: activeId});
}

function toggleActive(id){
  if(activeId===id){
    activeId = null;
    save();
    render();
    clearProxy();
  } else {
    activeId = id;
    const data = identities.find(i=>i.id===id);
    save();
    render();
    if(data.useProxy) applyProxy(data); else clearProxy();
  }
}

form.addEventListener('submit', e=>{
  e.preventDefault();
  const fd = new FormData(form);
  const obj = {};
  fd.forEach((v,k)=>{obj[k]=v;});
  obj.useProxy = form.useProxy.checked;
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

cancelIdentity.addEventListener('click', closeForm);
createBtn.addEventListener('click', ()=>openForm());

quickBtn.addEventListener('click', ()=>{ quickModal.classList.remove('hidden'); });
quickCancel.addEventListener('click', ()=>quickModal.classList.add('hidden'));
quickConnect.addEventListener('click', async ()=>{
  const proxy = {
    proxyIp: document.getElementById('quickIp').value,
    proxyPort: document.getElementById('quickPort').value,
    proxyType: document.getElementById('quickType').value,
    proxyUsername: document.getElementById('quickUser').value,
    proxyPassword: document.getElementById('quickPass').value
  };
  const test = await testProxy(proxy, quickTestResult);
  if(!test.ok) return;
  chrome.runtime.sendMessage({type:'SET_PROXY', proxy}, res=>{
    if(res?.ok){ showDashboard(res.info); }
    else showNotification('Failed to connect');
  });
  quickModal.classList.add('hidden');
});

quickTest.addEventListener('click', ()=>{
  const proxy = {
    proxyIp: document.getElementById('quickIp').value,
    proxyPort: document.getElementById('quickPort').value,
    proxyType: document.getElementById('quickType').value,
    proxyUsername: document.getElementById('quickUser').value,
    proxyPassword: document.getElementById('quickPass').value
  };
  testProxy(proxy, quickTestResult);
});

function applyProxy(idObj){
  (async()=>{
    const test = await testProxy(idObj);
    if(!test.ok){ showNotification('Proxy test failed'); return; }
    chrome.runtime.sendMessage({type:'SET_PROXY', proxy:idObj}, res=>{
      if(res?.ok) showDashboard(res.info); else showNotification('Failed to connect');
    });
  })();
}
function clearProxy(){
  chrome.runtime.sendMessage({type:'CLEAR_PROXY'});
  chrome.storage.local.set({proxyActive:false, proxyInfo:null, proxyUsage:0});
}

function testProxy(proxy, resultEl){
  if(resultEl) resultEl.textContent='Testing...';
  return new Promise(resolve=>{
    chrome.runtime.sendMessage({type:'TEST_PROXY', proxy}, res=>{
      if(res?.ok){
        if(resultEl) resultEl.textContent=`✅ Success! | ${res.info.country || 'Unknown'}, ${res.info.city || ''}`;
        resolve({ok:true, info:res.info});
      } else {
        if(resultEl) resultEl.textContent=`❌ Failed! ${res?.error || ''}`;
        showNotification(`❌ Connection Failed: ${res?.error || ''}`);
        resolve({ok:false});
      }
    });
  });
}

function showDashboard(info){
  connInfo.textContent = `${info.ip || ''} | ${info.city || ''}, ${info.country || ''}`;
  updateUsageDisplay();
  connModal.classList.remove('hidden');
}

function updateUsageDisplay(){
  chrome.storage.local.get('proxyUsage', ({proxyUsage=0})=>{
    const mb = (proxyUsage/1024/1024).toFixed(1);
    connUsage.textContent = `Usage: ${mb} MB`;
    connUsage.style.color = mb < 200 ? '#39ff14' : mb < 500 ? '#ffd600' : '#ff1744';
  });
}
chrome.storage.onChanged.addListener(chg=>{ if(chg.proxyUsage) updateUsageDisplay(); });

disconnectProxy.addEventListener('click',()=>{
  clearProxy();
  connModal.classList.add('hidden');
});

load();
