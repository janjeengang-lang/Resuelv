document.addEventListener('DOMContentLoaded', () => {
  const els = {
    protocol: () => document.querySelector('input[name="proxyProtocol"]:checked')?.value || 'socks',
    useMonthly: document.getElementById('useMonthlyProxy'),
    getIP: document.getElementById('getMyIP'),
    disable: document.getElementById('disableProxy'),
    setMonthly: document.getElementById('setMonthlyProxy'),
    monthlyInput: document.getElementById('monthlyProxyInput'),
    setFF: document.getElementById('setFFProxy'),
    ffInput: document.getElementById('ffProxyInput'),
    status: document.getElementById('proxyStatus'),
    ipBox: document.getElementById('ipInfoBox'),
    ip: document.getElementById('ipInfoIp'),
    isp: document.getElementById('ipInfoIsp'),
    city: document.getElementById('ipInfoCity'),
    region: document.getElementById('ipInfoRegion'),
    timezone: document.getElementById('ipInfoTimezone'),
    currentBox: document.getElementById('currentProxyBox'),
    currentType: document.getElementById('currentProxyType'),
    currentString: document.getElementById('currentProxyString')
  };

  function updateStatus() {
    chrome.storage.local.get(['proxyActive','proxyInfo'], ({proxyActive, proxyInfo}) => {
      if (proxyActive && proxyInfo) {
        els.status.textContent = 'Proxy: On';
        els.status.classList.add('on');
        els.status.classList.remove('off');
        els.ipBox.style.display = 'block';
        els.currentBox.style.display = 'block';
        els.ip.textContent = proxyInfo.ip || '';
        els.isp.textContent = proxyInfo.isp || '';
        els.city.textContent = proxyInfo.city || '';
        els.region.textContent = proxyInfo.region || '';
        els.timezone.textContent = proxyInfo.timezone || '';
        els.currentType.textContent = proxyInfo.type || '';
        els.currentString.textContent = proxyInfo.proxy || '';
      } else {
        els.status.textContent = 'Proxy: Off';
        els.status.classList.add('off');
        els.status.classList.remove('on');
        els.ipBox.style.display = 'none';
        els.currentBox.style.display = 'none';
      }
    });
  }
  updateStatus();
  chrome.storage.onChanged.addListener(ch => {
    if (ch.proxyActive || ch.proxyInfo) updateStatus();
  });

  function parseProxy(str) {
    const [host, port, username, password] = (str || '').split(':');
    return { host, port, username, password };
  }

  function connect(str) {
    const { host, port, username, password } = parseProxy(str);
    if (!host || !port) {
      alert('Invalid proxy format');
      return;
    }
    const proxyType = els.protocol();
    chrome.runtime.sendMessage({
      type: 'SET_PROXY',
      proxy: {
        proxyIp: host,
        proxyPort: port,
        proxyType,
        proxyUsername: username,
        proxyPassword: password
      }
    }, res => {
      if (!res?.ok) alert(res?.error || 'Connection failed');
    });
  }

  els.useMonthly?.addEventListener('click', () => connect(els.monthlyInput.value));
  els.setMonthly?.addEventListener('click', () => connect(els.monthlyInput.value));
  els.setFF?.addEventListener('click', () => connect(els.ffInput.value));

  els.getIP?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'GET_PUBLIC_IP' }, r => {
      if (r?.ok) {
        const info = r.info || {};
        els.ipBox.style.display = 'block';
        els.ip.textContent = info.ip || '';
        els.isp.textContent = info.isp || '';
        els.city.textContent = info.city || '';
        els.region.textContent = info.region || '';
        els.timezone.textContent = info.timezone || '';
      }
    });
  });

  els.disable?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_PROXY' });
  });
});
