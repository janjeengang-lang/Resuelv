async function loadSites(){
  const { customSites = [] } = await chrome.storage.local.get('customSites');
  const container = document.getElementById('sites');
  container.innerHTML = '';
  customSites.forEach(site => {
    const btn = document.createElement('button');
    btn.textContent = site.name;
    btn.className = 'btn';
    btn.style.marginBottom = '8px';
    btn.addEventListener('click', () => {
      document.getElementById('viewer').src = site.url;
    });
    container.appendChild(btn);
  });
}

loadSites();
