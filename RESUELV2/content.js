// content.js
// - Extract selected text or from DOM
// - Overlay to select OCR region
// - Fallback image crop
// - Type text into focused field (no humanize; speed only)
// - Floating bubble with rainbow modal
// - YouTube video dubbing feature

const IFLYTEK_LANGS = [
  'Arabic','English','Chinese','Japanese','German','Spanish','Korean','Russian','French',
  'Portuguese','Italian','Hindi','Thai','Vietnamese','Indonesian','Turkish'
];

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
    lastMouse: { x: 20, y: 20 }
  };

  let customPrompts = [];
  chrome.storage.sync.get('customPrompts', r => { customPrompts = r.customPrompts || []; });
  chrome.storage.onChanged.addListener((chg, area) => {
    if(area === 'sync' && chg.customPrompts){ customPrompts = chg.customPrompts.newValue || []; }
  });

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

  document.addEventListener('focusin', (e) => { STATE.lastFocused = e.target; });

  // Create floating bubble
  function createFloatingBubble() {
    if (STATE.bubble) return;
    
    const bubble = document.createElement('div');
    bubble.id = 'zepra-bubble';
    bubble.innerHTML = `
      <div class="bubble-icon">
        <img src="${chrome.runtime.getURL('icons/zepra.svg')}" alt="Zepra" />
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
      
      .bubble-icon img {
        width: 100%;
        height: 100%;
        object-fit: cover;
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
    if (document.getElementById('zepra-bubble-menu')) return;
    
    const menu = document.createElement('div');
    menu.id = 'zepra-bubble-menu';
    menu.innerHTML = `
      <div class="bubble-menu-content">
        <div class="menu-header">
          <h3 class="zepra-gradient">Zepra Menu</h3>
          <button class="close-btn">&times;</button>
        </div>
        <div class="menu-items">
          <div class="menu-item" data-action="ocr">
            <span class="menu-icon">📷</span>
            <span class="menu-text">OCR Capture</span>
          </div>
          <div class="menu-item" data-action="ocr-full">
            <span class="menu-icon">🖼️</span>
            <span class="menu-text">OCR Full Page</span>
          </div>
          <div class="menu-item" data-action="write-last">
            <span class="menu-icon">✍️</span>
            <span class="menu-text">Write Last Answer</span>
          </div>
          <div class="menu-item" data-action="clear-context">
            <span class="menu-icon">🧹</span>
            <span class="menu-text">Clear AI Context</span>
          </div>
          <div class="menu-item" data-action="ip-info">
            <span class="menu-icon">🌐</span>
            <span class="menu-text">IP Information</span>
          </div>
          <div class="menu-item" data-action="ip-qual">
            <span class="menu-icon">📊</span>
            <span class="menu-text">IP Qualification</span>
          </div>
          <div class="menu-item" data-action="fake-info">
            <span class="menu-icon">👤</span>
            <span class="menu-text">Generate Fake Info</span>
          </div>
          <div class="menu-item" data-action="temp-mail">
            <span class="menu-icon">📧</span>
            <span class="menu-text">Temp Mail</span>
          </div>
          <div class="menu-item" data-action="custom-web">
            <span class="menu-icon">🌐</span>
            <span class="menu-text">Custom Web</span>
          </div>
          <div class="menu-item" data-action="ai-humanizer">
            <span class="menu-icon">🧠</span>
            <span class="menu-text">AI Humanizer</span>
          </div>
          <div class="menu-item" data-action="real-address">
            <span class="menu-icon">🏠</span>
            <span class="menu-text">Generate Real Address</span>
          </div>
          <div class="menu-item" data-action="zebra-vps">
            <span class="menu-icon">💻</span>
            <span class="menu-text">Zebra VPS</span>
          </div>
        </div>
      </div>
    `;
    
    menu.style.cssText = `
      position: fixed;
      top: 90px;
      right: 20px;
      width: 250px;
      background: #000;
      border-radius: 15px;
      box-shadow: 0 0 20px rgba(57,255,20,0.3), 0 0 20px rgba(255,230,0,0.3);
      z-index: 2147483648;
      animation: slideIn 0.3s ease-out;
      border: 2px solid #39ff14;
    `;

    const menuStyle = document.createElement('style');
    menuStyle.textContent = `
      @keyframes slideIn {
        from { opacity: 0; transform: translateY(-20px) scale(0.9); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      
      .bubble-menu-content {
        padding: 15px;
        color: #e2e8f0;
      }
      
      .menu-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
        border-bottom: 1px solid #292d33;
        padding-bottom: 10px;
      }
      
      .menu-header h3 {
        margin: 0;
        font-size: 16px;
        font-weight: bold;
        color: #39ff14;
      }
      
      .close-btn {
        background: none;
        border: none;
        color: #e2e8f0;
        font-size: 20px;
        cursor: pointer;
        padding: 0;
        width: 25px;
        height: 25px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }
      
      .close-btn:hover {
        background: rgba(255,255,255,0.2);
      }
      
      .menu-items {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
        background: linear-gradient(120deg, #000 60%, #39ff1480 100%);
      }
      
      .menu-item:hover {
        background: linear-gradient(120deg, #39ff1499 60%, #ffe600 100%);
        transform: translateX(5px);
      }
      
      .menu-icon {
        font-size: 16px;
        width: 20px;
        text-align: center;
      }

      .menu-text {
        font-size: 13px;
        font-weight: 500;
        color: #ffd600;
      }
    `;
    
    document.head.appendChild(menuStyle);
    document.body.appendChild(menu);

    // Event listeners
    menu.querySelector('.close-btn').addEventListener('click', () => {
      menu.remove();
      menuStyle.remove();
    });

    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.menu-item');
      if (!item) return;
      
      const action = item.dataset.action;
      handleBubbleAction(action);
      menu.remove();
      menuStyle.remove();
    });

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function closeMenu(e) {
        if (!menu.contains(e.target) && !STATE.bubble.contains(e.target)) {
          menu.remove();
          menuStyle.remove();
          document.removeEventListener('click', closeMenu);
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
        showRealAddressModal();
        break;
      case 'zebra-vps':
        showZebraVPSModal();
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
        showIPQualificationModal(resp.data);
      }else{
        const { lastIPQ } = await chrome.storage.local.get('lastIPQ');
        showIPQualificationModal(lastIPQ || null);
      }
    }catch(e){
      const { lastIPQ } = await chrome.storage.local.get('lastIPQ');
      showIPQualificationModal(lastIPQ || null);
    }
  }

  function showIPQualificationModal(data){
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

    const riskPass = risk < 30;
    const blacklistPass = detection === 'none';
    const anonymityPass = !proxy && !vpn && !tor;
    const qualified = riskPass && blacklistPass && anonymityPass;

    const statusText = qualified ? 'QUALIFIED' : 'NOT QUALIFIED';
    const statusColor = qualified ? '#39ff14' : '#ff4444';
    let failMsg = '';
    if (!riskPass) failMsg = 'Your risk score is too high. You must change your connection.';
    else if (!blacklistPass) failMsg = 'Your IP is on a blacklist. You must change your connection.';
    else if (!anonymityPass) failMsg = 'Proxy/VPN/Tor detected. Please disable it and try again.';

    const passIcon = '<span style="color:#39ff14;">✔️</span>';
    const failIcon = '<span style="color:#ff4444;">❌</span>';

    const html = `
      <style>
        .ipq-wrap{display:flex;flex-direction:column;align-items:center;gap:20px;color:#e2e8f0;max-width:320px;}
        .ipq-status{font-size:24px;font-weight:bold;text-shadow:0 0 10px currentColor;}
        .ipq-checklist{list-style:none;padding:0;margin:0;width:100%;}
        .ipq-checklist li{display:flex;align-items:center;gap:8px;margin:4px 0;}
        .ipq-message{text-align:center;font-weight:bold;}
        .ipq-details{width:100%;text-align:left;line-height:1.6;}
        .ipq-details strong{color:#39ff14;}
      </style>
      <div class="ipq-wrap">
        <div class="ipq-status" style="color:${statusColor};">${statusText}</div>
        <div class="ipq-score" style="font-size:48px;font-weight:bold;color:${statusColor};">${risk}</div>
        <ul class="ipq-checklist">
          <li>${riskPass ? passIcon : failIcon} Risk Score (<30)</li>
          <li>${blacklistPass ? passIcon : failIcon} Blacklist Check (Clean)</li>
          <li>${anonymityPass ? passIcon : failIcon} Anonymity Check (No Proxy/VPN/Tor)</li>
        </ul>
        <div class="ipq-message" style="color:${statusColor};">${qualified ? 'Your IP is clean and ready to use.' : failMsg}</div>
        <div class="ipq-details" style="margin-top:10px;">
          <div><strong>IP:</strong> ${ip} - ${flag} ${city ? city+', ' : ''}${cc}</div>
          <div><strong>ISP:</strong> ${isp || 'Unknown'}</div>
        </div>
      </div>`;
    createStyledModal('IP Qualification', html);
  }

  function showIPModal(info) {
    const { ip, raw = {}, ...rest } = info || {};
    const entries = { ...rest, ...raw };
    delete entries.ip;
    delete entries.raw;
    const rows = Object.entries(entries)
      .map(([k, v]) => `<div><strong style="color: #ffd600;">${k.replace(/_/g, ' ')}:</strong> ${v === undefined ? 'Unknown' : v}</div>`)
      .join('');
    const modal = createStyledModal('IP Information', `
      <div style="background: linear-gradient(120deg, #120f12 80%, #0a0f17 100%); padding: 20px; border-radius: 10px; margin: 10px 0;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
          <strong style="color: #39ff14;">IP Address:</strong>
          <span style="color: #e2e8f0; font-family: monospace;">${ip || 'Unknown'}</span>
          <button onclick="navigator.clipboard.writeText('${ip || ''}')" style="background: #22c55e; border: none; color: white; padding: 5px 10px; border-radius: 5px; cursor: pointer; font-size: 12px;">Copy</button>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; color: #e2e8f0;">
          ${rows}
        </div>
      </div>
    `);
  }

  async function showFakeInfoModal() {
    const COUNTRY_CODES = "AF AX AL DZ AS AD AO AI AQ AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI KH CM CA CV KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MK MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW".split(' ');
    const datalist = `<datalist id="fiNatList">${COUNTRY_CODES.map(c=>`<option value="${c}">`).join('')}</datalist>`;
    const { fakeInfo } = await chrome.storage.local.get('fakeInfo');
    const content = fakeInfo ? `
      <div id="fiResult"></div>
    ` : `
      <div style="margin-bottom:15px; display:flex; gap:10px; flex-wrap:wrap;">
        <select id="fiGender" style="flex:1; padding:6px; border-radius:6px; background:#0b1220; color:#e2e8f0; border:1px solid #334155;">
          <option value="">Any Gender</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
        <input id="fiNat" list="fiNatList" placeholder="Country code" style="flex:1; padding:6px; border-radius:6px; background:#0b1220; color:#e2e8f0; border:1px solid #334155;" />
        <button id="fiGenerate" style="background:linear-gradient(45deg,#4ecdc4,#44a08d); border:none; color:#fff; padding:6px 12px; border-radius:6px; cursor:pointer;">Generate</button>
      </div>
      ${datalist}
      <div id="fiResult" style="display:none;"></div>
    `;
    const modal = createStyledModal('Fake User Info', content);

    async function generate(){
      try {
        const gender = modal.querySelector('#fiGender').value;
        const nat = modal.querySelector('#fiNat').value.trim();
        const resp = await chrome.runtime.sendMessage({ type:'GENERATE_FAKE_INFO', gender, nat });
        if (!resp?.ok) throw new Error(resp?.error || 'Failed');
        await chrome.storage.local.set({ fakeInfo: resp.data });
        render(resp.data);
      } catch(e){
        showNotification('Failed to generate: '+e.message);
      }
    }

    function render(user){
      const fi = modal.querySelector('#fiResult');
      const name = `${user.name?.first || ''} ${user.name?.last || ''}`.trim();
      const address = `${user.location?.street?.number || ''} ${user.location?.street?.name || ''}, ${user.location?.city || ''}, ${user.location?.country || ''}`.trim();
      const dob = user.dob?.date ? user.dob.date.split('T')[0] : '';
      const fields = [
        { label:'Name', value:name },
        { label:'Email', value:user.email },
        { label:'Phone', value:user.phone },
        { label:'Address', value:address },
        { label:'DOB', value:dob }
      ];
      fi.innerHTML = `
        <div style="text-align:center; margin-bottom:15px;">
          ${user.picture?.large ? `<img src="${user.picture.large}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;"/>` : ''}
        </div>
        ${fields.map((f,i)=>`
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <strong style="color:#ffd600; min-width:70px;">${f.label}:</strong>
            <span style="flex:1; color:#e2e8f0;">${f.value || 'Unknown'}</span>
            <button data-copy="${i}" style="background:#22c55e;border:none;color:#fff;padding:4px 8px;border-radius:5px;cursor:pointer;font-size:12px;">Copy</button>
            <button data-write="${i}" style="background:#ff6b6b;border:none;color:#fff;padding:4px 8px;border-radius:5px;cursor:pointer;font-size:12px;">Write Here</button>
          </div>
        `).join('')}
        <div style="text-align:center; margin-top:10px;">
          <button id="fiRegenerate" style="background:linear-gradient(45deg,#feca57,#ff9ff3); border:none; color:#fff; padding:8px 16px; border-radius:20px; cursor:pointer; font-weight:bold;">Regenerate Info</button>
        </div>
      `;
      fi.style.display = 'block';

      fi.querySelectorAll('[data-copy]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx = btn.getAttribute('data-copy');
          navigator.clipboard.writeText(fields[idx].value || '');
          showNotification('Copied to clipboard');
        });
      });
      fi.querySelectorAll('[data-write]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx = btn.getAttribute('data-write');
          const text = fields[idx].value || '';
          const m = document.getElementById('zepra-styled-modal');
          if (m) m.remove();
          typeAnswer(text);
        });
      });
      fi.querySelector('#fiRegenerate')?.addEventListener('click', async ()=>{
        await chrome.storage.local.remove('fakeInfo');
        modal.remove();
        showFakeInfoModal();
      });
    }

    if(fakeInfo){
      render(fakeInfo);
    } else {
      modal.querySelector('#fiGenerate')?.addEventListener('click', generate);
    }
  }

  async function showRealAddressModal(){
    const content = `
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:15px;">
        <input id="raCountry" placeholder="Country" style="padding:6px;border-radius:6px;background:#0b1220;color:#e2e8f0;border:1px solid #334155;"/>
        <input id="raState" placeholder="State/Province" style="padding:6px;border-radius:6px;background:#0b1220;color:#e2e8f0;border:1px solid #334155;"/>
        <input id="raCity" placeholder="City/Zip Code" style="padding:6px;border-radius:6px;background:#0b1220;color:#e2e8f0;border:1px solid #334155;"/>
        <button id="raGenerate" style="background:linear-gradient(45deg,#4ecdc4,#44a08d);border:none;color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer;">Generate</button>
      </div>
      <div id="raResult" style="display:none;"></div>
    `;
    const modal = createStyledModal('Generate Real Address', content);

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
      const fields=[
        {label:'Address 1', value:parts.a1},
        {label:'Address 2', value:parts.a2},
        {label:'Zip Code', value:parts.zip}
      ];
      const box = modal.querySelector('#raResult');
      box.innerHTML = fields.map((f,i)=>`
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;background:rgba(255,255,255,0.1);padding:8px;border-radius:6px;">
          <strong style="color:#39ff14;min-width:90px;">${f.label}:</strong>
          <span style="flex:1;color:#e2e8f0;">${f.value || ''}</span>
          <button data-copy="${i}" style="background:#22c55e;border:none;color:#fff;padding:4px 8px;border-radius:5px;cursor:pointer;font-size:12px;">Copy</button>
          <button data-write="${i}" style="background:#ff6b6b;border:none;color:#fff;padding:4px 8px;border-radius:5px;cursor:pointer;font-size:12px;">Write Here</button>
        </div>
      `).join('');
      box.style.display='block';
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
    }

    modal.querySelector('#raGenerate').addEventListener('click', async ()=>{
      const country=modal.querySelector('#raCountry').value.trim();
      const state=modal.querySelector('#raState').value.trim();
      const city=modal.querySelector('#raCity').value.trim();
      try{
        const resp=await chrome.runtime.sendMessage({type:'GENERATE_REAL_ADDRESS', country, state, city});
        if(!resp?.ok) throw new Error(resp?.error||'Failed');
        render(parse(resp.result));
      }catch(e){
        showNotification('Failed to generate: '+e.message);
      }
    });
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

  function createRainbowModal(selectedText, customPromptId = null) {
    if (STATE.modal) return;

    const modal = document.createElement('div');
    modal.id = 'zepra-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="zepra-gradient">Zepra Answer</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="question-text">${selectedText}</div>
          <div class="answer-container">
            <div class="loading">Generating answer...</div>
            <div class="answer-text" style="display: none;"></div>
          </div>
          <div class="modal-actions" style="display: none;">
            <button class="btn-write-here">Write Here</button>
            <button class="btn-write-all">Write All</button>
            <button class="btn-copy">Copy</button>
            <button class="btn-humanizer">AI Humanizer</button>
            <button class="btn-use-prompt">Use Custom Prompt</button>
          </div>
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
      
      @keyframes rainbowBorder {
        0% { border-color: #ff6b6b; box-shadow: 0 0 20px #ff6b6b; }
        16% { border-color: #4ecdc4; box-shadow: 0 0 20px #4ecdc4; }
        32% { border-color: #45b7d1; box-shadow: 0 0 20px #45b7d1; }
        48% { border-color: #96ceb4; box-shadow: 0 0 20px #96ceb4; }
        64% { border-color: #feca57; box-shadow: 0 0 20px #feca57; }
        80% { border-color: #ff9ff3; box-shadow: 0 0 20px #ff9ff3; }
        100% { border-color: #ff6b6b; box-shadow: 0 0 20px #ff6b6b; }
      }
      
      .modal-content {
        background: linear-gradient(135deg, #23272b 0%, #120f12 100%);
        border-radius: 15px;
        padding: 0;
        max-width: 500px;
        width: 90%;
        max-height: 80vh;
        overflow: hidden;
        border: 3px solid #ff6b6b;
        animation: rainbowBorder 3s linear infinite;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      }
      
      .modal-header {
        background: rgba(0,0,0,0.2);
        padding: 15px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #292d33;
      }
      
      .modal-header h3 {
        margin: 0;
        color: #39ff14;
        font-size: 18px;
        font-weight: bold;
      }
      
      .modal-close {
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
      
      .modal-close:hover {
        background: rgba(255,255,255,0.2);
      }
      
      .modal-body {
        padding: 20px;
        color: #e2e8f0;
        max-height: 70vh;
        overflow-y: auto;
      }

      .question-text {
        background: rgba(0,0,0,0.2);
        padding: 15px;
        border-radius: 10px;
        margin-bottom: 20px;
        font-style: italic;
        border-left: 4px solid #feca57;
        max-height: 200px;
        overflow-y: auto;
      }

      .answer-container {
        background: rgba(255,255,255,0.1);
        padding: 15px;
        border-radius: 10px;
        margin-bottom: 20px;
        min-height: 60px;
        max-height: 300px;
        overflow-y: auto;
      }
      
      .loading {
        text-align: center;
        opacity: 0.7;
        animation: pulse 1.5s ease-in-out infinite;
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 0.7; }
        50% { opacity: 1; }
      }
      
      .answer-text {
        line-height: 1.6;
        white-space: pre-wrap;
      }
      
      .modal-actions {
        display: flex;
        gap: 10px;
        justify-content: center;
      }
      
      .modal-actions button {
        background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
        border: none;
        color: white;
        padding: 10px 20px;
        border-radius: 25px;
        cursor: pointer;
        font-weight: bold;
        transition: transform 0.2s, box-shadow 0.2s;
      }
      
      .modal-actions button:hover {
        transform: translateY(-2px);
        box-shadow: 0 5px 15px rgba(0,0,0,0.3);
      }
      
      .btn-write-here {
        background: linear-gradient(45deg, #4ecdc4, #44a08d) !important;
      }

      .btn-use-prompt {
        background: linear-gradient(45deg, #ffd600, #39ff14) !important;
        color: #181c20 !important;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(modal);
    STATE.modal = modal;

    // Event listeners
    modal.querySelector('.modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Generate answer
    generateAnswer(selectedText, customPromptId);
  }

  async function generateAnswer(questionText, customPromptId = null) {
    try {
      const ctx = await getContext();
      let raw = '';
      let promptName = 'auto';
      if (customPromptId) {
        const resp = await chrome.runtime.sendMessage({ type: 'RUN_CUSTOM_PROMPT', id: customPromptId, text: questionText });
        if (!resp?.ok) throw new Error(resp?.error || 'Generation failed');
        raw = resp.result;
        promptName = resp.promptName || 'custom';
        await chrome.storage.local.set({ lastCustomPromptId: customPromptId });
      } else {
        const prompt = buildPrompt('auto', questionText, ctx);
        const response = await chrome.runtime.sendMessage({ type: 'CEREBRAS_GENERATE', prompt });
        if (!response?.ok) throw new Error(response?.error || 'Generation failed');
        raw = response.result;
      }
      const parts = parseAnswers(raw);
      const joined = parts.join('\n');
      const answer = joined;
      STATE.currentAnswer = answer;
      await chrome.storage.local.set({ lastAnswer: answer });

      // Update modal
      const modal = STATE.modal;
      if (modal) {
        modal.querySelector('.loading').style.display = 'none';
        modal.querySelector('.answer-text').style.display = 'block';
        modal.querySelector('.answer-text').textContent = answer;
        modal.querySelector('.modal-actions').style.display = 'flex';

        // Add event listeners for buttons
        modal.querySelector('.btn-write-here').addEventListener('click', async () => {
          closeModal();
          await typeAnswer(parts[0] || '');
        });

        modal.querySelector('.btn-write-all').addEventListener('click', async () => {
          closeModal();
          for (const part of parts) {
            await new Promise(r => setTimeout(r, 3000));
            await typeAnswer(part, { skipCountdown: true });
          }
        });

        modal.querySelector('.btn-copy').addEventListener('click', () => {
          navigator.clipboard.writeText(answer);
          showNotification('Answer copied to clipboard!');
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
      // Save the specific prompt name for better context tracking.
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
    modal.querySelector('#prRun').addEventListener('click', () => {
      const pr = customPrompts.find(p=>p.id===selectedId);
      if(!pr){ showNotification('Select a prompt'); return; }
      modal.remove();
      if(STATE.modal){
        const loadEl = STATE.modal.querySelector('.loading');
        const ansEl = STATE.modal.querySelector('.answer-text');
        const act = STATE.modal.querySelector('.modal-actions');
        loadEl.style.display='block'; loadEl.textContent='Generating answer...';
        ansEl.style.display='none'; act.style.display='none';
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

  function parseAnswers(text){
    try {
      const obj = JSON.parse(text);
      if (Array.isArray(obj.answers)) {
        return obj.answers.map(a => String(a).trim());
      }
    } catch(e) {
      /* ignore */
    }
    return [text.trim()];
  }

  function buildPrompt(mode, question, context) {
    const ctxLines = (context || []).map((c, i) => `Q${i + 1}: ${c.q}\nA${i + 1}: ${c.a}`).join('\n');
    const rules = `You are building a consistent survey profile. Use prior context if helpful and choose answers that keep the participant qualified for the survey.\nSTRICT OUTPUT RULES:\n- Respond ONLY with JSON: {"answers": ["answer1", "answer2", ...]}.\n- Each element must correspond to the questions in order and remain consistent with previous answers.\n- Do not add any text outside the JSON.\n- Language: match the question language.`;
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
    while (list.length > 50) list.shift();
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

  // YouTube dubbing controls
  if (location.hostname.includes('youtube.com')) {
    setupYouTubeDubbing();
    document.addEventListener('yt-navigate-finish', setupYouTubeDubbing);
  }

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

// ===== YouTube Dubbing =====
async function setupYouTubeDubbing() {
  if (!location.pathname.startsWith('/watch')) return;
  const player = document.querySelector('.html5-video-player');
  if (!player || player.querySelector('#zepra-dub-bubble')) return;

  const settingsBtn = player.querySelector('.ytp-settings-button');
  const playerRect = player.getBoundingClientRect();
  let startLeft = 20, startTop = playerRect.height - 80;
  if (settingsBtn) {
    const sRect = settingsBtn.getBoundingClientRect();
    startLeft = sRect.left - playerRect.left - 60;
    startTop = sRect.top - playerRect.top;
  }

  const bubble = document.createElement('div');
  bubble.id = 'zepra-dub-bubble';
  bubble.textContent = '🔊';
  Object.assign(bubble.style, {
    position: 'absolute',
    left: startLeft + 'px',
    top: startTop + 'px',
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    background: '#111',
    border: '2px solid #39ff14',
    boxShadow: '0 0 6px #39ff14',
    color: '#ffe600',
    fontSize: '24px',
    cursor: 'grab',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  });
  player.appendChild(bubble);

  let drag = { active: false, offsetX: 0, offsetY: 0, moved: false };
  bubble.addEventListener('mousedown', e => {
    drag.active = true;
    drag.moved = false;
    drag.offsetX = e.offsetX;
    drag.offsetY = e.offsetY;
    bubble.style.cursor = 'grabbing';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function onMove(e) {
    if (!drag.active) return;
    drag.moved = true;
    const rect = player.getBoundingClientRect();
    const x = Math.min(rect.width - bubble.offsetWidth, Math.max(0, e.clientX - rect.left - drag.offsetX));
    const y = Math.min(rect.height - bubble.offsetHeight, Math.max(0, e.clientY - rect.top - drag.offsetY));
    bubble.style.left = x + 'px';
    bubble.style.top = y + 'px';
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    bubble.style.cursor = 'grab';
    if (!drag.moved) openDubModal();
    drag.active = false;
  }
}

async function openDubModal() {
  if (document.getElementById('zepra-dub-modal')) return;
  const overlay = document.createElement('div');
  overlay.id = 'zepra-dub-modal';
  Object.assign(overlay.style, {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000
  });

  const box = document.createElement('div');
  Object.assign(box.style, {
    background: '#000',
    border: '1px solid #39ff14',
    borderRadius: '8px',
    padding: '16px',
    color: '#ffe600',
    minWidth: '200px',
    fontFamily: 'sans-serif'
  });

  const label = document.createElement('label');
  label.textContent = 'Translate to:';
  label.style.display = 'block';
  label.style.marginBottom = '8px';

  const select = document.createElement('select');
  select.id = 'zepra-dub-lang';
  select.style.width = '100%';
  select.style.marginBottom = '12px';
  IFLYTEK_LANGS.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l;
    opt.textContent = l;
    select.appendChild(opt);
  });
  const { dubDefaultLang } = await chrome.storage.local.get('dubDefaultLang');
  if (dubDefaultLang) select.value = dubDefaultLang;

  const startBtn = document.createElement('button');
  startBtn.id = 'zepra-dub-start';
  startBtn.textContent = 'Start Dubbing';
  Object.assign(startBtn.style, {
    width: '100%',
    padding: '8px',
    background: '#111',
    border: '1px solid #39ff14',
    color: '#ffe600',
    cursor: 'pointer',
    marginBottom: '12px'
  });

  const status = document.createElement('div');
  status.id = 'zepra-dub-status';
  status.style.minHeight = '20px';
  status.style.fontSize = '14px';

  box.appendChild(label);
  box.appendChild(select);
  box.appendChild(startBtn);
  box.appendChild(status);
  overlay.appendChild(box);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  startBtn.addEventListener('click', () => startDubbing(select.value, startBtn, status));
}

function updateDubStatus(el, msg, type) {
  el.textContent = msg;
  if (type === 'error') el.style.color = '#ff4d4d';
  else if (type === 'success') el.style.color = '#39ff14';
  else el.style.color = '#ffe600';
}

async function startDubbing(lang, btn, statusEl) {
  try {
    btn.disabled = true;
    updateDubStatus(statusEl, 'Fetching transcript...');
    const video = document.querySelector('video');
    if (!video) throw new Error('Video not found');
    const videoId = new URLSearchParams(location.search).get('v') || location.pathname;
    const segments = await fetchTranscript();

    const cfg = await chrome.storage.local.get(['dubVoice','dubDialect','dubSpeed']);
    const audioSegs = [];
    const pending = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const key = `${videoId}_${lang}_${cfg.dubVoice}_${cfg.dubDialect}_${cfg.dubSpeed}_${i}`;
      const cached = await cacheGet(key);
      if (cached) {
        audioSegs.push({ start: seg.start, audio: cached });
      } else {
        pending.push({ seg, key });
      }
    }

    if (pending.length) {
      updateDubStatus(statusEl, 'Translating text...');
      const translations = [];
      for (const item of pending) {
        translations.push(await translateSegment(item.seg.text, lang));
      }
      updateDubStatus(statusEl, 'Generating audio...');
      for (let i = 0; i < pending.length; i++) {
        const item = pending[i];
        const translated = translations[i];
        const tts = await chrome.runtime.sendMessage({
          type: 'IFLYTEK_TTS',
          text: translated,
          opts: { lang, voice: cfg.dubVoice, dialect: cfg.dubDialect, speed: cfg.dubSpeed }
        });
        if (!tts?.ok) throw new Error(tts?.error || 'TTS failed');
        await cacheSet(item.key, tts.audio);
        audioSegs.push({ start: item.seg.start, audio: tts.audio });
      }
    }

    playSegments(audioSegs, video);
    updateDubStatus(statusEl, 'Dubbing complete! Playing now...', 'success');
  } catch (e) {
    console.error('Dubbing error:', e);
    updateDubStatus(statusEl, `Error: ${e.message || e}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function fetchTranscript() {
  // Method A: scrape transcript panel if open
  const panel = document.querySelector('ytd-transcript-renderer');
  if (panel) {
    const segs = [];
    panel.querySelectorAll('ytd-transcript-segment-renderer').forEach(seg => {
      const tStr = seg.querySelector('.segment-timestamp')?.textContent?.trim() || '0:00';
      const text = seg.querySelector('.segment-text')?.textContent?.trim() || '';
      const start = tStr.split(':').reduce((acc, v) => acc * 60 + Number(v), 0);
      if (text) segs.push({ start, text });
    });
    if (segs.length) return segs;
  }

  // Method B: captured network transcript
  const resp = await chrome.runtime.sendMessage({ type: 'GET_CAPTURED_TRANSCRIPT' });
  if (resp?.xml) {
    const xml = new DOMParser().parseFromString(resp.xml, 'text/xml');
    const segs = Array.from(xml.getElementsByTagName('text')).map(n => ({
      start: parseFloat(n.getAttribute('start') || '0'),
      text: n.textContent
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
    })).filter(s => s.text);
    if (segs.length) return segs;
  }

  throw new Error('No transcript or captions are available for this video.');
}

async function translateSegment(text, lang) {
  const prompt = `Translate the following text to ${lang}. Respond ONLY in JSON like {"translated_text":""}.\nText: ${text}`;
  const res = await chrome.runtime.sendMessage({ type: 'CEREBRAS_GENERATE', prompt });
  try {
    const obj = JSON.parse(res.result);
    return obj.translated_text || '';
  } catch {
    return res.result || '';
  }
}

function openDubDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('zepra_dub', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('segments');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

async function cacheGet(key) {
  const db = await openDubDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('segments', 'readonly');
    const req = tx.objectStore('segments').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheSet(key, data) {
  const db = await openDubDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('segments', 'readwrite');
    tx.objectStore('segments').put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function playSegments(list, video) {
  const origMuted = video.muted;
  video.muted = true;
  const base = video.currentTime;
  list.forEach((seg, idx) => {
    const delay = Math.max(0, (seg.start - base) * 1000);
    setTimeout(() => {
      const a = new Audio(seg.audio);
      a.play();
      if (idx === list.length - 1) {
        a.onended = () => { video.muted = origMuted; };
      }
    }, delay);
  });
}

chrome.storage.local.get('loggedIn', ({ loggedIn }) => {
  if (loggedIn) init();
});
chrome.storage.onChanged.addListener((chg, area) => {
  if (area === 'local' && chg.loggedIn?.newValue) init();
});
