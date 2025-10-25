// Simplified proxy menu logic for Zepra

document.addEventListener('DOMContentLoaded', () => {
  const els = {
    proxyStatus: document.getElementById('proxyStatus'),
    ipInfoBox: document.getElementById('ipInfoBox'),
    ipInfoIp: document.getElementById('ipInfoIp'),
    ipInfoIsp: document.getElementById('ipInfoIsp'),
    ipInfoCity: document.getElementById('ipInfoCity'),
    ipInfoRegion: document.getElementById('ipInfoRegion'),
    ipInfoTimezone: document.getElementById('ipInfoTimezone'),
    currentProxyBox: document.getElementById('currentProxyBox'),
    currentProxyType: document.getElementById('currentProxyType'),
    currentProxyString: document.getElementById('currentProxyString'),
    monthlyProxyInput: document.getElementById('monthlyProxyInput'),
    setMonthlyProxy: document.getElementById('setMonthlyProxy'),
    ffProxyInput: document.getElementById('ffProxyInput'),
    setFFProxy: document.getElementById('setFFProxy'),
    disableProxy: document.getElementById('disableProxy'),
    getMyIP: document.getElementById('getMyIP'),
  };

  function updateStatus() {
    chrome.storage.local.get(['proxyActive', 'proxyInfo', 'proxyDetails'], ({ proxyActive, proxyInfo, proxyDetails }) => {
      if (proxyActive && proxyInfo) {
        els.proxyStatus.textContent = 'Proxy On';
        els.proxyStatus.classList.remove('off');
        els.ipInfoBox.style.display = 'block';
        els.currentProxyBox.style.display = 'block';
        els.ipInfoIp.textContent = proxyInfo.ip || '-';
        els.ipInfoIsp.textContent = proxyInfo.isp || '-';
        els.ipInfoCity.textContent = proxyInfo.city || '-';
        els.ipInfoRegion.textContent = proxyInfo.country || '-';
        els.ipInfoTimezone.textContent = proxyInfo.timezone || '-';
        if (proxyDetails) {
          els.currentProxyType.textContent = proxyDetails.proxyType || '';
          els.currentProxyString.textContent = `${proxyDetails.proxyIp || ''}:${proxyDetails.proxyPort || ''}`;
        }
      } else {
        els.proxyStatus.textContent = 'Proxy Off';
        els.proxyStatus.classList.add('off');
        els.ipInfoBox.style.display = 'none';
        els.currentProxyBox.style.display = 'none';
      }
    });
  }

  updateStatus();
  chrome.storage.onChanged.addListener(ch => {
    if (ch.proxyActive || ch.proxyInfo || ch.proxyDetails) updateStatus();
  });

  function parseProxy(str) {
    const [host, port, user, pass] = str.split(':');
    return { proxyIp: host, proxyPort: port, proxyUsername: user, proxyPassword: pass };
  }

  async function setProxy(inputEl) {
    const val = inputEl.value.trim();
    if (!val) return;
    const protocol = document.querySelector('input[name="proxyProtocol"]:checked')?.value || 'http';
    const details = parseProxy(val);
    const resp = await chrome.runtime.sendMessage({ type: 'SET_PROXY', proxy: { proxyType: protocol, ...details } });
    if (resp?.ok) {
      await chrome.storage.local.set({ proxyDetails: { proxyType: protocol, ...details } });
      updateStatus();
    }
  }

  els.setMonthlyProxy?.addEventListener('click', () => setProxy(els.monthlyProxyInput));
  els.setFFProxy?.addEventListener('click', () => setProxy(els.ffProxyInput));
  els.disableProxy?.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_PROXY' });
    await chrome.storage.local.remove('proxyDetails');
    updateStatus();
  });

  els.getMyIP?.addEventListener('click', async () => {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_PUBLIC_IP' });
    if (resp?.ok) {
      els.ipInfoBox.style.display = 'block';
      const info = resp.info || {};
      els.ipInfoIp.textContent = info.ip || '-';
      els.ipInfoIsp.textContent = info.isp || '-';
      els.ipInfoCity.textContent = info.city || '-';
      els.ipInfoRegion.textContent = info.country || '-';
      els.ipInfoTimezone.textContent = info.timezone || '-';
    }
  });
});

