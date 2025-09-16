// content.js
// - Extract selected text or from DOM
// - Overlay to select OCR region
// - Fallback image crop
// - Type text into focused field (no humanize; speed only)
// - Floating bubble with rainbow modal
// (Video dubbing feature removed)

function init() {
  if (window.zepraInit) return;
  window.zepraInit = true;
  const STATE = {
    overlay: null,
    rectEl: null,
    modal: null,
    bubble: null,
    currentAnswer: '',
    isTyping: false,
    selBtn: null,
    lastFocused: null,
    lastMouse: { x: 20, y: 20 },
    fillIcon: null
  };

  let customPrompts = [];
  chrome.storage.sync.get('customPrompts', r => { customPrompts = r.customPrompts || []; });
  chrome.storage.onChanged.addListener((chg, area) => {
    if(area === 'sync' && chg.customPrompts){ customPrompts = chg.customPrompts.newValue || []; }
  });

  // Identity handling
  const FIELD_KEYWORDS = {
    email: ['email','e-mail','user_email','customer_email','mailid','emailaddress','email_address','useremail','emailid','contact_email','work_email','primary_email',/e-?mail/],
    username: ['username','user','userid','login','login_id','user-name','nickname','user_name','loginname','account','membername',/user.?name/],
    password: ['password','pass','pwd','secret','user_pass','passwd','passcode','userpassword',/pass.?word/],
    fullName: ['fullname','your-name','cardholder','card_name','nameoncard','full_name','customer_name','name','contact_name','realname',/full.?name/],
    firstName: ['firstname','first_name','fname','given-name','forename','given_name','first','customer_firstname','person_first_name','firstname1','first-name',/first.?name/],
    lastName: ['lastname','last_name','lname','surname','family-name','family_name','last','customer_lastname','person_last_name','lastname1','last-name',/last.?name/],
    age: ['age','user_age','yourage','member_age','ageyears','yrs','years_old','yearsold','birthyear',/years?\s?old/],
    phone: ['phone','mobile','telephone','tel','contact_number','phone_number','contact-no','cell','cellphone','phonenumber','dayphone','evephone','homephone',/phone|tel/],
    address1: ['address','address1','street_address','street','address-line1','billing_address','line1','addr1','street1','address_1','addressline1'],
    address2: ['address2','suite','apt','apartment','address-line2','line2','addr2','street2','address_2','addressline2'],
    city: ['city','town','user_city','locality','cityname','municipality',/city|town/],
    state: ['state','province','region','county','state_province','stateprovince','territory','prefecture',/state|province/],
    zipCode: ['zip','zipcode','postal','postal_code','postcode','zip_code','post_code','pin','pincode',/post.?code/],
    country: ['country','nation','country_name','countrycode','country-code',/country|nation/],
    macAddress: ['mac','mac_address','macaddress','device_mac','mac-addr','hardwareaddress','hwaddress',/mac.*address/],
    companyName: ['company','company_name','business_name','organization','organisation','employer','business','corp','corporation','workplace','companyname','firm',/company.?name|business/],
    companyIndustry: ['industry','field','business_type','area_of_work','sector','line_of_business','business_sector','industry_type','occupation','trade',/industry|sector/],
    companySize: ['company_size','employees','number_of_employees','employee_count','staff_size','num_employees','employee_number','workforce','team_size','size_of_company',/employee.?count|staff/],
    companyAnnualRevenue: ['revenue','annual_revenue','company_revenue','sales_volume','annual_sales','turnover','yearly_revenue','yearly_sales','company_turnover','gross_revenue',/annual.?revenue|turnover/],
    companyWebsite: ['website','company_website','company_url','business_url','site_url','web_address','companysite','companyweb','corporate_website','business_website',/web.?site|url/],
    companyAddress: ['company_address','business_address','work_address','office_address','corporate_address','company_location','workplace_address','company_addr',/office.?address|business.?addr/]
  };

  let activeIdentity = null;
  function loadIdentity(){
    chrome.storage.local.get(['activeIdentityId','identities'], res => {
      const list = res.identities || [];
      const id = res.activeIdentityId;
      activeIdentity = list.find(i=>i.id===id) || null;
    });
  }
  chrome.storage.onChanged.addListener((chg, area)=>{
    if(area==='local' && (chg.activeIdentityId || chg.identities)){
      loadIdentity();
    }
  });
  loadIdentity();

  function addFieldToIdentity(btn, value, key, success='Saved!'){
    chrome.storage.local.get('identities', ({identities=[]})=>{
      if(!identities.length){ showNotification('No identities saved'); return; }
      if(btn.nextSibling && btn.nextSibling.classList?.contains('ati-select')){ btn.nextSibling.remove(); return; }
      const sel=document.createElement('select');
      sel.className='ati-select';
      sel.style.cssText='margin-left:6px;background:#0b1220;color:#e2e8f0;border:1px solid #334155;border-radius:4px;';
      sel.innerHTML='<option value="">Select</option>'+identities.map(i=>`<option value="${i.id}">${i.identityName||'Unnamed'}</option>`).join('');
      btn.after(sel);
      sel.addEventListener('change',()=>{
        const id=sel.value; const idx=identities.findIndex(i=>i.id===id);
        if(idx>-1){ identities[idx][key]=value; chrome.storage.local.set({identities}); }
        sel.remove();
        const msg=document.createElement('span');
        msg.textContent=success;
        msg.style.cssText='color:#39ff14;margin-left:6px;font-size:12px;';
        btn.after(msg);
        setTimeout(()=>msg.remove(),1500);
      });
    });
  }
  function detectField(el){
    if(!el) return null;
    const attrs = ((el.id||'') + ' ' + (el.name||'') + ' ' + (el.placeholder||'') + ' ' + (el.type||'')).toLowerCase();
    let labelText = '';
    if(el.id){
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if(lbl) labelText = lbl.textContent.toLowerCase();
    }
    const hay = attrs + ' ' + labelText;
    for(const [key, vals] of Object.entries(FIELD_KEYWORDS)){
      if(vals.some(v=> v instanceof RegExp ? v.test(hay) : hay.includes(v))) return key;
    }
    return null;
  }

  function showFieldIcon(el){
    removeFieldIcon();
    if(!activeIdentity) return;
    const fieldKey = detectField(el);
    if(!fieldKey || !activeIdentity[fieldKey]) return;
    const icon = document.createElement('img');
    icon.src = chrome.runtime.getURL('icons/zepra.svg');
    icon.className = 'zepra-fill-icon';
    icon.style.cssText = 'position:absolute;right:4px;top:50%;transform:translateY(-50%);width:16px;height:16px;cursor:pointer;z-index:2147483647;';
    const parent = el.parentElement;
    if(!parent) return;
    const prevPos = parent.style.position;
    if(getComputedStyle(parent).position === 'static') parent.style.position='relative';
    parent.appendChild(icon);
    icon.addEventListener('mousedown', ev=>{
      ev.preventDefault();
      el.focus();
      typeIntoFocusedElement(activeIdentity[fieldKey], { speed: 'normal' });
    });
    STATE.fillIcon = {icon, parent, prevPos};
  }

  function removeFieldIcon(){
    const fi = STATE.fillIcon;
    if(fi){
      fi.icon.remove();
      if(fi.prevPos) fi.parent.style.position = fi.prevPos;
      STATE.fillIcon = null;
    }
  }


  function toggleIdentityPanel(){
    if(!activeIdentity){ showNotification('No active identity'); return; }
    let rows='';
    const fields=['fullName','email','phone','address1','city','country'];
    fields.forEach(k=>{
      if(activeIdentity[k]){
        rows += `<div class="id-row"><strong>${k}:</strong> <span>${activeIdentity[k]}</span> <button data-copy="${k}" class="copy-btn">Copy</button></div>`;
      }
    });
    const content = `
      <style>
        .id-modal-bg{position:relative;color:#e2e8f0;}
        .id-modal-bg video.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2;}
        .id-modal-inner{position:relative;z-index:1;}
        .id-header{height:120px;overflow:hidden;border-bottom:2px solid #39ff14;}
        .id-header video{width:100%;height:100%;object-fit:contain;}
        .id-body{padding:15px;max-height:60vh;overflow:auto;}
        .id-row{margin:6px 0;font-size:14px;display:flex;justify-content:space-between;align-items:center;gap:6px;}
        .copy-btn{background:#22c55e;border:none;color:#000;padding:2px 6px;border-radius:4px;cursor:pointer;font-size:12px;}
      </style>
      <div class="id-modal-bg">
        <video class="bg" autoplay loop muted src="${chrome.runtime.getURL('src/media/cepra.webm')}"></video>
        <div class="id-modal-inner">
          <div class="id-header"><video autoplay loop muted src="${chrome.runtime.getURL('src/media/key.webm')}"></video></div>
          <div class="id-body">${rows}</div>
        </div>
      </div>`;
    const modal = createStyledModal('Identity Data', content);
    modal.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',()=>navigator.clipboard.writeText(activeIdentity[b.dataset.copy]||'')));
  }

  document.addEventListener('keydown', e => {
    const combo = (e.ctrlKey ? 'Ctrl+' : '') +
                  (e.altKey ? 'Alt+' : '') +
                  (e.shiftKey ? 'Shift+' : '') +
                  e.key.toUpperCase();
    const pr = customPrompts.find(p => p.hotkey && p.hotkey.toUpperCase() === combo);
    if (pr) {
      const text = window.getSelection().toString().trim();
      if (!text) return;
      // Use integrated rainbow modal for a consistent UX instead of a simple alert.
      createRainbowModal(text, pr.id);
      e.preventDefault();
    }
  });

  document.addEventListener('focusin', (e) => { STATE.lastFocused = e.target; showFieldIcon(e.target); });
  document.addEventListener('focusout', () => removeFieldIcon());

  function watchForms(){
    let dismissed = false;
    const check = ()=>{
      if(dismissed || document.getElementById('zepra-helper-bar')) return;
      const forms = Array.from(document.querySelectorAll('form'));
      let target = null;
      for(const f of forms){
        const els = f.querySelectorAll('input,select');
        let matches = 0;
        for(const el of els){
          if(detectField(el)){
            matches++;
            if(matches >= 3) break;
          }
        }
        if(matches >= 3){ target = f; break; }
      }
      if(target){
        const bar=document.createElement('div');
        bar.id='zepra-helper-bar';
        bar.style.cssText='position:fixed;top:0;left:0;right:0;background:#111;color:#e2e8f0;padding:8px;z-index:2147483647;display:flex;justify-content:center;gap:10px;box-shadow:0 0 10px #39ff14;';
        bar.innerHTML=`<span>Zepra has detected a form. Would you like to fill it using your active identity?</span><button id="zepra-fill" style="background:#22c55e;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;">Fill Form</button><button id="zepra-dismiss" style="background:#dc2626;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;">Dismiss</button>`;
        document.body.prepend(bar);
        bar.querySelector('#zepra-fill').addEventListener('click',async ()=>{ await analyzeFormWithAI(target); bar.remove(); dismissed = true; });
        bar.querySelector('#zepra-dismiss').addEventListener('click',()=>{ bar.remove(); dismissed = true; });
      }
    };
    const mo=new MutationObserver(check);
    mo.observe(document.documentElement,{childList:true,subtree:true});
    check();
  }

  async function fillForm(form){
    if(!activeIdentity) return;
    const fields=form.querySelectorAll('input,textarea,select');
    for(const el of fields){
      const key=detectField(el);
      if(key && activeIdentity[key]){
        el.focus();
        await typeIntoFocusedElement(activeIdentity[key], {speed:'normal'});
        await sleep(100);
      }
    }
  }

  async function analyzeFormWithAI(form){
    if(!activeIdentity) return fillForm(form);
    try {
      const html = form.innerHTML.slice(0,4000);
      const res = await chrome.runtime.sendMessage({ type: 'ANALYZE_FORM', html });
      if(!res?.ok) throw new Error('fetch');
      const mapping = JSON.parse(res.result);
      for(const [selector,key] of Object.entries(mapping)){
        const el=form.querySelector(selector);
        if(el && activeIdentity[key]){
          el.focus();
          await typeIntoFocusedElement(activeIdentity[key], {speed:'normal'});
          await sleep(100);
        }
      }
    } catch(e){
      console.error('Form analysis failed, using fallback', e);
      await fillForm(form);
    }
  }

  // Create floating bubble
  function createFloatingBubble() {
    if (STATE.bubble || document.getElementById('zepra-bubble')) return;
    
    const bubble = document.createElement('div');
    bubble.id = 'zepra-bubble';
    bubble.innerHTML = `
      <div class="bubble-icon">
        <video autoplay loop muted src="${chrome.runtime.getURL('src/media/zepra.webm')}"></video>
        <div class="bubble-glow"></div>
      </div>
    `;
    
    bubble.style.cssText = `
      position: fixed;
      width: 60px;
      height: 60px;
      z-index: 2147483647;
      cursor: grab;
      border-radius: 50%;
      background: #000;
      box-shadow: 0 0 10px #39ff14, 0 0 20px #ffe600;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.3s ease;
      border: 2px solid #39ff14;
      animation: bubbleFloat 3s ease-in-out infinite;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes bubbleFloat {
        0%, 100% { transform: translateY(0px) scale(1); }
        50% { transform: translateY(-10px) scale(1.05); }
      }
      
      #zepra-bubble:hover {
        transform: scale(1.1) !important;
        box-shadow: 0 6px 30px rgba(57,255,20,0.6), 0 0 20px rgba(255,230,0,0.5) !important;
      }

      .bubble-icon {
        position: relative;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        overflow: hidden;
      }
      
      .bubble-icon video {
        width: 100%;
        height: 100%;
        object-fit: contain;
        border-radius: 50%;
      }
      
      .bubble-glow {
        position: absolute;
        top: -5px;
        left: -5px;
        right: -5px;
        bottom: -5px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(57,255,20,0.4) 0%, rgba(255,230,0,0.2) 40%, transparent 70%);
        animation: pulse 2s ease-in-out infinite;
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 0.3; transform: scale(1); }
        50% { opacity: 0.7; transform: scale(1.1); }
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(bubble);
    STATE.bubble = bubble;

    // Position bubble using stored value or default
    chrome.storage.local.get('bubblePos', ({ bubblePos }) => {
      if (bubblePos && typeof bubblePos.top === 'number' && typeof bubblePos.left === 'number') {
        bubble.style.top = bubblePos.top + 'px';
        bubble.style.left = bubblePos.left + 'px';
        bubble.style.right = 'unset';
      } else {
        bubble.style.top = '20px';
        bubble.style.right = '20px';
      }
    });


    // Drag behaviour
    let drag = { active: false, moved: false, offsetX: 0, offsetY: 0 };

    bubble.addEventListener('mousedown', (e) => {
      drag.active = true;
      drag.moved = false;
      drag.offsetX = e.clientX - bubble.offsetLeft;
      drag.offsetY = e.clientY - bubble.offsetTop;
      bubble.style.cursor = 'grabbing';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    function onMove(e) {
      if (!drag.active) return;
      drag.moved = true;
      const x = Math.min(window.innerWidth - bubble.offsetWidth, Math.max(0, e.clientX - drag.offsetX));
      const y = Math.min(window.innerHeight - bubble.offsetHeight, Math.max(0, e.clientY - drag.offsetY));
      bubble.style.left = x + 'px';
      bubble.style.top = y + 'px';
      bubble.style.right = 'unset';
    }

    function onUp() {
      if (!drag.active) return;
      drag.active = false;
      bubble.style.cursor = 'grab';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      chrome.storage.local.set({ bubblePos: { top: parseInt(bubble.style.top, 10), left: parseInt(bubble.style.left, 10) } });
      setTimeout(() => { drag.moved = false; }, 0);
    }

    bubble.addEventListener('click', (e) => {
      if (drag.moved) return;
      showBubbleMenu();
    });
  }

  function showBubbleMenu() {
    if (document.getElementById('zepra-sidebar')) return;

    const menu = document.createElement('aside');
    menu.id = 'zepra-sidebar';
    menu.innerHTML = `
      <div class="zepra-particles"></div>
      <header class="sidebar-header">
        <svg class="zap-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        <div class="title-group">
          <h2>Zepra Menu</h2>
          <p>Chrome Extension Suite</p>
        </div>
        <button class="close-btn" aria-label="Close">&times;</button>
      </header>
      <nav class="sidebar-nav">
        <ul>
          <li><a href="#" data-action="ocr"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/></svg><span>OCR Capture</span></a></li>
          <li><a href="#" data-action="ocr-full"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg><span>OCR Full Page</span></a></li>
          <li><a href="#" data-action="write-last"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>Write Last Answer</span></a></li>
          <li><a href="#" data-action="clear-context"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>Clear AI Context</span></a></li>
          <li><a href="#" data-action="ip-info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span>IP Information</span></a></li>
          <li><a href="#" data-action="ip-qual"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg><span>IP Qualification</span></a></li>
          <li><a href="#" data-action="fake-info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4"/><path d="M5.5 21a7.5 7.5 0 0 1 13 0"/></svg><span>Generate Fake Info</span></a></li>
          <li><a href="#" data-action="temp-mail"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,6 12,13 2,6"/></svg><span>Temp Mail</span></a></li>
          <li><a href="#" data-action="custom-web"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg><span>Custom Web</span></a></li>
          <li><a href="#" data-action="ai-humanizer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 0-7 7v4a7 7 0 0 0 7 7 7 7 0 0 0 7-7V9a7 7 0 0 0-7-7z"/><path d="M9 9h6"/><path d="M9 13h6"/></svg><span>AI Humanizer</span></a></li>
          <li><a href="#" data-action="real-address"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7"/><path d="M9 22V12h6v10"/><path d="M9 22H5a2 2 0 0 1-2-2v-7"/><path d="M21 13v7a2 2 0 0 1-2 2h-4"/></svg><span>Generate Real Address</span></a></li>
          <li><a href="#" data-action="company-info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M16 3v18"/><path d="M8 3v18"/><path d="M3 8h18"/><path d="M3 16h18"/></svg><span>Generate Company Info</span></a></li>
          <li><a href="#" data-action="identity-panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2"/><path d="M15 12h2"/><path d="M7 16h10"/></svg><span>Show Identity Data</span></a></li>
          <li><a href="#" data-action="zebra-vps"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="8" rx="2"/><rect x="2" y="12" width="20" height="8" rx="2"/><path d="M6 8h.01"/><path d="M6 16h.01"/></svg><span>Zebra VPS</span></a></li>
        </ul>
      </nav>
      <footer class="sidebar-footer">
        <p>Powered by Advanced AI · Secure & Encrypted</p>
        <div class="footer-dots"><span></span><span></span><span></span></div>
      </footer>
    `;

    const menuStyle = document.createElement('style');
    menuStyle.textContent = `
      #zepra-sidebar {
        position: fixed;
        top: 0;
        right: 0;
        height: 100vh;
        width: 100%;
        max-width: 360px;
        background-color: rgba(0,0,0,0.8);
        backdrop-filter: blur(12px);
        border-left: 1px solid rgba(74,222,128,0.2);
        display: flex;
        flex-direction: column;
        transform: translateX(100%);
        transition: transform 0.4s ease-in-out;
        z-index: 2147483648;
        overflow-y: auto;
      }

      #zepra-sidebar.open { transform: translateX(0); }

      #zepra-sidebar .zepra-particles {
        position: absolute;
        inset: 0;
        overflow: hidden;
        z-index: -1;
      }

      #zepra-sidebar .zepra-particles span {
        position: absolute;
        display: block;
        border-radius: 50%;
        background: rgba(74,222,128,0.4);
        animation: float 6s linear infinite;
      }

      @keyframes float {
        0% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
        100% { transform: translateY(0); }
      }

      .sidebar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px;
        border-bottom: 1px solid rgba(74,222,128,0.2);
      }

      .sidebar-header .title-group { flex: 1; margin-left: 8px; }
      .sidebar-header h2 {
        margin: 0;
        font-size: 1.2rem;
        color: #4ade80;
        text-shadow: 0 0 8px #4ade80;
      }
      .sidebar-header p {
        margin: 2px 0 0;
        font-size: 0.75rem;
        color: #94a3b8;
      }
      .zap-icon {
        width: 24px;
        height: 24px;
        flex-shrink: 0;
        color: #4ade80;
        filter: drop-shadow(0 0 5px #4ade80);
        animation: pulse 2s infinite;
      }

      @keyframes pulse {
        0%,100% { opacity: 1; }
        50% { opacity: 0.6; }
      }

      .close-btn {
        background: none;
        border: none;
        color: #9ca3af;
        font-size: 20px;
        cursor: pointer;
        transition: color 0.2s;
      }
      .close-btn:hover { color: #fff; }

      .sidebar-nav ul {
        list-style: none;
        padding: 8px;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .sidebar-nav a {
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        border-radius: 8px;
        color: #4ade80;
        text-decoration: none;
        transition: all 0.2s ease;
      }

      .sidebar-nav a svg { width: 20px; height: 20px; flex-shrink: 0; }

      .sidebar-nav a::before {
        content: "";
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background: #4ade80;
        opacity: 0;
        box-shadow: 0 0 6px #4ade80;
        transition: opacity 0.2s;
      }

      .sidebar-nav a:hover {
        background-color: rgba(74,222,128,0.1);
        transform: translateX(5px);
      }
      .sidebar-nav a:hover::before { opacity: 1; }

      .sidebar-footer {
        margin-top: auto;
        padding: 12px;
        border-top: 1px solid rgba(74,222,128,0.2);
        display: flex;
        align-items: center;
        gap: 6px;
        color: #9ca3af;
        font-size: 0.75rem;
      }
      .footer-dots { display: flex; gap: 4px; margin-left: 4px; }
      .footer-dots span {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #4ade80;
        animation: pulse 2s infinite;
      }
    `;

    document.head.appendChild(menuStyle);
    document.body.appendChild(menu);

    // spawn particles
    const particleBox = menu.querySelector('.zepra-particles');
    for (let i = 0; i < 25; i++) {
      const s = document.createElement('span');
      const size = Math.random() * 4 + 2;
      s.style.width = s.style.height = `${size}px`;
      s.style.left = `${Math.random() * 100}%`;
      s.style.top = `${Math.random() * 100}%`;
      s.style.animationDuration = `${Math.random() * 5 + 5}s`;
      s.style.animationDelay = `${Math.random() * 5}s`;
      particleBox.appendChild(s);
    }

    requestAnimationFrame(() => menu.classList.add('open'));

    const closeMenu = () => {
      menu.classList.remove('open');
      setTimeout(() => { menu.remove(); menuStyle.remove(); }, 400);
    };

    menu.querySelector('.close-btn').addEventListener('click', closeMenu);

    menu.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-action]');
      if (!link) return;
      e.preventDefault();
      const action = link.dataset.action;
      handleBubbleAction(action);
      closeMenu();
    });

    setTimeout(() => {
      document.addEventListener('click', function outside(e) {
        if (!menu.contains(e.target) && !STATE.bubble.contains(e.target)) {
          closeMenu();
          document.removeEventListener('click', outside);
        }
      });
    }, 100);
  }

  async function handleBubbleAction(action) {
    switch (action) {
      case 'ocr':
        startOCRCapture();
        break;
      case 'ocr-full':
        startFullPageOCR();
        break;
      case 'write-last':
        try {
          const { lastAnswer = '' } = await chrome.storage.local.get('lastAnswer');
          showLastAnswerModal(lastAnswer);
        } catch (e) {
          showNotification('No last answer available');
        }
        break;
      case 'clear-context':
        await chrome.storage.local.set({ contextQA: [] });
        showNotification('AI context cleared');
        break;
      case 'ip-info':
        try {
          const response = await chrome.runtime.sendMessage({ type: 'GET_PUBLIC_IP' });
          if (response.ok) {
            showIPModal(response.info);
          } else {
            showNotification('Failed to get IP information: ' + (response.error || 'Unknown error'));
          }
        } catch (e) {
          showNotification('Failed to get IP information: ' + e.message);
        }
        break;
      case 'ip-qual':
        runIPQualification();
        break;
      case 'fake-info':
        showFakeInfoModal();
        break;
      case 'temp-mail':
        window.open('https://yopmail.com/', '_blank');
        break;
      case 'custom-web':
        await chrome.runtime.sendMessage({ type: 'OPEN_CUSTOM_WEB' });
        break;
      case 'ai-humanizer':
        await openAIHumanizer();
        break;
      case 'real-address':
        showCleanRealAddressModal();
        break;
      case 'company-info':
        showCompanyInfoModal();
        break;
      case 'zebra-vps':
        showZebraVPSModal();
        break;
      case 'identity-panel':
        toggleIdentityPanel();
        break;
    }
  }

  function showZebraVPSModal(){
    const content = `
      <style>
        .zvps-cards{display:flex;gap:16px;flex-wrap:wrap;justify-content:center;color:#e2e8f0;}
        .zvps-card{background:rgba(0,0,0,0.6);border:2px solid #39ff14;border-radius:12px;padding:16px;width:180px;cursor:pointer;display:flex;flex-direction:column;align-items:center;text-align:center;transition:transform .2s,box-shadow .2s;}
        .zvps-card:hover{transform:scale(1.05);box-shadow:0 0 15px #39ff14;}
        .zvps-icon{font-size:36px;margin-bottom:8px;}
        .zvps-title{font-weight:bold;margin-bottom:4px;}
        .zvps-sub{font-size:12px;color:#ffe600;margin-bottom:8px;}
        .zvps-desc{font-size:12px;}
      </style>
      <div class="zvps-cards">
        <div class="zvps-card" data-mode="windows" data-url="https://app.apponfly.com/trial">
          <div class="zvps-icon">🪟</div>
          <div class="zvps-title">Windows Desktop</div>
          <div class="zvps-sub">20 Minute Session</div>
          <div class="zvps-desc">Access a temporary Windows desktop. You can repeat this process without limits.</div>
        </div>
        <div class="zvps-card" data-mode="android6">
          <div class="zvps-icon">🤖</div>
          <div class="zvps-title">Android VM</div>
          <div class="zvps-sub">6 Hour Session</div>
          <div class="zvps-desc">Opens a virtual Android environment and a Temp-Mail tab to help you sign up.</div>
        </div>
        <div class="zvps-card" data-mode="androidU" data-url="https://www.myandroid.org/run/start.php?apkid=com.koolextremeshooting.battlegroundsshooting.fpsgame&app=com-koolextremeshooting-battlegroundsshooting-fpsgame">
          <div class="zvps-icon">📱</div>
          <div class="zvps-title">Android Google Pixel</div>
          <div class="zvps-sub">Unlimited Session</div>
          <div class="zvps-desc">Run a cloud-based Android instance with a Google Pixel interface.</div>
        </div>
      </div>`;
    const modal = createStyledModal('Zebra VPS', content);
    modal.querySelectorAll('.zvps-card').forEach(card=>{
      card.addEventListener('click', async ()=>{
        const mode = card.dataset.mode;
        if(mode==='android6'){
          await chrome.runtime.sendMessage({ type:'OPEN_CUSTOM_WEB', initialUrl:'https://cloud.vmoscloud.com/', urls:['https://www.fakemail.net/','https://cloud.vmoscloud.com/'] });
        }else{
          const url = card.dataset.url;
          await chrome.runtime.sendMessage({ type:'OPEN_CUSTOM_WEB', initialUrl:url, urls:[url] });
        }
        modal.remove();
      });
    });
  }

  async function openAIHumanizer(){
    await chrome.runtime.sendMessage({ type:'OPEN_OR_FOCUS_CUSTOM_WEB', url:'https://bypassai.writecream.com/' });
  }

  async function runIPQualification(){
    try{
      const resp = await chrome.runtime.sendMessage({ type: 'GET_IP_QUALIFICATION' });
      if(resp?.ok){
        await chrome.storage.local.set({ lastIPQ: resp.data });
        showCleanIPQualificationModal(resp.data);
      }else{
        const { lastIPQ } = await chrome.storage.local.get('lastIPQ');
        showCleanIPQualificationModal(lastIPQ || null);
      }
    }catch(e){
      const { lastIPQ } = await chrome.storage.local.get('lastIPQ');
      showCleanIPQualificationModal(lastIPQ || null);
    }
  }

  function showIPQualificationModal(data){
    if(!data){
      // Remove existing modal
      const existing = document.getElementById('zepra-ipq-modal');
      if (existing) existing.remove();

      // Create simple error modal
      const errorModal = document.createElement('div');
      errorModal.id = 'zepra-ipq-modal';
      errorModal.innerHTML = `
        <div class="ipq-modal-overlay">
          <div class="ipq-modal-container">
            <div class="ipq-modal-header">
              <h3>IP Qualification</h3>
              <button class="ipq-modal-close">&times;</button>
            </div>
            <div class="ipq-modal-body">
              <div style="padding:20px;text-align:center;color:#e2e8f0;">Could not fetch IP data. Please try again.</div>
            </div>
          </div>
        </div>
      `;
      
      const errorStyle = document.createElement('style');
      errorStyle.textContent = `
        #zepra-ipq-modal {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: fadeIn 0.3s ease-out;
        }
        
        .ipq-modal-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.8);
          backdrop-filter: blur(8px);
        }
        
        .ipq-modal-container {
          position: relative;
          background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
          border: 2px solid #f43f5e;
          border-radius: 20px;
          max-width: 400px;
          width: 90%;
          overflow: hidden;
          box-shadow: 0 0 50px rgba(244, 63, 94, 0.3);
        }
        
        .ipq-modal-header {
          background: rgba(0, 0, 0, 0.4);
          padding: 20px 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid rgba(244, 63, 94, 0.2);
        }
        
        .ipq-modal-header h3 {
          margin: 0;
          color: #f43f5e;
          font-size: 18px;
          font-weight: bold;
        }
        
        .ipq-modal-close {
          background: none;
          border: none;
          color: #e2e8f0;
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        
        .ipq-modal-close:hover {
          background: rgba(244, 63, 94, 0.2);
          color: #f43f5e;
        }
        
        .ipq-modal-body {
          padding: 24px;
        }
      `;
      
      document.head.appendChild(errorStyle);
      document.body.appendChild(errorModal);
      
      errorModal.querySelector('.ipq-modal-close').addEventListener('click', () => {
        errorModal.remove();
        errorStyle.remove();
      });
      
      errorModal.querySelector('.ipq-modal-overlay').addEventListener('click', (e) => {
        if (e.target === errorModal.querySelector('.ipq-modal-overlay')) {
          errorModal.remove();
          errorStyle.remove();
        }
      });
      
      return;
    }

    const risk = Number(data.risk_score ?? data.risk ?? data.score ?? 0);
    const ip = data.ip || data.query || '';
    const city = data.city || data.region_name || data.region || '';
    const cc = (data.country_code || data.countryCode || data.country_code2 || '').toUpperCase();
    const isp = data.isp || data.org || '';
    const flag = cc ? cc.replace(/./g, ch => String.fromCodePoint(127397 + ch.charCodeAt(0))) : '';

    const detection = data?.blacklists?.detection || 'none';
    const proxy = !!data?.security?.proxy;
    const vpn = !!data?.security?.vpn;
    const tor = !!data?.security?.tor;

    // Enhanced status logic with three states
    const riskPass = risk < 30;
    const riskWarning = risk >= 30 && risk <= 50;
    const riskFail = risk > 50;
    const blacklistPass = detection === 'none';
    const anonymityPass = !proxy && !vpn && !tor;

    // Determine overall status
    let statusState = 'qualified'; // qualified, warning, not-qualified
    let statusText = 'QUALIFIED';
    let statusMessage = 'Your IP is clean and ready to use.';
    let statusClass = 'status-qualified';

    if (riskFail || !blacklistPass || !anonymityPass) {
      statusState = 'not-qualified';
      statusText = 'NOT QUALIFIED';
      statusClass = 'status-not-qualified';
      
      if (riskFail) {
        statusMessage = 'Warning: This IP is high-risk and has a bad reputation. It is not recommended for use.';
      } else if (!blacklistPass) {
        statusMessage = 'Your IP is on a blacklist. You must change your connection.';
      } else if (!anonymityPass) {
        statusMessage = 'Proxy/VPN/Tor detected. Please disable it and try again.';
      }
    } else if (riskWarning) {
      statusState = 'warning';
      statusText = 'WARNING';
      statusClass = 'status-warning';
      statusMessage = 'Your IP is moderately risky. Proceed with caution.';
    }

    // Enhanced particles with different counts based on status
    const particleCount = statusState === 'qualified' ? 20 : statusState === 'warning' ? 15 : 10;
    const particles = Array.from({ length: particleCount })
      .map((_, i) => `<span class="particle" style="--i:${i};"></span>`)
      .join('');

    // SVG Icons
    const shieldSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    const eyeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const globeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    
    // Status-specific icons
    const checkSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="check-icon"><polyline points="20 6 9 17 4 12"/></svg>`;
    const warningSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="warning-icon"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="m12 17 .01 0"/></svg>`;
    const xSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="x-icon"><path d="M18 6 6 18M6 6l12 12"/></svg>`;

    // Build checklist with enhanced logic
    const checks = [
      { 
        pass: riskPass, 
        warning: riskWarning,
        fail: riskFail,
        label: 'Risk Score Assessment', 
        icon: shieldSVG 
      },
      { 
        pass: blacklistPass, 
        warning: false,
        fail: !blacklistPass,
        label: 'Blacklist Verification', 
        icon: eyeSVG 
      },
      { 
        pass: anonymityPass, 
        warning: false,
        fail: !anonymityPass,
        label: 'Anonymity Detection', 
        icon: globeSVG 
      },
    ];

    const checklistHTML = checks
      .map((c, i) => {
        let resultIcon = checkSVG;
        let resultClass = 'check-result-pass';
        
        if (c.fail) {
          resultIcon = xSVG;
          resultClass = 'check-result-fail';
        } else if (c.warning) {
          resultIcon = warningSVG;
          resultClass = 'check-result-warning';
        }
        
        return `
        <div class="ipq-check-card ${resultClass}" style="--i:${i};">
          <div class="ipq-check-left">${c.icon}<span>${c.label}</span></div>
          <div class="ipq-check-result">${resultIcon}</div>
        </div>`;
      })
      .join('');

    // Header icons based on status
    const shieldCheckSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>`;
    const shieldWarningSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 7v6"/><path d="m12 17 .01 0"/></svg>`;
    const shieldOffSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 9l6 6M15 9l-6 6"/></svg>`;
    
    let headerIcon = shieldCheckSVG;
    if (statusState === 'warning') headerIcon = shieldWarningSVG;
    else if (statusState === 'not-qualified') headerIcon = shieldOffSVG;

    const html = `
      <style>
        /* Enhanced status color system */
        .styled-modal-content.status-qualified { --ipq-color: #4ade80; --ipq-bg: rgba(74, 222, 128, 0.1); }
        .styled-modal-content.status-warning { --ipq-color: #fbbf24; --ipq-bg: rgba(251, 191, 36, 0.1); }
        .styled-modal-content.status-not-qualified { --ipq-color: #f43f5e; --ipq-bg: rgba(244, 63, 94, 0.1); }
        
        .styled-modal-content .styled-modal-header h3 { display: flex; align-items: center; gap: 8px; }
        .styled-modal-content .styled-modal-header svg { width: 24px; height: 24px; }
        .styled-modal-content .styled-modal-header h3,
        .styled-modal-content .styled-modal-header svg {
          color: var(--ipq-color);
          stroke: var(--ipq-color);
          filter: drop-shadow(0 0 8px var(--ipq-color));
          animation: headerGlow 2s ease-in-out infinite alternate;
        }

        @keyframes headerGlow {
          from { filter: drop-shadow(0 0 8px var(--ipq-color)); }
          to { filter: drop-shadow(0 0 16px var(--ipq-color)) drop-shadow(0 0 24px var(--ipq-color)); }
        }

        .ipq-modal {
          position: relative;
          overflow: hidden;
          max-width: 420px;
          background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%);
          backdrop-filter: blur(20px);
          border: 2px solid var(--ipq-color);
          border-radius: 24px;
          box-shadow: 
            0 0 50px var(--ipq-bg),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }

        /* Animated grid background */
        .ipq-grid {
          position: absolute;
          inset: 0;
          background-image: 
            linear-gradient(to right, var(--ipq-color) 1px, transparent 1px),
            linear-gradient(var(--ipq-color) 1px, transparent 1px);
          background-size: 30px 30px;
          opacity: 0.08;
          animation: moveGrid 25s linear infinite;
          pointer-events: none;
        }

        @keyframes moveGrid {
          from { background-position: 0 0, 0 0; }
          to { background-position: 30px 30px, 30px 30px; }
        }

        .ipq-main {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 32px;
          padding: 32px 24px;
        }

        /* Enhanced circle design */
        .ipq-circle {
          position: relative;
          width: 220px;
          height: 220px;
          animation: circleEntrance 1s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        @keyframes circleEntrance {
          from { 
            opacity: 0; 
            transform: scale(0.5) rotate(-180deg); 
          }
          to { 
            opacity: 1; 
            transform: scale(1) rotate(0deg); 
          }
        }

        .ipq-circle .ring {
          position: absolute;
          border-radius: 50%;
          inset: 0;
        }

        /* Outer rotating ring */
        .ipq-circle .ring.outer {
          border: 4px dashed var(--ipq-color);
          animation: spin 15s linear infinite;
          filter: drop-shadow(0 0 10px var(--ipq-color));
        }

        /* Inner solid ring */
        .ipq-circle .ring.inner {
          inset: 24px;
          border: 3px solid var(--ipq-color);
          opacity: 0.6;
          animation: spinReverse 10s linear infinite;
        }

        /* Glow ring */
        .ipq-circle .ring.glow {
          inset: -8px;
          border: 1px solid var(--ipq-color);
          box-shadow: 
            0 0 30px var(--ipq-color),
            inset 0 0 30px var(--ipq-color);
          opacity: 0.3;
          animation: pulse 3s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { 
            opacity: 0.3; 
            transform: scale(1); 
          }
          50% { 
            opacity: 0.7; 
            transform: scale(1.05); 
          }
        }

        /* Radar sweep effect */
        .ipq-circle .radar {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: conic-gradient(from 0deg, var(--ipq-color) 0deg, transparent 90deg);
          mix-blend-mode: screen;
          animation: spin 8s linear infinite;
          opacity: 0.3;
        }

        /* Center content */
        .ipq-circle .center {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          z-index: 2;
        }

        .ipq-status {
          font-size: 20px;
          font-weight: 800;
          color: var(--ipq-color);
          text-shadow: 0 0 15px var(--ipq-color);
          margin-bottom: 8px;
          animation: statusPulse 2s ease-in-out infinite;
          letter-spacing: 1px;
        }

        @keyframes statusPulse {
          0%, 100% { 
            text-shadow: 0 0 15px var(--ipq-color); 
          }
          50% { 
            text-shadow: 
              0 0 25px var(--ipq-color), 
              0 0 35px var(--ipq-color);
          }
        }

        .ipq-risk {
          font-size: 48px;
          font-weight: 900;
          color: var(--ipq-color);
          text-shadow: 0 0 20px var(--ipq-color);
          font-family: 'Courier New', monospace;
        }

        /* Enhanced particles */
        .particle {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 4px;
          height: 4px;
          background: var(--ipq-color);
          border-radius: 50%;
          animation: 
            orbit 8s linear infinite,
            particleGlow 2s ease-in-out infinite alternate;
          animation-delay: calc(var(--i) * -0.4s);
          box-shadow: 0 0 8px var(--ipq-color);
        }

        @keyframes particleGlow {
          from { 
            box-shadow: 0 0 8px var(--ipq-color);
            opacity: 0.8;
          }
          to { 
            box-shadow: 0 0 16px var(--ipq-color);
            opacity: 1;
          }
        }

        @keyframes orbit {
          from { 
            transform: rotate(0deg) translateX(110px) rotate(0deg); 
          }
          to { 
            transform: rotate(360deg) translateX(110px) rotate(-360deg); 
          }
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes spinReverse {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }

        /* Enhanced checklist */
        .ipq-checklist {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .ipq-check-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: var(--ipq-bg);
          border-radius: 12px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          animation: fadeUp 0.6s ease forwards;
          opacity: 0;
          animation-delay: calc(var(--i) * 0.15s + 0.5s);
          backdrop-filter: blur(10px);
        }

        .ipq-check-card:hover {
          background: rgba(255, 255, 255, 0.15);
          transform: translateX(8px) scale(1.02);
          border-color: var(--ipq-color);
          box-shadow: 0 8px 25px var(--ipq-bg);
        }

        .ipq-check-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .ipq-check-left svg {
          width: 20px;
          height: 20px;
          stroke: #9ca3af;
          filter: drop-shadow(0 0 4px rgba(156, 163, 175, 0.5));
        }

        .ipq-check-left span {
          font-weight: 600;
          color: #e2e8f0;
        }

        .ipq-check-result svg {
          width: 24px;
          height: 24px;
          transition: all 0.3s ease;
        }

        /* Status-specific result icons */
        .check-result-pass .check-icon {
          stroke: #4ade80;
          filter: drop-shadow(0 0 8px #4ade80);
          animation: checkBounce 0.6s ease;
        }

        .check-result-warning .warning-icon {
          stroke: #fbbf24;
          fill: #fbbf24;
          filter: drop-shadow(0 0 8px #fbbf24);
          animation: warningPulse 1.5s ease-in-out infinite;
        }

        .check-result-fail .x-icon {
          stroke: #f43f5e;
          filter: drop-shadow(0 0 8px #f43f5e);
          animation: xShake 0.6s ease;
        }

        @keyframes checkBounce {
          0%, 20%, 53%, 80%, 100% { transform: scale(1); }
          40%, 43% { transform: scale(1.3); }
          70% { transform: scale(1.1); }
        }

        @keyframes warningPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }

        @keyframes xShake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }

        @keyframes fadeUp {
          from { 
            opacity: 0; 
            transform: translateY(20px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }

        /* Footer enhancements */
        .ipq-footer {
          width: 100%;
          padding: 0 24px 24px;
        }

        .ipq-summary {
          font-weight: 700;
          color: var(--ipq-color);
          text-align: center;
          margin-top: 16px;
          font-size: 16px;
          text-shadow: 0 0 10px var(--ipq-color);
          animation: summaryFade 0.8s ease 1.2s both;
        }

        @keyframes summaryFade {
          from { 
            opacity: 0; 
            transform: translateY(10px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }

        .ipq-info-cards {
          display: flex;
          gap: 16px;
          margin-top: 20px;
        }

        .ipq-info-card {
          flex: 1;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 12px;
          padding: 12px;
          text-align: center;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
          animation: cardSlideUp 0.6s ease both;
          animation-delay: 1.4s;
        }

        .ipq-info-card:hover {
          box-shadow: 0 8px 25px rgba(255, 255, 255, 0.1);
          transform: translateY(-4px);
          border-color: var(--ipq-color);
        }

        @keyframes cardSlideUp {
          from { 
            opacity: 0; 
            transform: translateY(15px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }

        .ipq-info-label {
          font-size: 12px;
          color: #9ca3af;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .ipq-info-value {
          font-size: 14px;
          font-weight: 700;
          color: #e5e7eb;
          margin-top: 4px;
        }

        /* Responsive adjustments */
        @media (max-width: 480px) {
          .ipq-modal { max-width: 95vw; }
          .ipq-circle { width: 180px; height: 180px; }
          .ipq-status { font-size: 16px; }
          .ipq-risk { font-size: 36px; }
          .ipq-main { padding: 24px 16px; }
        }
      </style>
      <div class="ipq-modal">
        <div class="ipq-grid"></div>
        <main class="ipq-main">
          <div class="ipq-circle">
            <div class="ring outer"></div>
            <div class="ring inner"></div>
            <div class="ring glow"></div>
            <div class="radar"></div>
            <div class="center">
              <div class="ipq-status">${statusText}</div>
              <div class="ipq-risk">${risk}</div>
            </div>
            ${particles}
          </div>
          <div class="ipq-checklist">${checklistHTML}</div>
        </main>
        <footer class="ipq-footer">
          <div class="ipq-summary">${statusMessage}</div>
          <div class="ipq-info-cards">
            <div class="ipq-info-card">
              <div class="ipq-info-label">IP Address</div>
              <div class="ipq-info-value">${ip}</div>
            </div>
            <div class="ipq-info-card">
              <div class="ipq-info-label">Location</div>
              <div class="ipq-info-value">${flag} ${city ? city+', ' : ''}${cc}</div>
            </div>
            <div class="ipq-info-card">
              <div class="ipq-info-label">ISP</div>
              <div class="ipq-info-value">${isp || 'Unknown'}</div>
            </div>
          </div>
        </footer>
      </div>`;

    const modal = createStyledModal(`${headerIcon} IP Qualification`, html);
    modal.querySelector('.styled-modal-content').classList.add(statusClass);
  }

  

    // Clean IP Qualification Modal - New Implementation
  function showCleanIPQualificationModal(data){
    if(!data){
      // Remove existing modal
      const existing = document.getElementById('zepra-ipq-modal');
      if (existing) existing.remove();

      // Create simple error modal
      const errorModal = document.createElement('div');
      errorModal.id = 'zepra-ipq-modal';
      errorModal.innerHTML = `
        <div class="ipq-modal-overlay">
          <div class="ipq-modal-container">
            <div class="ipq-modal-header">
              <h3>IP Qualification</h3>
              <button class="ipq-modal-close">&times;</button>
            </div>
            <div class="ipq-modal-body">
              <div style="padding:20px;text-align:center;color:#e2e8f0;">Could not fetch IP data. Please try again.</div>
            </div>
          </div>
        </div>
      `;
      
      const errorStyle = document.createElement('style');
      errorStyle.textContent = `
        #zepra-ipq-modal {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: fadeIn 0.3s ease-out;
        }
        
        .ipq-modal-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.8);
          backdrop-filter: blur(8px);
        }
        
        .ipq-modal-container {
          position: relative;
          background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
          border: 2px solid #f43f5e;
          border-radius: 20px;
          max-width: 400px;
          width: 90%;
          overflow: hidden;
          box-shadow: 0 0 50px rgba(244, 63, 94, 0.3);
        }
        
        .ipq-modal-header {
          background: rgba(0, 0, 0, 0.4);
          padding: 20px 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid rgba(244, 63, 94, 0.2);
        }
        
        .ipq-modal-header h3 {
          margin: 0;
          color: #f43f5e;
          font-size: 18px;
          font-weight: bold;
        }
        
        .ipq-modal-close {
          background: none;
          border: none;
          color: #e2e8f0;
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        
        .ipq-modal-close:hover {
          background: rgba(244, 63, 94, 0.2);
          color: #f43f5e;
        }
        
        .ipq-modal-body {
          padding: 24px;
        }
      `;
      
      document.head.appendChild(errorStyle);
      document.body.appendChild(errorModal);
      
      errorModal.querySelector('.ipq-modal-close').addEventListener('click', () => {
        errorModal.remove();
        errorStyle.remove();
      });
      
      errorModal.querySelector('.ipq-modal-overlay').addEventListener('click', (e) => {
        if (e.target === errorModal.querySelector('.ipq-modal-overlay')) {
          errorModal.remove();
          errorStyle.remove();
        }
      });
      
      return;
    }

    const risk = Number(data.risk_score ?? data.risk ?? data.score ?? 0);
    const ip = data.ip || data.query || '';
    const city = data.city || data.region_name || data.region || '';
    const cc = (data.country_code || data.countryCode || data.country_code2 || '').toUpperCase();
    const isp = data.isp || data.org || '';
    const flag = cc ? cc.replace(/./g, ch => String.fromCodePoint(127397 + ch.charCodeAt(0))) : '';

    const detection = data?.blacklists?.detection || 'none';
    const proxy = !!data?.security?.proxy;
    const vpn = !!data?.security?.vpn;
    const tor = !!data?.security?.tor;

    // Enhanced status logic with three states
    const riskPass = risk < 30;
    const riskWarning = risk >= 30 && risk <= 50;
    const riskFail = risk > 50;
    const blacklistPass = detection === 'none';
    const anonymityPass = !proxy && !vpn && !tor;

    // Determine overall status
    let statusState = 'qualified'; // qualified, warning, not-qualified
    let statusText = 'QUALIFIED';
    let statusMessage = 'Your IP is clean and ready to use.';
    let statusClass = 'status-qualified';

    if (riskFail || !blacklistPass || !anonymityPass) {
      statusState = 'not-qualified';
      statusText = 'NOT QUALIFIED';
      statusClass = 'status-not-qualified';
      
      if (riskFail) {
        statusMessage = 'Warning: This IP is high-risk and has a bad reputation. It is not recommended for use.';
      } else if (!blacklistPass) {
        statusMessage = 'Your IP is on a blacklist. You must change your connection.';
      } else if (!anonymityPass) {
        statusMessage = 'Proxy/VPN/Tor detected. Please disable it and try again.';
      }
    } else if (riskWarning) {
      statusState = 'warning';
      statusText = 'WARNING';
      statusClass = 'status-warning';
      statusMessage = 'Your IP is moderately risky. Proceed with caution.';
    }

    // Enhanced particles with different counts based on status
    const particleCount = statusState === 'qualified' ? 20 : statusState === 'warning' ? 15 : 10;
    const particles = Array.from({ length: particleCount })
      .map((_, i) => `<span class="particle" style="--i:${i};"></span>`)
      .join('');

    // SVG Icons
    const shieldSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    const eyeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const globeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    
    // Status-specific icons
    const checkSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="check-icon"><polyline points="20 6 9 17 4 12"/></svg>`;
    const warningSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="warning-icon"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="m12 17 .01 0"/></svg>`;
    const xSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="x-icon"><path d="M18 6 6 18M6 6l12 12"/></svg>`;

    // Build checklist with enhanced logic
    const checks = [
      { 
        pass: riskPass, 
        warning: riskWarning,
        fail: riskFail,
        label: 'Risk Score Assessment', 
        icon: shieldSVG 
      },
      { 
        pass: blacklistPass, 
        warning: false,
        fail: !blacklistPass,
        label: 'Blacklist Verification', 
        icon: eyeSVG 
      },
      { 
        pass: anonymityPass, 
        warning: false,
        fail: !anonymityPass,
        label: 'Anonymity Detection', 
        icon: globeSVG 
      },
    ];

    const checklistHTML = checks
      .map((c, i) => {
        let resultIcon = checkSVG;
        let resultClass = 'check-result-pass';
        
        if (c.fail) {
          resultIcon = xSVG;
          resultClass = 'check-result-fail';
        } else if (c.warning) {
          resultIcon = warningSVG;
          resultClass = 'check-result-warning';
        }
        
        return `
        <div class="ipq-check-card ${resultClass}" style="--i:${i};">
          <div class="ipq-check-left">${c.icon}<span>${c.label}</span></div>
          <div class="ipq-check-result">${resultIcon}</div>
        </div>`;
      })
      .join('');

    // Header icons based on status
    const shieldCheckSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>`;
    const shieldWarningSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 7v6"/><path d="m12 17 .01 0"/></svg>`;
    const shieldOffSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 9l6 6M15 9l-6 6"/></svg>`;
    
    let headerIcon = shieldCheckSVG;
    if (statusState === 'warning') headerIcon = shieldWarningSVG;
    else if (statusState === 'not-qualified') headerIcon = shieldOffSVG;

    const html = `
      <style>
        /* Enhanced status color system */
        .styled-modal-content.status-qualified { --ipq-color: #4ade80; --ipq-bg: rgba(74, 222, 128, 0.1); }
        .styled-modal-content.status-warning { --ipq-color: #fbbf24; --ipq-bg: rgba(251, 191, 36, 0.1); }
        .styled-modal-content.status-not-qualified { --ipq-color: #f43f5e; --ipq-bg: rgba(244, 63, 94, 0.1); }
        
        .styled-modal-content .styled-modal-header h3 { display: flex; align-items: center; gap: 8px; }
        .styled-modal-content .styled-modal-header svg { width: 24px; height: 24px; }
        .styled-modal-content .styled-modal-header h3,
        .styled-modal-content .styled-modal-header svg {
          color: var(--ipq-color);
          stroke: var(--ipq-color);
          filter: drop-shadow(0 0 8px var(--ipq-color));
          animation: headerGlow 2s ease-in-out infinite alternate;
        }

        @keyframes headerGlow {
          from { filter: drop-shadow(0 0 8px var(--ipq-color)); }
          to { filter: drop-shadow(0 0 16px var(--ipq-color)) drop-shadow(0 0 24px var(--ipq-color)); }
        }

        .ipq-modal {
          position: relative;
          overflow: hidden;
          max-width: 420px;
          background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%);
          backdrop-filter: blur(20px);
          border: 2px solid var(--ipq-color);
          border-radius: 24px;
          box-shadow: 
            0 0 50px var(--ipq-bg),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }

        /* Animated grid background */
        .ipq-grid {
          position: absolute;
          inset: 0;
          background-image: 
            linear-gradient(to right, var(--ipq-color) 1px, transparent 1px),
            linear-gradient(var(--ipq-color) 1px, transparent 1px);
          background-size: 30px 30px;
          opacity: 0.08;
          animation: moveGrid 25s linear infinite;
          pointer-events: none;
        }

        @keyframes moveGrid {
          from { background-position: 0 0, 0 0; }
          to { background-position: 30px 30px, 30px 30px; }
        }

        .ipq-main {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 32px;
          padding: 32px 24px;
        }

        /* Enhanced circle design */
        .ipq-circle {
          position: relative;
          width: 220px;
          height: 220px;
          animation: circleEntrance 1s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        @keyframes circleEntrance {
          from { 
            opacity: 0; 
            transform: scale(0.5) rotate(-180deg); 
          }
          to { 
            opacity: 1; 
            transform: scale(1) rotate(0deg); 
          }
        }

        .ipq-circle .ring {
          position: absolute;
          border-radius: 50%;
          inset: 0;
        }

        /* Outer rotating ring */
        .ipq-circle .ring.outer {
          border: 4px dashed var(--ipq-color);
          animation: spin 15s linear infinite;
          filter: drop-shadow(0 0 10px var(--ipq-color));
        }

        /* Inner solid ring */
        .ipq-circle .ring.inner {
          inset: 24px;
          border: 3px solid var(--ipq-color);
          opacity: 0.6;
          animation: spinReverse 10s linear infinite;
        }

        /* Glow ring */
        .ipq-circle .ring.glow {
          inset: -8px;
          border: 1px solid var(--ipq-color);
          box-shadow: 
            0 0 30px var(--ipq-color),
            inset 0 0 30px var(--ipq-color);
          opacity: 0.3;
          animation: pulse 3s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { 
            opacity: 0.3; 
            transform: scale(1); 
          }
          50% { 
            opacity: 0.7; 
            transform: scale(1.05); 
          }
        }

        /* Radar sweep effect */
        .ipq-circle .radar {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: conic-gradient(from 0deg, var(--ipq-color) 0deg, transparent 90deg);
          mix-blend-mode: screen;
          animation: spin 8s linear infinite;
          opacity: 0.3;
        }

        /* Center content */
        .ipq-circle .center {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          z-index: 2;
        }

        .ipq-status {
          font-size: 20px;
          font-weight: 800;
          color: var(--ipq-color);
          text-shadow: 0 0 15px var(--ipq-color);
          margin-bottom: 8px;
          animation: statusPulse 2s ease-in-out infinite;
          letter-spacing: 1px;
        }

        @keyframes statusPulse {
          0%, 100% { 
            text-shadow: 0 0 15px var(--ipq-color); 
          }
          50% { 
            text-shadow: 
              0 0 25px var(--ipq-color), 
              0 0 35px var(--ipq-color);
          }
        }

        .ipq-risk {
          font-size: 48px;
          font-weight: 900;
          color: var(--ipq-color);
          text-shadow: 0 0 20px var(--ipq-color);
          font-family: 'Courier New', monospace;
        }

        /* Enhanced particles */
        .particle {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 4px;
          height: 4px;
          background: var(--ipq-color);
          border-radius: 50%;
          animation: 
            orbit 8s linear infinite,
            particleGlow 2s ease-in-out infinite alternate;
          animation-delay: calc(var(--i) * -0.4s);
          box-shadow: 0 0 8px var(--ipq-color);
        }

        @keyframes particleGlow {
          from { 
            box-shadow: 0 0 8px var(--ipq-color);
            opacity: 0.8;
          }
          to { 
            box-shadow: 0 0 16px var(--ipq-color);
            opacity: 1;
          }
        }

        @keyframes orbit {
          from { 
            transform: rotate(0deg) translateX(110px) rotate(0deg); 
          }
          to { 
            transform: rotate(360deg) translateX(110px) rotate(-360deg); 
          }
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes spinReverse {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }

        /* Enhanced checklist */
        .ipq-checklist {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .ipq-check-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: var(--ipq-bg);
          border-radius: 12px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          animation: fadeUp 0.6s ease forwards;
          opacity: 0;
          animation-delay: calc(var(--i) * 0.15s + 0.5s);
          backdrop-filter: blur(10px);
        }

        .ipq-check-card:hover {
          background: rgba(255, 255, 255, 0.15);
          transform: translateX(8px) scale(1.02);
          border-color: var(--ipq-color);
          box-shadow: 0 8px 25px var(--ipq-bg);
        }

        .ipq-check-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .ipq-check-left svg {
          width: 20px;
          height: 20px;
          stroke: #9ca3af;
          filter: drop-shadow(0 0 4px rgba(156, 163, 175, 0.5));
        }

        .ipq-check-left span {
          font-weight: 600;
          color: #e2e8f0;
        }

        .ipq-check-result svg {
          width: 24px;
          height: 24px;
          transition: all 0.3s ease;
        }

        /* Status-specific result icons */
        .check-result-pass .check-icon {
          stroke: #4ade80;
          filter: drop-shadow(0 0 8px #4ade80);
          animation: checkBounce 0.6s ease;
        }

        .check-result-warning .warning-icon {
          stroke: #fbbf24;
          fill: #fbbf24;
          filter: drop-shadow(0 0 8px #fbbf24);
          animation: warningPulse 1.5s ease-in-out infinite;
        }

        .check-result-fail .x-icon {
          stroke: #f43f5e;
          filter: drop-shadow(0 0 8px #f43f5e);
          animation: xShake 0.6s ease;
        }

        @keyframes checkBounce {
          0%, 20%, 53%, 80%, 100% { transform: scale(1); }
          40%, 43% { transform: scale(1.3); }
          70% { transform: scale(1.1); }
        }

        @keyframes warningPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }

        @keyframes xShake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }

        @keyframes fadeUp {
          from { 
            opacity: 0; 
            transform: translateY(20px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }

        /* Footer enhancements */
        .ipq-footer {
          width: 100%;
          padding: 0 24px 24px;
        }

        .ipq-summary {
          font-weight: 700;
          color: var(--ipq-color);
          text-align: center;
          margin-top: 16px;
          font-size: 16px;
          text-shadow: 0 0 10px var(--ipq-color);
          animation: summaryFade 0.8s ease 1.2s both;
        }

        @keyframes summaryFade {
          from { 
            opacity: 0; 
            transform: translateY(10px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }

        .ipq-info-cards {
          display: flex;
          gap: 16px;
          margin-top: 20px;
        }

        .ipq-info-card {
          flex: 1;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 12px;
          padding: 12px;
          text-align: center;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
          animation: cardSlideUp 0.6s ease both;
          animation-delay: 1.4s;
        }

        .ipq-info-card:hover {
          box-shadow: 0 8px 25px rgba(255, 255, 255, 0.1);
          transform: translateY(-4px);
          border-color: var(--ipq-color);
        }

        @keyframes cardSlideUp {
          from { 
            opacity: 0; 
            transform: translateY(15px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }

        .ipq-info-label {
          font-size: 12px;
          color: #9ca3af;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .ipq-info-value {
          font-size: 14px;
          font-weight: 700;
          color: #e5e7eb;
          margin-top: 4px;
        }

        /* Responsive adjustments */
        @media (max-width: 480px) {
          .ipq-modal { max-width: 95vw; }
          .ipq-circle { width: 180px; height: 180px; }
          .ipq-status { font-size: 16px; }
          .ipq-risk { font-size: 36px; }
          .ipq-main { padding: 24px 16px; }
        }
      </style>
      <div class="ipq-modal">
        <div class="ipq-grid"></div>
        <main class="ipq-main">
          <div class="ipq-circle">
            <div class="ring outer"></div>
            <div class="ring inner"></div>
            <div class="ring glow"></div>
            <div class="radar"></div>
            <div class="center">
              <div class="ipq-status">${statusText}</div>
              <div class="ipq-risk">${risk}</div>
            </div>
            ${particles}
          </div>
          <div class="ipq-checklist">${checklistHTML}</div>
        </main>
        <footer class="ipq-footer">
          <div class="ipq-summary">${statusMessage}</div>
          <div class="ipq-info-cards">
            <div class="ipq-info-card">
              <div class="ipq-info-label">IP Address</div>
              <div class="ipq-info-value">${ip}</div>
            </div>
            <div class="ipq-info-card">
              <div class="ipq-info-label">Location</div>
              <div class="ipq-info-value">${flag} ${city ? city+', ' : ''}${cc}</div>
            </div>
            <div class="ipq-info-card">
              <div class="ipq-info-label">ISP</div>
              <div class="ipq-info-value">${isp || 'Unknown'}</div>
            </div>
          </div>
        </footer>
      </div>`;

    const modal = createStyledModal(`${headerIcon} IP Qualification`, html);
    modal.querySelector('.styled-modal-content').classList.add(statusClass);
  }

  function showIPModal(info) {
    const {
      ip = 'Unknown',
      country = 'Unknown',
      city = 'Unknown',
      postal = 'Unknown',
      timezone = 'Unknown',
      isp = 'Unknown'
    } = info || {};

    const globe = `<svg class="ip-info-header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    const mapPin = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
    const mail = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/></svg>`;
    const clock = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    const server = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`;
    const copySVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const checkSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

    const modal = createStyledModal(`${globe} IP Information`, `
      <div class="ip-info-ip-box">
        <span class="ip-info-address">${ip}</span>
        <button class="ip-info-copy">${copySVG}<span>Copy</span></button>
      </div>
      <div class="ip-info-grid">
        <div class="ip-info-card">
          <div class="ip-info-card-icon">${mapPin}</div>
          <div>
            <div class="ip-info-card-label">Country</div>
            <div class="ip-info-card-value">${country}</div>
          </div>
        </div>
        <div class="ip-info-card">
          <div class="ip-info-card-icon">${mapPin}</div>
          <div>
            <div class="ip-info-card-label">City</div>
            <div class="ip-info-card-value">${city}</div>
          </div>
        </div>
        <div class="ip-info-card">
          <div class="ip-info-card-icon">${mail}</div>
          <div>
            <div class="ip-info-card-label">Postal Code</div>
            <div class="ip-info-card-value">${postal}</div>
          </div>
        </div>
        <div class="ip-info-card">
          <div class="ip-info-card-icon">${clock}</div>
          <div>
            <div class="ip-info-card-label">Timezone</div>
            <div class="ip-info-card-value">${timezone}</div>
          </div>
        </div>
        <div class="ip-info-card ip-info-card-span">
          <div class="ip-info-card-icon">${server}</div>
          <div>
            <div class="ip-info-card-label">ISP</div>
            <div class="ip-info-card-value">${isp}</div>
          </div>
        </div>
      </div>
    `);

    const contentEl = modal.querySelector('.styled-modal-content');
    const headerEl = modal.querySelector('.styled-modal-header');
    const bodyEl = modal.querySelector('.styled-modal-body');
    contentEl.classList.add('ip-info-modal');
    headerEl.classList.add('ip-info-header');
    bodyEl.classList.add('ip-info-body');

    const style = document.createElement('style');
    style.textContent = `
      #zepra-styled-modal .ip-info-modal{background-color:rgba(17,24,39,0.8);backdrop-filter:blur(16px);border:1px solid rgba(56,189,248,0.2);box-shadow:0 0 30px rgba(56,189,248,0.1);border-radius:1.25rem;}
      #zepra-styled-modal .ip-info-header{background:linear-gradient(90deg,rgba(56,189,248,0.2),rgba(56,189,248,0));border-bottom:1px solid rgba(56,189,248,0.2);}
      #zepra-styled-modal .ip-info-header h3{margin:0;color:#fff;font-weight:700;display:flex;align-items:center;gap:0.5rem;}
      #zepra-styled-modal .ip-info-header-icon{width:24px;height:24px;animation:spin 20s linear infinite;}
      #zepra-styled-modal .ip-info-body{padding:1.5rem;}
      #zepra-styled-modal .ip-info-ip-box{background-color:rgba(0,0,0,0.3);border:1px solid rgba(56,189,248,0.2);border-radius:0.75rem;padding:0.75rem 1rem;display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;}
      #zepra-styled-modal .ip-info-address{font-family:monospace;font-size:1.25rem;color:#4ade80;text-shadow:0 0 8px #4ade80;}
      #zepra-styled-modal .ip-info-copy{display:flex;align-items:center;gap:0.25rem;background-color:rgba(56,189,248,0.15);border:1px solid rgba(56,189,248,0.4);color:#e2e8f0;padding:0.5rem 0.75rem;border-radius:0.5rem;cursor:pointer;transition:all 0.3s;}
      #zepra-styled-modal .ip-info-copy:hover{background-color:rgba(56,189,248,0.3);}
      #zepra-styled-modal .ip-info-copy.copied{background-color:rgba(74,222,128,0.25);border-color:#4ade80;color:#4ade80;}
      #zepra-styled-modal .ip-info-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:1rem;}
      #zepra-styled-modal .ip-info-card{background-color:rgba(31,41,55,0.5);border:1px solid #374151;border-radius:0.75rem;padding:0.75rem;display:flex;align-items:center;gap:0.5rem;}
      #zepra-styled-modal .ip-info-card-icon{width:32px;height:32px;display:flex;align-items:center;justify-content:center;background-color:rgba(56,189,248,0.15);border-radius:9999px;flex-shrink:0;}
      #zepra-styled-modal .ip-info-card-icon svg{width:18px;height:18px;}
      #zepra-styled-modal .ip-info-card-label{font-size:0.75rem;color:#d1d5db;}
      #zepra-styled-modal .ip-info-card-value{font-weight:600;color:#fff;}
      #zepra-styled-modal .ip-info-card-span{grid-column:span 2;}
      @keyframes spin{from{transform:rotate(0);}to{transform:rotate(360deg);}}
    `;
    modal.appendChild(style);

    const copyBtn = modal.querySelector('.ip-info-copy');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(ip);
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = `${checkSVG}<span>Copied!</span>`;
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = `${copySVG}<span>Copy</span>`;
        }, 1500);
      } catch (e) {}
    });
  }

  async function showFakeInfoModal() {
    const COUNTRY_CODES = "AF AX AL DZ AS AD AO AI AQ AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI KH CM CA CV KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MK MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW".split(' ');
    const datalist = `<datalist id="fiNatList">${COUNTRY_CODES.map(c=>`<option value="${c}">`).join('')}</datalist>`;
    const { fakeInfo } = await chrome.storage.local.get('fakeInfo');

    const icons = {
      userPlus: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>`,
      mail: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/></svg>`,
      phone: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/></svg>`,
      house: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
      cake: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3"/><path d="M12 8v3"/><path d="M17 8v3"/><path d="M7 4h.01"/><path d="M12 4h.01"/><path d="M17 4h.01"/></svg>`,
      copy: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
      pencil: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>`,
      plus: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`
    };

    const content = `
      <div class="fi-controls">
        <select id="fiGender">
          <option value="">Any Gender</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
        <input id="fiNat" list="fiNatList" placeholder="Country code (e.g., us)" />
      </div>
      ${datalist}
      <main id="fiMain" class="fi-main">
        <div id="fiLoader" class="fi-loader"></div>
        <div id="fiData" class="fi-data"></div>
      </main>
      <footer class="fi-footer">
        <button id="fiRegenerate" class="fi-regenerate"><span class="fi-regenerate-text">Regenerate Info</span></button>
      </footer>
    `;
    const modal = createStyledModal(`${icons.userPlus} Fake User Info`, content);

    const contentEl = modal.querySelector('.styled-modal-content');
    const headerEl = modal.querySelector('.styled-modal-header');
    const bodyEl = modal.querySelector('.styled-modal-body');
    contentEl.classList.add('fi-modal');
    headerEl.classList.add('fi-header');
    bodyEl.classList.add('fi-body');

    const style = document.createElement('style');
    style.textContent = `
      #zepra-styled-modal .fi-modal{background-color:rgba(17,24,39,0.7);backdrop-filter:blur(24px);border:1px solid rgba(74,222,128,0.2);box-shadow:0 0 40px rgba(10,70,30,0.5);border-radius:1.25rem;max-width:360px;width:90%;}
      #zepra-styled-modal .fi-header{background:rgba(0,0,0,0.2);border-bottom:1px solid rgba(74,222,128,0.2);}
      #zepra-styled-modal .fi-header h3{margin:0;display:flex;align-items:center;gap:0.5rem;color:#fff;font-weight:700;}
      #zepra-styled-modal .fi-header svg{width:20px;height:20px;color:#4ade80;stroke:#4ade80;filter:drop-shadow(0 0 6px #4ade80);}
      #zepra-styled-modal .fi-body{padding:1rem;display:flex;flex-direction:column;gap:1rem;}
      #zepra-styled-modal .fi-controls{display:flex;gap:0.5rem;}
      #zepra-styled-modal .fi-controls select,#zepra-styled-modal .fi-controls input{flex:1;background:rgba(0,0,0,0.3);border:1px solid #334155;border-radius:0.5rem;color:#e2e8f0;padding:0.5rem;font-size:0.875rem;}
      #zepra-styled-modal .fi-main{display:flex;flex-direction:column;gap:1rem;}
      #zepra-styled-modal .fi-loader .fi-skel-card{height:80px;border-radius:0.75rem;background:#374151;animation:fiPulse 1.5s ease-in-out infinite;}
      #zepra-styled-modal .fi-loader .fi-skel-line{height:16px;border-radius:0.25rem;background:#374151;animation:fiPulse 1.5s ease-in-out infinite;margin-top:0.5rem;}
      @keyframes fiPulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
      #zepra-styled-modal .fi-data{display:flex;flex-direction:column;gap:1rem;}
      #zepra-styled-modal .fi-id-card{position:relative;display:flex;align-items:center;gap:0.75rem;background:rgba(31,41,55,0.5);border:1px solid #374151;border-radius:0.75rem;padding:0.75rem;}
      #zepra-styled-modal .fi-avatar{width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid rgba(74,222,128,0.6);box-shadow:0 0 10px rgba(74,222,128,0.4);}
      #zepra-styled-modal .fi-pic-add{position:absolute;top:-8px;right:-8px;}
      #zepra-styled-modal .fi-name{font-weight:600;color:#fff;}
      #zepra-styled-modal .fi-age{font-size:0.875rem;color:#d1d5db;display:flex;align-items:center;gap:0.25rem;}
      #zepra-styled-modal .fi-age svg{width:16px;height:16px;}
      #zepra-styled-modal .fi-info-row{display:flex;align-items:center;justify-content:space-between;background:rgba(31,41,55,0.5);border:1px solid #374151;border-radius:0.75rem;padding:0.5rem 0.75rem;}
      #zepra-styled-modal .fi-info-left{display:flex;align-items:center;gap:0.5rem;}
      #zepra-styled-modal .fi-info-icon{width:32px;height:32px;background:rgba(74,222,128,0.15);border-radius:9999px;display:flex;align-items:center;justify-content:center;}
      #zepra-styled-modal .fi-info-icon svg{width:18px;height:18px;color:#4ade80;stroke:#4ade80;}
      #zepra-styled-modal .fi-info-label{font-size:0.75rem;color:#d1d5db;}
      #zepra-styled-modal .fi-info-value{font-weight:600;color:#fff;font-size:0.875rem;}
      #zepra-styled-modal .fi-actions{display:flex;gap:0.25rem;}
      #zepra-styled-modal .fi-action{position:relative;background:transparent;border:none;color:#e2e8f0;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background 0.2s;}
      #zepra-styled-modal .fi-action:hover{background:rgba(74,222,128,0.15);}
      #zepra-styled-modal .fi-action svg{width:14px;height:14px;}
      #zepra-styled-modal .fi-action::after{content:attr(data-tip);position:absolute;bottom:100%;left:50%;transform:translate(-50%,-4px);background:#000;color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity 0.2s;}
      #zepra-styled-modal .fi-action:hover::after{opacity:1;}
      #zepra-styled-modal .fi-footer{padding-top:0.5rem;border-top:1px solid rgba(74,222,128,0.2);}
      #zepra-styled-modal .fi-regenerate{width:100%;background:#4ade80;color:#0b1b13;font-weight:600;border:none;border-radius:0.75rem;padding:0.75rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:0.5rem;transition:opacity 0.3s;}
      #zepra-styled-modal .fi-regenerate:disabled{opacity:0.5;cursor:not-allowed;}
      #zepra-styled-modal .fi-spinner{width:16px;height:16px;border:2px solid rgba(0,0,0,0.2);border-top-color:#0b1b13;border-radius:50%;animation:spin 1s linear infinite;}
      @keyframes spin{to{transform:rotate(360deg);}}
    `;
    document.head.appendChild(style);

    const loader = modal.querySelector('#fiLoader');
    const dataEl = modal.querySelector('#fiData');
    const regenBtn = modal.querySelector('#fiRegenerate');

    function showLoader(){
      loader.innerHTML = `
        <div class="fi-skel-card"></div>
        <div class="fi-skel-line"></div>
        <div class="fi-skel-line"></div>
        <div class="fi-skel-line"></div>
      `;
      loader.style.display = 'block';
      dataEl.style.display = 'none';
    }

    function hideLoader(){
      loader.style.display = 'none';
    }

    async function generate(){
      showLoader();
      regenBtn.disabled = true;
      regenBtn.innerHTML = '<span class="fi-spinner"></span><span>Generating...</span>';
      try {
        const gender = modal.querySelector('#fiGender').value;
        const nat = modal.querySelector('#fiNat').value.trim();
        const resp = await chrome.runtime.sendMessage({ type:'GENERATE_FAKE_INFO', gender, nat });
        if (!resp?.ok) throw new Error(resp?.error || 'Failed');
        await chrome.storage.local.set({ fakeInfo: resp.data });
        render(resp.data);
      } catch(e){
        hideLoader();
        regenBtn.disabled = false;
        regenBtn.innerHTML = '<span class="fi-regenerate-text">Regenerate Info</span>';
        showNotification('Failed to generate: '+e.message);
      }
    }

    function render(user){
      const name = `${user.name?.first || ''} ${user.name?.last || ''}`.trim();
      const address = `${user.location?.street?.number || ''} ${user.location?.street?.name || ''}, ${user.location?.city || ''}, ${user.location?.country || ''}`.trim();
      const age = user.dob?.age || '';
      const fields = [
        { label:'Email', value:user.email, key:'email', icon:icons.mail },
        { label:'Phone', value:user.phone, key:'phone', icon:icons.phone },
        { label:'Address', value:address, key:'address1', icon:icons.house }
      ];
      dataEl.innerHTML = `
        <div class="fi-id-card">
          ${user.picture?.large ? `<img class="fi-avatar" src="${user.picture.large}"/>` : ''}
          <div class="fi-id-info">
            <div class="fi-name">${name || 'Unknown'}</div>
            <div class="fi-age">${icons.cake} ${age ? `${age} years old` : ''}</div>
          </div>
          ${user.picture?.large ? `<button id="fiPicAdd" class="fi-action fi-pic-add" data-tip="Add Picture">${icons.plus}</button>` : ''}
        </div>
        ${fields.map((f,i)=>`
          <div class="fi-info-row">
            <div class="fi-info-left">
              <div class="fi-info-icon">${f.icon}</div>
              <div>
                <div class="fi-info-label">${f.label}</div>
                <div class="fi-info-value">${f.value || 'Unknown'}</div>
              </div>
            </div>
            <div class="fi-actions">
              <button class="fi-action" data-copy="${i}" data-tip="Copy">${icons.copy}</button>
              <button class="fi-action" data-write="${i}" data-tip="Write Here">${icons.pencil}</button>
              <button class="fi-action" data-add="${i}" data-tip="Add to Identity">${icons.plus}</button>
            </div>
          </div>
        `).join('')}
      `;
      hideLoader();
      dataEl.style.display = 'flex';
      regenBtn.disabled = false;
      regenBtn.innerHTML = '<span class="fi-regenerate-text">Regenerate Info</span>';

      const picBtn = dataEl.querySelector('#fiPicAdd');
      if(picBtn){
        picBtn.addEventListener('click',()=>{
          addFieldToIdentity(picBtn, user.picture.large, 'profilePictureUrl', 'Picture Saved!');
        });
      }
      dataEl.querySelectorAll('[data-copy]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx = btn.getAttribute('data-copy');
          navigator.clipboard.writeText(fields[idx].value || '');
          showNotification('Copied to clipboard');
        });
      });
      dataEl.querySelectorAll('[data-write]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx = btn.getAttribute('data-write');
          const text = fields[idx].value || '';
          const m = document.getElementById('zepra-styled-modal');
          if (m) m.remove();
          typeAnswer(text);
        });
      });
      dataEl.querySelectorAll('[data-add]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx = btn.getAttribute('data-add');
          addFieldToIdentity(btn, fields[idx].value, fields[idx].key);
        });
      });
    }

    regenBtn.addEventListener('click', async ()=>{
      await chrome.storage.local.remove('fakeInfo');
      generate();
    });

    if(fakeInfo){
      render(fakeInfo);
    }
  }
  async function showRealAddressModal(){
    // Remove existing modal
    const existing = document.getElementById('zepra-real-address-modal');
    if (existing) existing.remove();

    // Create standalone modal
    const modal = document.createElement('div');
    modal.id = 'zepra-real-address-modal';
    modal.innerHTML = `
      <div class="ra-modal-overlay">
        <div class="ra-modal-container">
          <div class="ra-modal-header">
            <div class="ra-header-content">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <h3>Generate Real Address</h3>
            </div>
            <button class="ra-modal-close">&times;</button>
          </div>
          <div class="ra-modal-body">
            <div id="raInputs" class="ra-controls">
              <input id="raCountry" placeholder="Country" class="ra-input"/>
              <input id="raState" placeholder="State/Province" class="ra-input"/>
              <input id="raCity" placeholder="City/Zip Code" class="ra-input"/>
              <button id="raGenerate" class="ra-generate-btn">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v7a2 2 0 0 1-2 2h-4"/><path d="M3 11l-1-1 1-1"/><path d="M18 11h3"/></svg>
                <span>Generate</span>
              </button>
            </div>
            <div id="raLoader" class="ra-loader" style="display:none;">
              <div class="ra-skel-card"></div>
              <div class="ra-skel-line"></div>
              <div class="ra-skel-line"></div>
            </div>
            <div id="raResult" class="ra-data" style="display:none;"></div>
          </div>
        </div>
      </div>
    `;

    // Add clean unified styling
    const raStyle = document.createElement('style');
    raStyle.textContent = `
      #zepra-real-address-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: fadeIn 0.3s ease-out;
      }
      
      .ra-modal-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(8px);
      }
      
      .ra-modal-container {
        position: relative;
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        border: 2px solid #4ade80;
        border-radius: 20px;
        max-width: 450px;
        width: 90%;
        max-height: 80vh;
        overflow: hidden;
        box-shadow: 
          0 0 50px rgba(74, 222, 128, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
        animation: modalSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      
      @keyframes modalSlideIn {
        from { 
          opacity: 0; 
          transform: scale(0.8) translateY(50px); 
        }
        to { 
          opacity: 1; 
          transform: scale(1) translateY(0); 
        }
      }
      
      .ra-modal-header {
        background: rgba(0, 0, 0, 0.4);
        padding: 20px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid rgba(74, 222, 128, 0.2);
      }
      
      .ra-header-content {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      
      .ra-header-content svg {
        width: 24px;
        height: 24px;
        color: #4ade80;
        stroke: #4ade80;
        filter: drop-shadow(0 0 8px #4ade80);
      }
      
      .ra-modal-header h3 {
        margin: 0;
        color: #4ade80;
        font-size: 18px;
        font-weight: bold;
        filter: drop-shadow(0 0 8px #4ade80);
      }
      
      .ra-modal-close {
        background: none;
        border: none;
        color: #e2e8f0;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      
      .ra-modal-close:hover {
        background: rgba(74, 222, 128, 0.2);
        color: #4ade80;
        transform: scale(1.1);
      }
      
      .ra-modal-body {
        padding: 24px;
        overflow-y: auto;
        max-height: 60vh;
      }
      
      .ra-controls {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin-bottom: 1rem;
      }
      
      .ra-input {
        background: rgba(0,0,0,0.3);
        border: 1px solid #334155;
        border-radius: 0.5rem;
        color: #e2e8f0;
        padding: 0.75rem;
        font-size: 0.875rem;
        transition: all 0.3s;
      }
      
      .ra-input:focus {
        outline: none;
        border-color: #4ade80;
        box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.2);
      }
      
      .ra-generate-btn {
        background: #4ade80;
        color: #0b1b13;
        font-weight: 600;
        border: none;
        border-radius: 0.75rem;
        padding: 0.75rem 1rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        transition: all 0.3s;
      }
      
      .ra-generate-btn:hover {
        background: #22d3ee;
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(34,211,238,0.4);
      }
      
      .ra-generate-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
      }
      
      .ra-generate-btn svg {
        width: 16px;
        height: 16px;
      }
      
      .ra-loader {
        padding: 1rem;
      }
      
      .ra-skel-card {
        height: 80px;
        border-radius: 0.75rem;
        background: #374151;
        animation: raPulse 1.5s ease-in-out infinite;
      }
      
      .ra-skel-line {
        height: 16px;
        border-radius: 0.25rem;
        background: #374151;
        animation: raPulse 1.5s ease-in-out infinite;
        margin-top: 0.5rem;
      }
      
      @keyframes raPulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
      
      .ra-data {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      
      .ra-info-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(31,41,55,0.5);
        border: 1px solid #374151;
        border-radius: 0.75rem;
        padding: 0.75rem;
        transition: all 0.3s;
      }
      
      .ra-info-row:hover {
        background: rgba(31,41,55,0.8);
        border-color: #4ade80;
        transform: translateY(-1px);
      }
      
      .ra-info-left {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      
      .ra-info-icon {
        width: 32px;
        height: 32px;
        background: rgba(74,222,128,0.15);
        border-radius: 9999px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .ra-info-icon svg {
        width: 18px;
        height: 18px;
        color: #4ade80;
        stroke: #4ade80;
      }
      
      .ra-info-content {
        flex: 1;
      }
      
      .ra-info-label {
        font-size: 0.75rem;
        color: #d1d5db;
        margin-bottom: 2px;
      }
      
      .ra-info-value {
        font-weight: 600;
        color: #fff;
        font-size: 0.875rem;
      }
      
      .ra-actions {
        display: flex;
        gap: 0.25rem;
      }
      
      .ra-action {
        position: relative;
        background: transparent;
        border: none;
        color: #e2e8f0;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .ra-action:hover {
        background: rgba(74,222,128,0.15);
        transform: scale(1.1);
      }
      
      .ra-action svg {
        width: 14px;
        height: 14px;
      }
      
      .ra-action::after {
        content: attr(data-tip);
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translate(-50%,-8px);
        background: rgba(0,0,0,0.9);
        color: #fff;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 11px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s;
        z-index: 1000;
      }
      
      .ra-action:hover::after {
        opacity: 1;
      }
      
      .ra-regenerate {
        width: 100%;
        background: #4ade80;
        color: #0b1b13;
        font-weight: 600;
        border: none;
        border-radius: 0.75rem;
        padding: 0.75rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        transition: all 0.3s;
        margin-top: 1rem;
      }
      
      .ra-regenerate:hover {
        background: #22d3ee;
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(34,211,238,0.4);
      }
      
      .ra-regenerate svg {
        width: 16px;
        height: 16px;
      }
      
      .ra-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(11,27,19,0.2);
        border-top-color: #0b1b13;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
      
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;
    
    document.head.appendChild(raStyle);
    document.body.appendChild(modal);

    // Event listeners
    modal.querySelector('.ra-modal-close').addEventListener('click', () => {
      modal.remove();
      raStyle.remove();
    });
    
    modal.querySelector('.ra-modal-overlay').addEventListener('click', (e) => {
      if (e.target === modal.querySelector('.ra-modal-overlay')) {
        modal.remove();
        raStyle.remove();
      }
    });
    const loader = modal.querySelector('#raLoader');
    const dataEl = modal.querySelector('#raResult');
    const regenBtn = modal.querySelector('#raGenerate');

    function showLoader(){
      loader.style.display = 'block';
      dataEl.style.display = 'none';
    }

    function hideLoader(){
      loader.style.display = 'none';
    }

    function parse(text){
      try {
        const obj = JSON.parse(text);
        return {
          a1: obj.address_1 || '',
          a2: obj.address_2 || '',
          zip: obj.zip_code || ''
        };
      } catch (e) {
        return { a1: '', a2: '', zip: '' };
      }
    }

    function render(parts){
      hideLoader();
      const fields=[
        {label:'Address 1', value:parts.a1, key:'address1', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`},
        {label:'Address 2', value:parts.a2, key:'address2', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z"/><path d="m3 9 2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9"/><path d="M12 3v6"/></svg>`},
        {label:'Zip Code', value:parts.zip, key:'zipCode', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M21 12c.552 0 1-.448 1-1V5c0-.552-.448-1-1-1H3c-.552 0-1 .448-1 1v6c0 .552.448 1 1 1h18z"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7"/></svg>`}
      ];
      const box = modal.querySelector('#raResult');
      box.innerHTML = fields.map((f,i)=>`
        <div class="ra-info-row">
          <div class="ra-info-left">
            <div class="ra-info-icon">${f.icon}</div>
            <div class="ra-info-content">
              <div class="ra-info-label">${f.label}</div>
              <div class="ra-info-value">${f.value || 'Not provided'}</div>
            </div>
          </div>
          <div class="ra-actions">
            <button class="ra-action" data-copy="${i}" data-tip="Copy">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="ra-action" data-write="${i}" data-tip="Write Here">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2l3 3"/><path d="M11 21H4a2 2 0 0 1-2-2v-7l14.5-14.5a2.12 2.12 0 0 1 3 3L8 17"/></svg>
            </button>
            <button class="ra-action" data-add="${i}" data-tip="Add to Identity">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            </button>
          </div>
        </div>
      `).join('');
      
      // Add regenerate button
      box.innerHTML += `
        <button class="ra-regenerate" id="raRegenerate">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v6h6"/><path d="M21 12A9 9 0 0 0 6 5.3L3 8"/><path d="M21 22v-6h-6"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/></svg>
          <span>Regenerate Info</span>
        </button>
      `;
      
      box.style.display='block';
      chrome.storage.local.set({realAddress: parts});
      box.querySelectorAll('[data-copy]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-copy');
          navigator.clipboard.writeText(fields[idx].value||'');
          showNotification('Copied to clipboard');
        });
      });
      box.querySelectorAll('[data-write]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-write');
          const text=fields[idx].value||'';
          const m=document.getElementById('zepra-styled-modal');
          if(m) m.remove();
          typeAnswer(text);
        });
      });
      box.querySelectorAll('[data-add]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-add');
          addFieldToIdentity(btn, fields[idx].value, fields[idx].key);
        });
      });
      
      box.querySelector('#raRegenerate').addEventListener('click', async ()=>{
        await chrome.storage.local.remove('realAddress');
        modal.remove();
        showCleanRealAddressModal();
      });
    }

    if(saved){
      modal.querySelector('#raInputs').style.display='none';
      render(saved);
    }

    async function generate(){
      showLoader();
      regenBtn.disabled = true;
      regenBtn.innerHTML = '<span class="ra-spinner"></span><span>Generating...</span>';
      try{
        const country=modal.querySelector('#raCountry').value.trim();
        const state=modal.querySelector('#raState').value.trim();
        const city=modal.querySelector('#raCity').value.trim();
        const resp=await chrome.runtime.sendMessage({type:'GENERATE_REAL_ADDRESS', country, state, city});
        if(!resp?.ok) throw new Error(resp?.error||'Failed');
        modal.querySelector('#raInputs').style.display='none';
        render(parse(resp.result));
      }catch(e){
        hideLoader();
        regenBtn.disabled = false;
        regenBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v7a2 2 0 0 1-2 2h-4"/><path d="M3 11l-1-1 1-1"/><path d="M18 11h3"/></svg><span>Generate</span>';
        showNotification('Failed to generate: '+e.message);
      }
    }

    modal.querySelector('#raGenerate').addEventListener('click', generate);
  }

  // Clean Real Address Modal - New Implementation
  async function showCleanRealAddressModal(){
    // Remove existing modal
    const existing = document.getElementById('zepra-real-address-modal');
    if (existing) existing.remove();

    // Create standalone modal
    const modal = document.createElement('div');
    modal.id = 'zepra-real-address-modal';
    modal.innerHTML = `
      <div class="ra-modal-overlay">
        <div class="ra-modal-container">
          <div class="ra-modal-header">
            <div class="ra-header-content">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <h3>Generate Real Address</h3>
            </div>
            <button class="ra-modal-close">&times;</button>
          </div>
          <div class="ra-modal-body">
            <div id="raInputs" class="ra-controls">
              <input id="raCountry" placeholder="Country" class="ra-input"/>
              <input id="raState" placeholder="State/Province" class="ra-input"/>
              <input id="raCity" placeholder="City/Zip Code" class="ra-input"/>
              <button id="raGenerate" class="ra-generate-btn">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v7a2 2 0 0 1-2 2h-4"/><path d="M3 11l-1-1 1-1"/><path d="M18 11h3"/></svg>
                <span>Generate</span>
              </button>
            </div>
            <div id="raLoader" class="ra-loader" style="display:none;">
              <div class="ra-skel-card"></div>
              <div class="ra-skel-line"></div>
              <div class="ra-skel-line"></div>
            </div>
            <div id="raResult" class="ra-data" style="display:none;"></div>
          </div>
        </div>
      </div>
    `;

    // Add clean unified styling
    const raStyle = document.createElement('style');
    raStyle.textContent = `
             @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
       #zepra-real-address-modal {
         position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 2147483647;
         display: flex; align-items: center; justify-content: center; animation: fadeIn 0.3s ease-out;
       }
      .ra-modal-overlay { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.8); backdrop-filter: blur(8px); }
      .ra-modal-container {
        position: relative; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 2px solid #4ade80;
        border-radius: 20px; max-width: 450px; width: 90%; max-height: 80vh; overflow: hidden;
        box-shadow: 0 0 50px rgba(74, 222, 128, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1);
        animation: modalSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      @keyframes modalSlideIn { from { opacity: 0; transform: scale(0.8) translateY(50px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      .ra-modal-header { background: rgba(0, 0, 0, 0.4); padding: 20px 24px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(74, 222, 128, 0.2); }
      .ra-header-content { display: flex; align-items: center; gap: 12px; }
      .ra-header-content svg { width: 24px; height: 24px; color: #4ade80; stroke: #4ade80; filter: drop-shadow(0 0 8px #4ade80); }
      .ra-modal-header h3 { margin: 0; color: #4ade80; font-size: 18px; font-weight: bold; filter: drop-shadow(0 0 8px #4ade80); }
      .ra-modal-close { background: none; border: none; color: #e2e8f0; font-size: 24px; cursor: pointer; padding: 0; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
      .ra-modal-close:hover { background: rgba(74, 222, 128, 0.2); color: #4ade80; transform: scale(1.1); }
      .ra-modal-body { padding: 24px; overflow-y: auto; max-height: 60vh; }
      .ra-controls { display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1rem; }
      .ra-input { background: rgba(0,0,0,0.3); border: 1px solid #334155; border-radius: 0.5rem; color: #e2e8f0; padding: 0.75rem; font-size: 0.875rem; transition: all 0.3s; }
      .ra-input:focus { outline: none; border-color: #4ade80; box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.2); }
      .ra-generate-btn { background: #4ade80; color: #0b1b13; font-weight: 600; border: none; border-radius: 0.75rem; padding: 0.75rem 1rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem; transition: all 0.3s; }
      .ra-generate-btn:hover { background: #22d3ee; transform: translateY(-2px); box-shadow: 0 8px 25px rgba(34,211,238,0.4); }
      .ra-generate-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
      .ra-generate-btn svg { width: 16px; height: 16px; }
      .ra-loader { padding: 1rem; }
      .ra-skel-card { height: 80px; border-radius: 0.75rem; background: #374151; animation: raPulse 1.5s ease-in-out infinite; }
      .ra-skel-line { height: 16px; border-radius: 0.25rem; background: #374151; animation: raPulse 1.5s ease-in-out infinite; margin-top: 0.5rem; }
      @keyframes raPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      .ra-data { display: flex; flex-direction: column; gap: 1rem; }
      .ra-info-row { display: flex; align-items: center; justify-content: space-between; background: rgba(31,41,55,0.5); border: 1px solid #374151; border-radius: 0.75rem; padding: 0.75rem; transition: all 0.3s; }
      .ra-info-row:hover { background: rgba(31,41,55,0.8); border-color: #4ade80; transform: translateY(-1px); }
      .ra-info-left { display: flex; align-items: center; gap: 0.75rem; }
      .ra-info-icon { width: 32px; height: 32px; background: rgba(74,222,128,0.15); border-radius: 9999px; display: flex; align-items: center; justify-content: center; }
      .ra-info-icon svg { width: 18px; height: 18px; color: #4ade80; stroke: #4ade80; }
      .ra-info-content { flex: 1; }
      .ra-info-label { font-size: 0.75rem; color: #d1d5db; margin-bottom: 2px; }
      .ra-info-value { font-weight: 600; color: #fff; font-size: 0.875rem; }
      .ra-actions { display: flex; gap: 0.25rem; }
      .ra-action { position: relative; background: transparent; border: none; color: #e2e8f0; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
      .ra-action:hover { background: rgba(74,222,128,0.15); transform: scale(1.1); }
      .ra-action svg { width: 14px; height: 14px; }
      .ra-action::after { content: attr(data-tip); position: absolute; bottom: 100%; left: 50%; transform: translate(-50%,-8px); background: rgba(0,0,0,0.9); color: #fff; padding: 4px 8px; border-radius: 6px; font-size: 11px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 0.2s; z-index: 1000; }
      .ra-action:hover::after { opacity: 1; }
      .ra-regenerate { width: 100%; background: #4ade80; color: #0b1b13; font-weight: 600; border: none; border-radius: 0.75rem; padding: 0.75rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem; transition: all 0.3s; margin-top: 1rem; }
      .ra-regenerate:hover { background: #22d3ee; transform: translateY(-2px); box-shadow: 0 8px 25px rgba(34,211,238,0.4); }
      .ra-regenerate svg { width: 16px; height: 16px; }
      .ra-spinner { width: 16px; height: 16px; border: 2px solid rgba(11,27,19,0.2); border-top-color: #0b1b13; border-radius: 50%; animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
    `;
    
    document.head.appendChild(raStyle);
    document.body.appendChild(modal);

    // Event listeners
    modal.querySelector('.ra-modal-close').addEventListener('click', () => {
      modal.remove();
      raStyle.remove();
    });
    
    modal.querySelector('.ra-modal-overlay').addEventListener('click', (e) => {
      if (e.target === modal.querySelector('.ra-modal-overlay')) {
        modal.remove();
        raStyle.remove();
      }
    });

    // Get elements
    const loader = modal.querySelector('#raLoader');
    const dataEl = modal.querySelector('#raResult');
    const regenBtn = modal.querySelector('#raGenerate');

    // Utility functions
    function showLoader(){
      loader.style.display = 'block';
      dataEl.style.display = 'none';
    }

    function hideLoader(){
      loader.style.display = 'none';
    }

    function parse(text){
      try {
        const obj = JSON.parse(text);
        return {
          a1: obj.address_1 || '',
          a2: obj.address_2 || '',
          zip: obj.zip_code || ''
        };
      } catch (e) {
        return { a1: '', a2: '', zip: '' };
      }
    }

    function render(parts){
      hideLoader();
      const fields=[
        {label:'Address 1', value:parts.a1, key:'address1', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`},
        {label:'Address 2', value:parts.a2, key:'address2', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z"/><path d="m3 9 2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9"/><path d="M12 3v6"/></svg>`},
        {label:'Zip Code', value:parts.zip, key:'zipCode', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M21 12c.552 0 1-.448 1-1V5c0-.552-.448-1-1-1H3c-.552 0-1 .448-1 1v6c0 .552.448 1 1 1h18z"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7"/></svg>`}
      ];
      
      dataEl.style.display = 'block';
      dataEl.innerHTML = fields.map((f,i)=>`
        <div class="ra-info-row">
          <div class="ra-info-left">
            <div class="ra-info-icon">${f.icon}</div>
            <div class="ra-info-content">
              <div class="ra-info-label">${f.label}</div>
              <div class="ra-info-value">${f.value || 'Not provided'}</div>
            </div>
          </div>
          <div class="ra-actions">
            <button class="ra-action" data-copy="${i}" data-tip="Copy">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="ra-action" data-write="${i}" data-tip="Write Here">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
            </button>
            <button class="ra-action" data-add="${i}" data-tip="Add to Identity">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
            </button>
          </div>
        </div>
      `).join('') + `
        <button class="ra-regenerate" id="raRegenerate">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
          <span>Regenerate Address</span>
        </button>
      `;

      // Event listeners for actions
      dataEl.querySelectorAll('[data-copy]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-copy');
          navigator.clipboard.writeText(fields[idx].value||'');
          showNotification('Copied to clipboard');
        });
      });
      
      dataEl.querySelectorAll('[data-write]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-write');
          writeInFocusedInput(fields[idx].value||'');
        });
      });
      
      dataEl.querySelectorAll('[data-add]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-add');
          addFieldToIdentity(btn, fields[idx].value, fields[idx].key);
        });
      });

      // Regenerate button
      dataEl.querySelector('#raRegenerate').addEventListener('click', async () => {
        await chrome.storage.local.remove('realAddress');
        modal.remove();
        raStyle.remove();
        showCleanRealAddressModal();
      });
    }

    // Generate function
    async function generate(){
      showLoader();
      regenBtn.disabled = true;
      regenBtn.innerHTML = '<span class="ra-spinner"></span><span>Generating...</span>';
      
      try{
        const country = modal.querySelector('#raCountry').value.trim();
        const state = modal.querySelector('#raState').value.trim();
        const city = modal.querySelector('#raCity').value.trim();
        
        const resp = await chrome.runtime.sendMessage({type:'GENERATE_REAL_ADDRESS', country, state, city});
        if(!resp?.ok) throw new Error(resp?.error||'Failed');
        
        modal.querySelector('#raInputs').style.display='none';
        render(parse(resp.result));
        
        await chrome.storage.local.set({ realAddress: parse(resp.result) });
      }catch(e){
        hideLoader();
        regenBtn.disabled = false;
        regenBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v7a2 2 0 0 1-2 2h-4"/><path d="M3 11l-1-1 1-1"/><path d="M18 11h3"/></svg><span>Generate</span>';
        showNotification('Failed to generate: '+e.message);
      }
    }

    // Event listener for generate button
    regenBtn.addEventListener('click', generate);

    // Check for saved data
    const saved = (await chrome.storage.local.get('realAddress')).realAddress;
    if (saved && (saved.a1 || saved.a2 || saved.zip)) {
      modal.querySelector('#raInputs').style.display='none';
      render(saved);
    }
  }

  async function showCompanyInfoModal(){
    // Remove existing modal
    const existing = document.getElementById('zepra-company-modal');
    if (existing) existing.remove();

    // Create standalone modal
    const modal = document.createElement('div');
    modal.id = 'zepra-company-modal';
    modal.innerHTML = `
      <div class="ci-modal-overlay">
        <div class="ci-modal-container">
          <div class="ci-modal-header">
            <div class="ci-header-content">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>
              <h3>Generate Company Info</h3>
            </div>
            <button class="ci-modal-close">&times;</button>
          </div>
          <div class="ci-modal-body">
            <div id="ciLoader" class="ci-loader">
              <div class="ci-skel-card"></div>
              <div class="ci-skel-line"></div>
              <div class="ci-skel-line"></div>
              <div class="ci-skel-line"></div>
            </div>
            <div id="ciResult" class="ci-data" style="display:none;"></div>
          </div>
        </div>
      </div>
    `;
    
    // Add unified styling for company info
    const ciStyle = document.createElement('style');
    ciStyle.textContent = `
      #zepra-company-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: fadeIn 0.3s ease-out;
      }
      
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      .ci-modal-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(8px);
      }
      
      .ci-modal-container {
        position: relative;
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        border: 2px solid #4ade80;
        border-radius: 20px;
        max-width: 450px;
        width: 90%;
        max-height: 80vh;
        overflow: hidden;
        box-shadow: 
          0 0 50px rgba(74, 222, 128, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
        animation: modalSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      
      @keyframes modalSlideIn {
        from { 
          opacity: 0; 
          transform: scale(0.8) translateY(50px); 
        }
        to { 
          opacity: 1; 
          transform: scale(1) translateY(0); 
        }
      }
      
      .ci-modal-header {
        background: rgba(0, 0, 0, 0.4);
        padding: 20px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid rgba(74, 222, 128, 0.2);
      }
      
      .ci-header-content {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      
      .ci-header-content svg {
        width: 24px;
        height: 24px;
        color: #4ade80;
        stroke: #4ade80;
        filter: drop-shadow(0 0 8px #4ade80);
      }
      
      .ci-modal-header h3 {
        margin: 0;
        color: #4ade80;
        font-size: 18px;
        font-weight: bold;
        filter: drop-shadow(0 0 8px #4ade80);
      }
      
      .ci-modal-close {
        background: none;
        border: none;
        color: #e2e8f0;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      
      .ci-modal-close:hover {
        background: rgba(74, 222, 128, 0.2);
        color: #4ade80;
        transform: scale(1.1);
      }
      
      .ci-modal-body {
        padding: 24px;
        overflow-y: auto;
        max-height: 60vh;
      }
      
      .ci-loader{padding:1rem;}
      .ci-loader .ci-skel-card{height:80px;border-radius:0.75rem;background:#374151;animation:ciPulse 1.5s ease-in-out infinite;}
      .ci-loader .ci-skel-line{height:16px;border-radius:0.25rem;background:#374151;animation:ciPulse 1.5s ease-in-out infinite;margin-top:0.5rem;}
      @keyframes ciPulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
      .ci-data{display:flex;flex-direction:column;gap:1rem;}
      .ci-info-row{display:flex;align-items:center;justify-content:space-between;background:rgba(31,41,55,0.5);border:1px solid #374151;border-radius:0.75rem;padding:0.75rem;transition:all 0.3s;}
      .ci-info-row:hover{background:rgba(31,41,55,0.8);border-color:#4ade80;transform:translateY(-1px);}
      .ci-info-left{display:flex;align-items:center;gap:0.75rem;}
      .ci-info-icon{width:32px;height:32px;background:rgba(74,222,128,0.15);border-radius:9999px;display:flex;align-items:center;justify-content:center;}
      .ci-info-icon svg{width:18px;height:18px;color:#4ade80;stroke:#4ade80;}
      .ci-info-content{flex:1;}
      .ci-info-label{font-size:0.75rem;color:#d1d5db;margin-bottom:2px;}
      .ci-info-value{font-weight:600;color:#fff;font-size:0.875rem;}
      .ci-actions{display:flex;gap:0.25rem;}
      .ci-action{position:relative;background:transparent;border:none;color:#e2e8f0;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s;}
      .ci-action:hover{background:rgba(74,222,128,0.15);transform:scale(1.1);}
      .ci-action svg{width:14px;height:14px;}
      .ci-action::after{content:attr(data-tip);position:absolute;bottom:100%;left:50%;transform:translate(-50%,-8px);background:rgba(0,0,0,0.9);color:#fff;padding:4px 8px;border-radius:6px;font-size:11px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity 0.2s;z-index:1000;}
      .ci-action:hover::after{opacity:1;}
      .ci-regenerate{width:100%;background:#4ade80;color:#0b1b13;font-weight:600;border:none;border-radius:0.75rem;padding:0.75rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:0.5rem;transition:all 0.3s;margin-top:1rem;}
      .ci-regenerate:hover{background:#22d3ee;transform:translateY(-2px);box-shadow:0 8px 25px rgba(34,211,238,0.4);}
      .ci-regenerate svg{width:16px;height:16px;}
      .ci-spinner{width:16px;height:16px;border:2px solid rgba(11,27,19,0.2);border-top-color:#0b1b13;border-radius:50%;animation:spin 1s linear infinite;}
      @keyframes spin{to{transform:rotate(360deg);}}
    `;
    document.head.appendChild(ciStyle);
    document.body.appendChild(modal);

    // Event listeners
    modal.querySelector('.ci-modal-close').addEventListener('click', () => {
      modal.remove();
      ciStyle.remove();
    });
    
    modal.querySelector('.ci-modal-overlay').addEventListener('click', (e) => {
      if (e.target === modal.querySelector('.ci-modal-overlay')) {
        modal.remove();
        ciStyle.remove();
      }
    });
    const loader = modal.querySelector('#ciLoader');
    const dataEl = modal.querySelector('#ciResult');
    try{
      const res = await chrome.runtime.sendMessage({ type:'GENERATE_COMPANY' });
      if(!res?.ok) throw new Error('fetch');
      let data;
      try {
        data = JSON.parse(res.result);
      } catch (err) {
        console.error('Zepra Debug: Failed to parse AI response. Raw response was:', res?.result);
        throw new Error('parse');
      }
      const fields = [
        {label:'Company Name', value:data.companyName, key:'companyName', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>`},
        {label:'Industry', value:data.companyIndustry, key:'companyIndustry', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`},
        {label:'Company Size', value:data.companySize, key:'companySize', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m22 21-3-3 3-3"/><path d="M16 8h.01"/></svg>`},
        {label:'Annual Revenue', value:data.companyAnnualRevenue, key:'companyAnnualRevenue', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`},
        {label:'Website', value:data.companyWebsite, key:'companyWebsite', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`},
        {label:'Address', value:data.companyAddress, key:'companyAddress', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`}
      ];
      
      loader.style.display = 'none';
      dataEl.innerHTML = fields.map((f,i)=>`
        <div class="ci-info-row">
          <div class="ci-info-left">
            <div class="ci-info-icon">${f.icon}</div>
            <div class="ci-info-content">
              <div class="ci-info-label">${f.label}</div>
              <div class="ci-info-value">${f.value || 'Not provided'}</div>
            </div>
          </div>
          <div class="ci-actions">
            <button class="ci-action" data-copy="${i}" data-tip="Copy">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="ci-action" data-add="${i}" data-tip="Add to Identity">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            </button>
          </div>
        </div>
      `).join('');
      
      // Add regenerate button
      dataEl.innerHTML += `
        <button class="ci-regenerate" onclick="document.getElementById('zepra-styled-modal').remove(); showCompanyInfoModal();">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v6h6"/><path d="M21 12A9 9 0 0 0 6 5.3L3 8"/><path d="M21 22v-6h-6"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/></svg>
          <span>Regenerate Company</span>
        </button>
      `;
      
      dataEl.style.display = 'block';
      dataEl.querySelectorAll('[data-copy]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-copy');
          navigator.clipboard.writeText(fields[idx].value||'');
          showNotification('Copied to clipboard');
        });
      });
      dataEl.querySelectorAll('[data-add]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-add');
          addFieldToIdentity(btn, fields[idx].value, fields[idx].key);
        });
      });
    }catch(e){
      loader.style.display = 'none';
      dataEl.style.display = 'block';
      if(e.message === 'parse') {
        dataEl.innerHTML = '<div style="text-align:center;color:#f43f5e;padding:2rem;">Error: AI provided an invalid response format.</div>';
      } else {
        dataEl.innerHTML = '<div style="text-align:center;color:#f43f5e;padding:2rem;">Error: Could not connect to the AI service. Please check your API key and network connection.</div>';
      }
    }
  }

  function showLastAnswerModal(answer) {
    const text = (answer || '').trim();
    if (!text) { showNotification('No last answer available'); return; }
    const modal = createStyledModal('Last Answer', `
      <div style="background: linear-gradient(120deg, #120f12 80%, #0a0f17 100%); padding: 20px; border-radius: 10px; margin: 10px 0;">
        <div id="lastAnswerText" style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; margin-bottom: 20px; max-height: 200px; overflow-y: auto; color: #e2e8f0;">${text}</div>
        <div id="lastAnswerCountdown" style="display:none; text-align:center; font-size:24px; font-weight:bold; color:#39ff14; margin-bottom:20px;">3</div>
        <div id="lastAnswerBtns" style="display: flex; justify-content: center; gap: 10px;">
          <button id="lastAnswerType" style="background: linear-gradient(45deg, #4ecdc4, #44a08d); border: none; color: white; padding: 10px 20px; border-radius: 25px; cursor: pointer; font-weight: bold;">Start Typing</button>
          <button id="lastAnswerCopy" style="background: linear-gradient(45deg, #ff6b6b, #feca57); border: none; color: white; padding: 10px 20px; border-radius: 25px; cursor: pointer; font-weight: bold;">Manual Entry</button>
        </div>
      </div>
    `);

    setTimeout(() => {
      document.getElementById('lastAnswerType')?.addEventListener('click', async () => {
        const txt = document.getElementById('lastAnswerText');
        const cd = document.getElementById('lastAnswerCountdown');
        const btns = document.getElementById('lastAnswerBtns');
        if (txt) txt.style.display = 'none';
        if (btns) btns.style.display = 'none';
        if (cd) {
          cd.style.display = 'block';
          let count = 3;
          cd.textContent = count;
          const timer = setInterval(() => {
            count--;
            if (count > 0) {
              cd.textContent = count;
            } else {
              clearInterval(timer);
              const m = document.getElementById('zepra-styled-modal');
              if (m) m.remove();
              typeAnswer(text, { skipCountdown: true });
            }
          }, 1000);
        }
      });
      document.getElementById('lastAnswerCopy')?.addEventListener('click', () => {
        navigator.clipboard.writeText(text);
        const m = document.getElementById('zepra-styled-modal'); if (m) m.remove();
        showNotification('Answer copied to clipboard');
      });
    }, 100);
  }

  function showNewSurveyModal() {
    navigator.clipboard.readText().then(clipboardText => {
      const modal = createStyledModal('New Survey', `
        <div style="background: linear-gradient(120deg, #120f12 80%, #0a0f17 100%); padding: 20px; border-radius: 10px; margin: 10px 0;">
          <p style="color: #e2e8f0; margin-bottom: 15px;">The text in your clipboard will be typed in human-like manner:</p>
          <div id="newSurveyText" style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; margin: 15px 0; max-height: 150px; overflow-y: auto;">
            <pre style="color: #94a3b8; white-space: pre-wrap; font-size: 14px; margin: 0;">${clipboardText || 'No text in clipboard'}</pre>
          </div>
          <div id="newSurveyCountdown" style="display:none; text-align:center; font-size:24px; font-weight:bold; color:#39ff14; margin-bottom:20px;">3</div>
          <div id="newSurveyBtns" style="display: flex; justify-content: center; gap: 10px; margin-top: 20px;">
            <button id="writeNowBtn" style="background: linear-gradient(45deg, #4ecdc4, #44a08d); border: none; color: white; padding: 12px 24px; border-radius: 25px; cursor: pointer; font-weight: bold; font-size: 14px;">Start Typing</button>
            <button id="manualEntryBtn" style="background: linear-gradient(45deg, #ff6b6b, #feca57); border: none; color: white; padding: 12px 24px; border-radius: 25px; cursor: pointer; font-weight: bold; font-size: 14px;">Manual Entry</button>
          </div>
        </div>
      `, () => {
        // Clear new survey context
        chrome.runtime.sendMessage({ type: 'NEW_SURVEY_CONTEXT' });
      });

      // Add event listener for Write Now button
      setTimeout(() => {
        const writeBtn = document.getElementById('writeNowBtn');
        const manualBtn = document.getElementById('manualEntryBtn');
        const txt = document.getElementById('newSurveyText');
        const cd = document.getElementById('newSurveyCountdown');
        const btns = document.getElementById('newSurveyBtns');
        if (writeBtn) {
          writeBtn.addEventListener('click', () => {
            if (txt) txt.style.display = 'none';
            if (btns) btns.style.display = 'none';
            if (cd) {
              cd.style.display = 'block';
              let count = 3; cd.textContent = count;
              const interval = setInterval(() => {
                count--;
                if (count > 0) {
                  cd.textContent = count;
                } else {
                  clearInterval(interval);
                  const m = document.getElementById('zepra-styled-modal');
                  if (m) m.remove();
                  typeAnswer(clipboardText, { skipCountdown: true });
                }
              }, 1000);
            }
          });
        }
        if (manualBtn) {
          manualBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(clipboardText || '');
            const m = document.getElementById('zepra-styled-modal'); if (m) m.remove();
            showNotification('Answer copied to clipboard');
          });
        }
      }, 100);
    }).catch(() => {
      showNotification('Could not access clipboard');
    });
  }

  function startOCRCapture() {
    showOverlayAndSelect().then(async (rect) => {
      if (!rect) return;
      try {
        const { ocrLang = 'eng' } = await chrome.storage.local.get('ocrLang');
        const response = await chrome.runtime.sendMessage({
          type: 'CAPTURE_AND_OCR',
          rect: rect,
          tabId: await getTabId(),
          ocrLang
        });
        if (response?.ok) {
          showOCRResultModal(response.text);
        } else {
          showNotification('OCR failed: ' + (response?.error || 'Unknown error'));
        }
      } catch (e) {
        showNotification('OCR error: ' + e.message);
      }
    });
  }

  async function startFullPageOCR() {
    try {
      showNotification('Starting full page OCR...');
      const { ocrLang = 'eng' } = await chrome.storage.local.get('ocrLang');
      const response = await chrome.runtime.sendMessage({
        type: 'CAPTURE_FULL_PAGE_OCR',
        tabId: await getTabId(),
        ocrLang
      });
      if (response?.ok) {
        showOCRResultModal(response.text);
      } else {
        showNotification('OCR failed: ' + (response?.error || 'Unknown error'));
      }
    } catch (e) {
      showNotification('OCR error: ' + e.message);
    }
  }

  function showOCRResultModal(extractedText) {
    const modal = createStyledModal('OCR Result', `
      <div style="background: linear-gradient(120deg, #120f12 80%, #0a0f17 100%); padding: 20px; border-radius: 10px; margin: 10px 0;">
        <p style="color: #e2e8f0; margin-bottom: 15px;">Extracted Text:</p>
        <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; margin: 15px 0; max-height: 300px; overflow-y: auto;">
          <pre style="color: #94a3b8; white-space: pre-wrap; font-size: 14px; margin: 0;">${extractedText}</pre>
        </div>
        <div style="display: flex; justify-content: center; gap: 10px; margin-top: 20px;">
          <button id="sendToAI" style="background: linear-gradient(45deg, #ff6b6b, #4ecdc4); border: none; color: white; padding: 10px 20px; border-radius: 25px; cursor: pointer; font-weight: bold;">Send to AI</button>
          <button id="retakeOCR" style="background: linear-gradient(45deg, #feca57, #ff9ff3); border: none; color: white; padding: 10px 20px; border-radius: 25px; cursor: pointer; font-weight: bold;">Retake</button>
        </div>
      </div>
    `);

    // Add event listeners
    setTimeout(() => {
      const sendBtn = document.getElementById('sendToAI');
      const retakeBtn = document.getElementById('retakeOCR');
      
      if (sendBtn) {
        sendBtn.addEventListener('click', () => {
          const modal = document.getElementById('zepra-styled-modal');
          if (modal) modal.remove();
          createRainbowModal(extractedText);
        });
      }
      
      if (retakeBtn) {
        retakeBtn.addEventListener('click', () => {
          const modal = document.getElementById('zepra-styled-modal');
          if (modal) modal.remove();
          startOCRCapture();
        });
      }
    }, 100);
  }

  function createStyledModal(title, content, onClose) {
    // Remove existing modal
    const existing = document.getElementById('zepra-styled-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'zepra-styled-modal';
    modal.innerHTML = `
      <div class="styled-modal-content">
        <div class="styled-modal-header">
          <h3>${title}</h3>
          <button class="styled-modal-close">&times;</button>
        </div>
        <div class="styled-modal-body">
          ${content}
        </div>
      </div>
    `;

    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.3s ease-out;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      .styled-modal-content {
        background: linear-gradient(135deg, #23272b 0%, #120f12 100%);
        border-radius: 15px;
        padding: 0;
        max-width: 500px;
        width: 90%;
        max-height: 80vh;
        overflow: hidden;
        border: 3px solid #39ff14;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      }
      
      .styled-modal-header {
        background: rgba(0,0,0,0.2);
        padding: 15px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #292d33;
      }
      
      .styled-modal-header h3 {
        margin: 0;
        color: #39ff14;
        font-size: 18px;
        font-weight: bold;
      }
      
      .styled-modal-close {
        background: none;
        border: none;
        color: #e2e8f0;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }
      
      .styled-modal-close:hover {
        background: rgba(255,255,255,0.2);
      }
      
      .styled-modal-body {
        padding: 20px;
        color: #e2e8f0;
        overflow-y: auto;
        max-height: 60vh;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(modal);

    // Event listeners
    modal.querySelector('.styled-modal-close').addEventListener('click', () => {
      modal.remove();
      style.remove();
      if (onClose) onClose();
    });
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
        style.remove();
        if (onClose) onClose();
      }
    });

    return modal;
  }

  function showNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #23272b 0%, #120f12 100%);
      color: #e2e8f0;
      padding: 15px 20px;
      border-radius: 10px;
      box-shadow: 0 5px 20px rgba(0,0,0,0.3);
      z-index: 2147483649;
      font-size: 14px;
      white-space: pre-line;
      text-align: center;
      animation: slideDown 0.3s ease-out;
      border: 2px solid #39ff14;
    `;
    
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideUp 0.3s ease-out forwards';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  async function createRainbowModal(selectedText, customPromptId = null) {
    if (STATE.modal) return;

    const { showReasoning = false } = await chrome.storage.local.get('showReasoning');

    const modal = document.createElement('div');
    modal.id = 'zepra-modal';
    modal.innerHTML = `
      <div class="za-modal">
        <header class="za-header">
          <h2>Zepra Answer</h2>
          <button class="modal-close">×</button>
        </header>
        <main class="za-body">
          <div class="za-question-box">${selectedText}</div>
          <div class="answer-container${showReasoning ? ' split' : ''}">
            <div class="loading"></div>
            ${showReasoning ? `
            <div class="split-pane" style="display:none;">
              <div class="pane answer-pane">
                <div class="pane-title">Answer</div>
                <div class="answer-text"></div>
                <button class="btn-copy-answer">Copy</button>
              </div>
              <div class="pane reason-pane">
                <div class="pane-title">Reason</div>
                <div class="reason-text"></div>
                <button class="btn-copy-reason">Copy</button>
              </div>
            </div>
            ` : `
            <div class="answer-text" style="display:none;"></div>
            `}
          </div>
        </main>
        <footer class="za-footer">
          <div class="modal-actions" style="display:none;">
            <button class="btn-write-here action-btn" data-color="cyan">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z" />
                <path d="M16 8 2 22" />
                <path d="M17.5 15H9" />
              </svg>
              <span>Write Here</span>
            </button>
            <button class="btn-write-all action-btn" data-color="gray">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z" />
                <path d="M16 8 2 22" />
                <path d="M17.5 15H9" />
              </svg>
              <span>Write All</span>
            </button>
            ${showReasoning ? '' : `<button class="btn-copy action-btn" data-color="pink">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
              <span>Copy</span>
            </button>`}
            <button class="btn-humanizer action-btn" data-color="teal">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 4V2" />
                <path d="M15 16v-2" />
                <path d="M8 9h2" />
                <path d="M20 9h2" />
                <path d="M17.8 11.8 19 13" />
                <path d="M15 9h.01" />
                <path d="M17.8 6.2 19 5" />
                <path d="m3 21 9-9" />
                <path d="M12.2 6.2 11 5" />
              </svg>
              <span>AI Humanizer</span>
            </button>
            <button class="btn-use-prompt action-btn" data-color="yellow">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
              </svg>
              <span>Use Custom Prompt</span>
            </button>
          </div>
        </footer>
      </div>
    `;

    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.3s ease-out;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .answer-container.split .split-pane{display:flex;gap:10px;}
      .answer-container.split .pane{flex:1;background:#1f1f1f;padding:10px;border-radius:6px;display:flex;flex-direction:column;}
      .answer-container.split .pane-title{font-weight:bold;margin-bottom:6px;}
      .answer-container.split .pane button{align-self:flex-end;margin-top:8px;}

      .za-modal {
        background-color: rgba(17,24,39,0.8);
        backdrop-filter: blur(16px);
        border: 1px solid rgba(244,63,94,0.2);
        box-shadow: 0 0 30px rgba(244,63,94,0.1);
        border-radius: 1rem;
        width: 90%;
        max-width: 600px;
        max-height: 85vh;
        display:flex;
        flex-direction:column;
        overflow:hidden;
      }

      .za-header,
      .za-footer {
        padding: 1rem 1.25rem;
        display:flex;
        align-items:center;
        justify-content:space-between;
        border-bottom:1px solid rgba(244,63,94,0.2);
      }

      .za-footer {
        border-bottom:none;
        border-top:1px solid rgba(244,63,94,0.2);
      }

      .za-header h2 {
        color: #4ade80;
        margin:0;
        font-size:1.25rem;
        text-shadow:0 0 8px #4ade80;
      }

      .modal-close {
        background:none;
        border:none;
        color:#e2e8f0;
        font-size:1.25rem;
        width:2rem;
        height:2rem;
        border-radius:9999px;
        cursor:pointer;
        transition:background .2s;
      }

      .modal-close:hover {
        background:rgba(255,255,255,0.1);
      }

      .za-body {
        padding:1.25rem;
        color:#e2e8f0;
        overflow-y:auto;
      }

      .za-question-box {
        background:rgba(17,24,39,0.5);
        border-left:2px solid #facc15;
        box-shadow:-2px 0 8px #facc15;
        padding:1rem;
        border-radius:0.5rem;
        margin-bottom:1rem;
        max-height:200px;
        overflow-y:auto;
      }

      .answer-container {
        display:flex;
        flex-direction:column;
        gap:0.75rem;
        min-height:60px;
      }

      .answer-text {
        display:none;
        flex-direction:column;
        gap:0.75rem;
      }

      .answer-card {
        background-color:rgba(31,41,55,0.6);
        border:1px solid #374151;
        padding:1rem;
        border-radius:0.5rem;
      }

      .loading {
        text-align:center;
        padding:1rem;
        animation:pulse 1.5s ease-in-out infinite;
      }

      @keyframes pulse {
        0%,100%{opacity:0.6;}
        50%{opacity:1;}
      }

      .modal-actions {
        display:flex;
        gap:0.75rem;
        width:100%;
      }

      .action-btn {
        flex:1;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        gap:0.25rem;
        padding:0.75rem;
        border:none;
        border-radius:0.5rem;
        color:#f8fafc;
        cursor:pointer;
        position:relative;
        overflow:hidden;
        transition:transform .2s;
      }

      .action-btn .icon {
        width:24px;
        height:24px;
      }

      .action-btn::before {
        content:'';
        position:absolute;
        inset:0;
        border-radius:0.5rem;
        opacity:0;
        transition:opacity .2s;
        background:radial-gradient(circle at center, rgba(255,255,255,0.4), transparent 70%);
        filter:blur(12px);
      }

      .action-btn:hover::before {
        opacity:1;
      }

      .action-btn:hover {
        transform:translateY(-2px);
      }

      .action-btn[data-color="cyan"] { background:#06b6d4; }
      .action-btn[data-color="gray"] { background:#4b5563; }
      .action-btn[data-color="pink"] { background:#f472b6; }
      .action-btn[data-color="teal"] { background:#14b8a6; }
      .action-btn[data-color="yellow"] { background:#facc15; color:#1f2937; }
    `;

    document.head.appendChild(style);
    document.body.appendChild(modal);
    STATE.modal = modal;

    const loadEl = modal.querySelector('.loading');
    await setLoadingMessage(loadEl);

    // Event listeners
    modal.querySelector('.modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Generate answer
    generateAnswer(selectedText, customPromptId, showReasoning);
  }

  async function generateAnswer(questionText, customPromptId = null, forceReason = null) {
    try {
      const ctx = await getContext();
      const { showReasoning = false, reasonLang = 'English', cerebrasModel } = await chrome.storage.local.get(['showReasoning','reasonLang','cerebrasModel']);
      const useReason = forceReason !== null ? forceReason : showReasoning;
      const thinking = isThinkingModel(cerebrasModel);
      let raw = '';
      let promptName = 'auto';
      if (customPromptId) {
        const resp = await chrome.runtime.sendMessage({ type: 'RUN_CUSTOM_PROMPT', id: customPromptId, text: questionText });
        if (!resp?.ok) throw new Error(resp?.error || 'Generation failed');
        raw = resp.result;
        promptName = resp.promptName || 'custom';
        await chrome.storage.local.set({ lastCustomPromptId: customPromptId });
      } else {
        const prompt = buildPrompt('auto', questionText, ctx, { withReason: useReason, reasonLang, thinking });
        const response = await chrome.runtime.sendMessage({ type: 'CEREBRAS_GENERATE', prompt });
        if (!response?.ok) throw new Error(response?.error || 'Generation failed');
        raw = response.result;
      }
      const parsed = parseResponse(raw, useReason);
      let answer, reason;
      if (useReason) {
        answer = parsed.answer || '';
        reason = parsed.reason || '';
      } else {
        const joined = parsed.join('\n');
        answer = joined;
      }
      STATE.currentAnswer = answer;
      await chrome.storage.local.set({ lastAnswer: answer });

      // Update modal
      const modal = STATE.modal;
      if (modal) {
        const loadEl = modal.querySelector('.loading');
        loadEl.style.display = 'none';
        if (useReason) {
          const split = modal.querySelector('.split-pane');
          split.style.display = 'flex';
          modal.querySelector('.answer-pane .answer-text').textContent = answer;
          modal.querySelector('.reason-pane .reason-text').textContent = reason;
          modal.querySelector('.modal-actions').style.display = 'flex';
          modal.querySelector('.btn-copy-answer').addEventListener('click', () => {
            navigator.clipboard.writeText(answer);
            showNotification('Answer copied to clipboard!');
          });
          modal.querySelector('.btn-copy-reason').addEventListener('click', () => {
            navigator.clipboard.writeText(reason);
            showNotification('Reason copied to clipboard!');
          });
        } else {
          const ansEl = modal.querySelector('.answer-text');
          ansEl.style.display = 'flex';
          ansEl.innerHTML = answer.split('\n').map(a => `<div class="answer-card">${a}</div>`).join('');
          modal.querySelector('.modal-actions').style.display = 'flex';
          modal.querySelector('.btn-copy').addEventListener('click', () => {
            navigator.clipboard.writeText(answer);
            showNotification('Answer copied to clipboard!');
          });
        }

        modal.querySelector('.btn-write-here').addEventListener('click', async () => {
          closeModal();
          if (useReason) {
            await typeAnswer(answer);
          } else {
            await typeAnswer(parsed[0] || '');
          }
        });

        modal.querySelector('.btn-write-all').addEventListener('click', async () => {
          closeModal();
          if (useReason) {
            await typeAnswer(answer, { skipCountdown: true });
          } else {
            for (const part of parsed) {
              await new Promise(r => setTimeout(r, 3000));
              await typeAnswer(part, { skipCountdown: true });
            }
          }
        });

        modal.querySelector('.btn-humanizer').addEventListener('click', async () => {
          await navigator.clipboard.writeText(answer);
          await openAIHumanizer();
        });

        modal.querySelector('.btn-use-prompt').addEventListener('click', () => {
          openPromptSelector(questionText);
        });
      }

      // Save context
      await saveContext({ q: questionText, a: answer, promptName });

    } catch (e) {
      if (STATE.modal) {
        STATE.modal.querySelector('.loading').textContent = 'Error: ' + (e.message || 'Failed to generate answer');
      }
    }
  }

  async function openPromptSelector(questionText){
    const { customPrompts=[] } = await chrome.storage.sync.get('customPrompts');
    if(!customPrompts.length){ showNotification('No custom prompts'); return; }
    const content = `
      <input id="prFilter" placeholder="Filter by tag" style="margin-bottom:10px;padding:8px 12px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;width:100%;"/>
      <div id="prList"></div>
      <div class="pr-actions" style="display:flex;justify-content:flex-end;gap:10px;margin-top:15px;">
        <button id="prRun" class="btn primary">Generate</button>
        <button id="prCancel" class="btn">Cancel</button>
      </div>`;
    const modal = createStyledModal('Custom Prompts', content, null);
    const style = document.createElement('style');
    style.textContent = `#prList{max-height:200px;overflow:auto;} .pr-item{padding:8px 12px;border:1px solid #334155;border-radius:6px;margin-bottom:8px;cursor:pointer;} .pr-item.selected{border-color:#ffd600;background:rgba(255,214,0,0.1);} .btn{background:#1f2937;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:8px 16px;cursor:pointer;transition:filter .2s;} .btn:hover{filter:brightness(1.1);} .btn.primary{background:#22c55e;border-color:#22c55e;color:#0b1215;font-weight:600;}`;
    modal.appendChild(style);
    const listEl = modal.querySelector('#prList');
    let filtered=[...customPrompts]; let selectedId=null;
    function render(){
      listEl.innerHTML = filtered.map(p=>`<div class="pr-item" data-id="${p.id}">${p.name}</div>`).join('');
      listEl.querySelectorAll('.pr-item').forEach(it=>{
        it.addEventListener('click',()=>{
          selectedId = it.dataset.id;
          listEl.querySelectorAll('.pr-item').forEach(x=>x.classList.remove('selected'));
          it.classList.add('selected');
        });
      });
    }
    render();
    modal.querySelector('#prFilter').addEventListener('input', e=>{
      const tag=e.target.value.trim();
      filtered = customPrompts.filter(p=>!tag || (p.tags||[]).includes(tag));
      selectedId=null; render();
    });
    modal.querySelector('#prCancel').addEventListener('click',()=>modal.remove());
    modal.querySelector('#prRun').addEventListener('click', async () => {
      const pr = customPrompts.find(p=>p.id===selectedId);
      if(!pr){ showNotification('Select a prompt'); return; }
      modal.remove();
      if(STATE.modal){
        const loadEl = STATE.modal.querySelector('.loading');
        const ansEl = STATE.modal.querySelector('.answer-text');
        const act = STATE.modal.querySelector('.modal-actions');
        loadEl.style.display='block';
        await setLoadingMessage(loadEl);
        ansEl && (ansEl.style.display='none');
        act.style.display='none';
        // Reuse the main generation function for consistency and maintainability.
        generateAnswer(questionText, pr.id);
      }
    });
  }

  function closeModal() {
    if (STATE.modal) {
      STATE.modal.remove();
      STATE.modal = null;
    }
  }

  async function typeAnswer(text, opts = {}) {
    if (STATE.isTyping) return;
    STATE.isTyping = true;

    try {
      const { typingSpeed = 'normal' } = await chrome.storage.local.get('typingSpeed');
      if (STATE.lastFocused) STATE.lastFocused.focus();
      if (!opts.skipCountdown) await showCountdown(3);
      await typeIntoFocusedElement(text, { speed: typingSpeed });
      showNotification('Answer typed successfully!');
    } catch (e) {
      showNotification('Failed to type answer: ' + e.message);
    } finally {
      STATE.isTyping = false;
    }
  }

  function extractJSON(text){
    try {
      const idx = text.lastIndexOf('{');
      if (idx === -1) return null;
      return JSON.parse(text.slice(idx));
    } catch { return null; }
  }

  function parseResponse(text, withReason){
    const obj = extractJSON(text);
    if (withReason) {
      return {
        answer: String(obj?.answer || '').trim(),
        reason: String(obj?.reason || '').trim()
      };
    }
    if (obj && Array.isArray(obj.answers)) {
      return obj.answers.map(a => String(a).trim());
    }
    return [text.trim()];
  }

  function isThinkingModel(model){
    return /thinking/i.test(model || '');
  }

  async function setLoadingMessage(el){
    const { cerebrasModel } = await chrome.storage.local.get('cerebrasModel');
    if (isThinkingModel(cerebrasModel)) {
      el.innerHTML = '<span class="thinking-icon">🧠</span><span>Thinking...</span>';
    } else {
      el.textContent = 'Generating answer...';
    }
  }

  function buildPrompt(mode, question, context, opts = {}) {
    const { withReason = false, reasonLang = 'English', thinking = false } = opts;
    const ctxLines = (context || []).map((c, i) => `Q${i + 1}: ${c.q}\nA${i + 1}: ${c.a}`).join('\n');
    let rules = `You are building a consistent survey profile. Use prior context if helpful and choose answers that keep the participant qualified for the survey.\nSTRICT OUTPUT RULES:\n`;
    if (withReason) {
      rules += `- Final response MUST be JSON: {"answer": "", "reason": ""}. Reason must be in ${reasonLang}.\n`;
    } else {
      rules += `- Respond ONLY with JSON: {"answers": ["answer1", "answer2", ...]}.\n`;
    }
    if (thinking) rules += '- After any reasoning, end with the JSON object.\n';
    rules += '- Language: match the question language.';
    const tasks = {
      open: 'Open-ended: write 1-3 short natural sentences.',
      mcq: 'Multiple Choice: return the EXACT option text from the provided question/options.',
      scale: 'Scale: return ONLY a single integer (e.g., 1-5 or 1-10).',
      yesno: 'Yes/No: return ONLY "Yes" or "No".',
      auto: 'Auto-detect the type (Open-ended, MCQ, Scale, Yes/No) and answer accordingly.'
    };
    const task = tasks[mode] || tasks.auto;
    return `${rules}\n${task}\n\nPRIOR CONTEXT (last Q/A):\n${ctxLines || 'None'}\n\nQUESTION:\n${question}\n\nANSWER:`;
  }

  async function getContext() {
    const o = await chrome.storage.local.get('contextQA');
    return o.contextQA || [];
  }

  async function saveContext(entry) {
    const list = await getContext();
    list.push(entry);
    while (list.length > 10) list.shift();
    await chrome.storage.local.set({ contextQA: list });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      try {
        switch (msg.type) {
          case 'PING':
            sendResponse({ ok: true });
            break;
          case 'GET_SELECTED_OR_DOM_TEXT':
            sendResponse({ ok: true, text: getSelectedOrDomText() });
            break;
          case 'START_OCR_SELECTION': {
            const rect = await showOverlayAndSelect();
            sendResponse({ ok: true, rect });
            break;
          }
          case 'TYPE_TEXT': {
            const { text, options } = msg;
            await showCountdown(3);
            await typeIntoFocusedElement(text, options || {});
            sendResponse({ ok: true });
            break;
          }
          case 'CROP_IMAGE_IN_CONTENT': {
            const { dataUrl, rect } = msg;
            const cropped = await cropInPage(dataUrl, rect);
            sendResponse({ ok: true, dataUrl: cropped });
            break;
          }
          case 'SHOW_ZEPRA_MODAL': {
            createRainbowModal(msg.text);
            sendResponse({ ok: true });
            break;
          }
          case 'GET_PAGE_DIMENSIONS': {
            sendResponse({ ok: true, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, viewHeight: window.innerHeight, dpr: window.devicePixelRatio });
            break;
          }
          case 'SCROLL_TO': {
            window.scrollTo(0, msg.y || 0);
            sendResponse({ ok: true });
            break;
          }
          default:
            sendResponse({ ok: false, error: 'Unknown message' });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  });

  function getSelectedOrDomText() {
    const sel = window.getSelection();
    let t = sel && sel.toString ? sel.toString().trim() : '';
    if (t) return t;
    const el = document.activeElement;
    if (!el) return '';
    if (el.isContentEditable) return (el.innerText || el.textContent || '').trim();
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input') return (el.value || '').trim();
    return (el.innerText || el.textContent || '').trim();
  }

  function showOverlayAndSelect() {
    return new Promise((resolve) => {
      if (STATE.overlay) cleanup();
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,.05)';
      const rectEl = document.createElement('div');
      rectEl.style.cssText = 'position:fixed;border:2px solid #22c55e;background:rgba(34,197,94,.15);pointer-events:none;left:0;top:0;width:0;height:0;';
      overlay.appendChild(rectEl);
      document.documentElement.appendChild(overlay);
      STATE.overlay = overlay; STATE.rectEl = rectEl;
      let sx = 0, sy = 0, ex = 0, ey = 0, drag = false;
      const onDown = (e) => { drag = true; sx = e.clientX; sy = e.clientY; ex = sx; ey = sy; update(); };
      const onMove = (e) => { if (!drag) return; ex = e.clientX; ey = e.clientY; update(); };
      const onUp = () => { drag = false; const x = Math.min(sx, ex), y = Math.min(sy, ey), w = Math.abs(ex - sx), h = Math.abs(ey - sy); const dpr = window.devicePixelRatio || 1; cleanup(); resolve({ x, y, width: w, height: h, dpr }); };
      const onKey = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };
      function update() { const x = Math.min(sx, ex), y = Math.min(sy, ey), w = Math.abs(ex - sx), h = Math.abs(ey - sy); Object.assign(rectEl.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }); }
      function cleanup() { overlay.removeEventListener('mousedown', onDown, true); overlay.removeEventListener('mousemove', onMove, true); overlay.removeEventListener('mouseup', onUp, true); window.removeEventListener('keydown', onKey, true); overlay.remove(); STATE.overlay = null; STATE.rectEl = null; }
      overlay.addEventListener('mousedown', onDown, true);
      overlay.addEventListener('mousemove', onMove, true);
      overlay.addEventListener('mouseup', onUp, true);
      window.addEventListener('keydown', onKey, true);
    });
  }

  async function cropInPage(dataUrl, rect) {
    const img = document.createElement('img');
    img.src = dataUrl; await img.decode();
    const dpr = rect.dpr || 1;
    const sx = Math.max(0, Math.round(rect.x * dpr));
    const sy = Math.max(0, Math.round(rect.y * dpr));
    const sw = Math.min(img.naturalWidth - sx, Math.round(rect.width * dpr));
    const sh = Math.min(img.naturalHeight - sy, Math.round(rect.height * dpr));
    const canvas = document.createElement('canvas'); canvas.width = sw; canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.toDataURL('image/png');
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function showCountdown(sec) {
    return new Promise((resolve) => {
      let count = sec;
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;top:20px;right:20px;padding:8px 14px;background:rgba(0,0,0,0.7);color:#39ff14;font-size:24px;border-radius:8px;z-index:2147483647;';
      el.textContent = count;
      document.body.appendChild(el);
      const timer = setInterval(() => {
        count--;
        if (count <= 0) {
          clearInterval(timer);
          el.remove();
          resolve();
        } else {
          el.textContent = count;
        }
      }, 1000);
    });
  }

  async function typeIntoFocusedElement(text, options) {
    const el = document.activeElement || document.body;
    const speed = options.speed || 'normal';
    const delays = speed === 'fast' ? [5, 15] : speed === 'slow' ? [60, 120] : [25, 60];
    const isInput = (n) => n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA');
    const isCE = (n) => n && n.isContentEditable;
    const dispatch = (node, type) => node && node.dispatchEvent(new Event(type, { bubbles: true }));
    const setter = isInput(el)
      ? (v) => { const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype; const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set; set ? set.call(el, v) : el.value = v; }
      : isCE(el)
        ? (v) => { el.textContent = v; }
        : (v) => { el.textContent = v; };
    const getter = isInput(el) ? () => el.value : () => (el.value ?? el.textContent ?? '');
    dispatch(el, 'focus');
    let cur = getter();
    // Clear existing value
    if (isInput(el)) { setter(''); cur = ''; dispatch(el, 'input'); }
    else if (isCE(el)) { setter(''); cur = ''; dispatch(el, 'input'); }
    for (const ch of (text || '')) {
      dispatch(el, 'keydown');
      setter(cur + ch);
      cur += ch;
      dispatch(el, 'input');
      dispatch(el, 'keyup');
      await sleep(rand(delays[0], delays[1]));
    }
    dispatch(el, 'change');
  }

  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  async function getTabId() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_TAB_ID' });
      return response?.tabId || 0;
    } catch {
      return 0;
    }
  }

  function toggleHumanTyping() {
    // This would toggle between normal and human-like typing
    showNotification('Human typing mode toggled');
  }

  function handleSelection(e) {
    if (e && e.type === 'mouseup') {
      STATE.lastMouse = { x: e.clientX, y: e.clientY };
    }
    const sel = window.getSelection();
    const text = sel && sel.toString ? sel.toString().trim() : '';
    if (text) {
      let rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!(rect.width || rect.height)) {
        rect = { top: STATE.lastMouse.y, right: STATE.lastMouse.x, bottom: STATE.lastMouse.y, left: STATE.lastMouse.x };
      }
      showSelectionButton(rect, text);
    } else {
      removeSelectionButton();
    }
  }

  function showSelectionButton(rect, text) {
    removeSelectionButton();
    const btn = document.createElement('div');
    btn.id = 'zepra-gen-btn';
    btn.textContent = 'Generate Answer';
    document.body.appendChild(btn);
    const btnWidth = btn.offsetWidth || 120;
    const btnHeight = btn.offsetHeight || 24;
    let left = window.scrollX + rect.right + 5;
    let top = window.scrollY + rect.top - 30;
    left = Math.min(window.scrollX + window.innerWidth - btnWidth - 10, Math.max(window.scrollX + 10, left));
    top = Math.min(window.scrollY + window.innerHeight - btnHeight - 10, Math.max(window.scrollY + 10, top));
    btn.style.cssText = `position:absolute;left:${left}px;top:${top}px;z-index:2147483647;background:#23272b;color:#39ff14;padding:4px 8px;border-radius:6px;font-size:12px;box-shadow:0 0 8px rgba(255,152,0,0.7);cursor:pointer;transition:transform 0.2s;`;
    btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.05)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      removeSelectionButton();
      createRainbowModal(text);
    });
    STATE.selBtn = btn;
  }

  function removeSelectionButton() {
    if (STATE.selBtn) { STATE.selBtn.remove(); STATE.selBtn = null; }
  }

  document.addEventListener('mouseup', handleSelection);
  document.addEventListener('keyup', handleSelection);
  // Removed selectionchange to ensure Generate button remains clickable
  document.addEventListener('mousedown', (e) => {
    if (STATE.selBtn && !STATE.selBtn.contains(e.target)) removeSelectionButton();
  });

  // Initialize floating bubble when page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFloatingBubble);
  } else {
    createFloatingBubble();
  }
  watchForms();

  // Add CSS animations
  const globalStyle = document.createElement('style');
  globalStyle.textContent = `
    @keyframes slideDown {
      from { transform: translateX(-50%) translateY(-20px); opacity: 0; }
      to { transform: translateX(-50%) translateY(0); opacity: 1; }
    }
    
    @keyframes slideUp {
      from { transform: translateX(-50%) translateY(0); opacity: 1; }
      to { transform: translateX(-50%) translateY(-20px); opacity: 0; }
    }
  `;
  document.head.appendChild(globalStyle);

}

chrome.storage.local.get('loggedIn', ({ loggedIn }) => {
  if (loggedIn) init();
});
chrome.storage.onChanged.addListener((chg, area) => {
  if (area === 'local' && chg.loggedIn?.newValue) init();
});

// Clean Professional IP Qualification Modal
function showCleanIPQualificationModal(data){
  if(!data){
    createStyledModal('IP Qualification', `<div style="padding:20px;text-align:center;color:#e2e8f0;">Could not fetch IP data. Please try again.</div>`);
    return;
  }

  const risk = Number(data.risk_score ?? data.risk ?? data.score ?? 0);
  const ip = data.ip || data.query || '';
  const city = data.city || data.region_name || data.region || '';
  const cc = (data.country_code || data.countryCode || data.country_code2 || '').toUpperCase();
  const isp = data.isp || data.org || '';
  const flag = cc ? cc.replace(/./g, ch => String.fromCodePoint(127397 + ch.charCodeAt(0))) : '';

  const detection = data?.blacklists?.detection || 'none';
  const proxy = !!data?.security?.proxy;
  const vpn = !!data?.security?.vpn;
  const tor = !!data?.security?.tor;

  // Enhanced status logic with three states
  const riskPass = risk < 30;
  const riskWarning = risk >= 30 && risk <= 50;
  const riskFail = risk > 50;
  const blacklistPass = detection === 'none';
  const anonymityPass = !proxy && !vpn && !tor;

  // Determine overall status
  let statusState = 'qualified';
  let statusText = 'QUALIFIED';
  let statusMessage = 'Your IP is clean and ready to use.';
  let statusClass = 'status-qualified';

  if (riskFail || !blacklistPass || !anonymityPass) {
    statusState = 'not-qualified';
    statusText = 'NOT QUALIFIED';
    statusClass = 'status-not-qualified';
    
    if (riskFail) {
      statusMessage = 'Warning: This IP is high-risk and has a bad reputation. It is not recommended for use.';
    } else if (!blacklistPass) {
      statusMessage = 'Your IP is on a blacklist. You must change your connection.';
    } else if (!anonymityPass) {
      statusMessage = 'Proxy/VPN/Tor detected. Please disable it and try again.';
    }
  } else if (riskWarning) {
    statusState = 'warning';
    statusText = 'WARNING';
    statusClass = 'status-warning';
    statusMessage = 'Your IP is moderately risky. Proceed with caution.';
  }

  // SVG Icons
  const shieldSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
  const eyeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const globeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
  
  // Status-specific icons
  const checkSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="check-icon"><polyline points="20 6 9 17 4 12"/></svg>`;
  const warningSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="warning-icon"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="m12 17 .01 0"/></svg>`;
  const xSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="x-icon"><path d="M18 6 6 18M6 6l12 12"/></svg>`;

  // Build clean checklist
  const checks = [
    { 
      pass: riskPass, 
      warning: riskWarning,
      fail: riskFail,
      label: 'Risk Score Assessment', 
      icon: shieldSVG 
    },
    { 
      pass: blacklistPass, 
      warning: false,
      fail: !blacklistPass,
      label: 'Blacklist Verification', 
      icon: eyeSVG 
    },
    { 
      pass: anonymityPass, 
      warning: false,
      fail: !anonymityPass,
      label: 'Anonymity Detection', 
      icon: globeSVG 
    },
  ];

  const checklistHTML = checks
    .map((c, i) => {
      let resultIcon = checkSVG;
      let resultClass = 'check-result-pass';
      
      if (c.fail) {
        resultIcon = xSVG;
        resultClass = 'check-result-fail';
      } else if (c.warning) {
        resultIcon = warningSVG;
        resultClass = 'check-result-warning';
      }
      
      return `
      <div class="ipq-check-item ${resultClass}" style="--i:${i};">
        <div class="ipq-check-left">${c.icon}<span>${c.label}</span></div>
        <div class="ipq-check-result">${resultIcon}</div>
      </div>`;
    })
    .join('');

  // Header icons based on status
  const shieldCheckSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>`;
  const shieldWarningSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 7v6"/><path d="m12 17 .01 0"/></svg>`;
  const shieldOffSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 9l6 6M15 9l-6 6"/></svg>`;
  
  let headerIcon = shieldCheckSVG;
  if (statusState === 'warning') headerIcon = shieldWarningSVG;
  else if (statusState === 'not-qualified') headerIcon = shieldOffSVG;

  const html = `
    <style>
      /* Clean professional IP Qualification Modal */
      .styled-modal-content.status-qualified { --ipq-color: #4ade80; }
      .styled-modal-content.status-warning { --ipq-color: #fbbf24; }
      .styled-modal-content.status-not-qualified { --ipq-color: #f43f5e; }
      
      /* Remove modal border and create clean look */
      .styled-modal-content {
        border: none !important;
        box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5) !important;
        background: rgba(20, 30, 48, 0.95) !important;
        backdrop-filter: blur(20px) !important;
      }

      .ipq-modal {
        position: relative;
        max-width: 400px;
        padding: 0;
        background: transparent;
        border: none;
      }

      .ipq-main {
        padding: 32px 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 32px;
      }

      /* Central Status Circle - Main Visual Element */
      .ipq-status-circle {
        position: relative;
        width: 160px;
        height: 160px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        border: 3px solid var(--ipq-color);
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.4);
        box-shadow: 
          0 0 30px var(--ipq-color),
          inset 0 0 30px rgba(0, 0, 0, 0.5);
        animation: circleGlow 2s ease-in-out infinite alternate;
      }

      @keyframes circleGlow {
        from { 
          box-shadow: 
            0 0 30px var(--ipq-color),
            inset 0 0 30px rgba(0, 0, 0, 0.5);
        }
        to { 
          box-shadow: 
            0 0 50px var(--ipq-color),
            0 0 80px var(--ipq-color),
            inset 0 0 30px rgba(0, 0, 0, 0.5);
        }
      }

      .ipq-status-text {
        font-size: 18px;
        font-weight: 800;
        color: var(--ipq-color);
        text-shadow: 0 0 10px var(--ipq-color);
        letter-spacing: 1px;
        margin-bottom: 4px;
      }

      .ipq-risk-score {
        font-size: 36px;
        font-weight: 900;
        color: var(--ipq-color);
        text-shadow: 0 0 15px var(--ipq-color);
        font-family: 'Courier New', monospace;
      }

      /* Simple Clean Checklist - No Boxes */
      .ipq-checklist {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 16px;
        margin-top: 8px;
      }

      .ipq-check-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        animation: itemFadeIn 0.5s ease forwards;
        opacity: 0;
        animation-delay: calc(var(--i) * 0.1s + 0.3s);
      }

      .ipq-check-item:last-child {
        border-bottom: none;
      }

      @keyframes itemFadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .ipq-check-left {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .ipq-check-left svg {
        width: 18px;
        height: 18px;
        stroke: #9ca3af;
      }

      .ipq-check-left span {
        font-size: 14px;
        font-weight: 500;
        color: #e2e8f0;
      }

      .ipq-check-result svg {
        width: 20px;
        height: 20px;
      }

      /* Status Icons with Colors */
      .check-result-pass .check-icon {
        stroke: var(--ipq-color);
        filter: drop-shadow(0 0 6px var(--ipq-color));
      }

      .check-result-warning .warning-icon {
        stroke: var(--ipq-color);
        fill: var(--ipq-color);
        filter: drop-shadow(0 0 6px var(--ipq-color));
      }

      .check-result-fail .x-icon {
        stroke: var(--ipq-color);
        filter: drop-shadow(0 0 6px var(--ipq-color));
      }

      /* Clean Footer - Simple Text */
      .ipq-footer {
        width: 100%;
        text-align: center;
        margin-top: 24px;
      }

      .ipq-summary {
        font-size: 14px;
        font-weight: 600;
        color: var(--ipq-color);
        text-shadow: 0 0 8px var(--ipq-color);
        margin-bottom: 16px;
        animation: summaryFade 0.6s ease 0.8s both;
      }

      @keyframes summaryFade {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .ipq-info-text {
        font-size: 13px;
        color: #9ca3af;
        line-height: 1.6;
        animation: infoFade 0.6s ease 1s both;
      }

      .ipq-info-highlight {
        color: var(--ipq-color);
        font-weight: 600;
      }

      @keyframes infoFade {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      /* Responsive */
      @media (max-width: 480px) {
        .ipq-modal { max-width: 95vw; }
        .ipq-status-circle { width: 140px; height: 140px; }
        .ipq-status-text { font-size: 16px; }
        .ipq-risk-score { font-size: 28px; }
      }
    </style>
    <div class="ipq-modal">
      <main class="ipq-main">
        <!-- Central Status Circle -->
        <div class="ipq-status-circle">
          <div class="ipq-status-text">${statusText}</div>
          <div class="ipq-risk-score">${risk}</div>
        </div>

        <!-- Simple Clean Checklist -->
        <div class="ipq-checklist">${checklistHTML}</div>

        <!-- Clean Footer -->
        <footer class="ipq-footer">
          <div class="ipq-summary">${statusMessage}</div>
          <div class="ipq-info-text">
            <span class="ipq-info-highlight">${ip}</span> • ${flag} ${city ? city+', ' : ''}${cc} • ${isp || 'Unknown ISP'}
          </div>
        </footer>
      </main>
    </div>`;

  const modal = createStyledModal(`${headerIcon} IP Qualification`, html);
  modal.querySelector('.styled-modal-content').classList.add(statusClass);
}
