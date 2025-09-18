const listEl = document.getElementById('historyList');
const filterEl = document.getElementById('filter');

async function load(term='') {
  const items = await chrome.history.search({ text: term, startTime: 0, maxResults: 1000 });
  render(items);
}

function render(items) {
  listEl.innerHTML = '';
  for (const item of items) {
    const entry = document.createElement('div');
    entry.className = 'entry';

    const t = document.createElement('div');
    t.className = 'entry-title';
    t.textContent = item.title || item.url;
    entry.appendChild(t);

    const u = document.createElement('div');
    u.className = 'entry-url';
    u.textContent = item.url;
    entry.appendChild(u);

    const actions = document.createElement('div');
    actions.className = 'entry-actions';

    const openBtn = document.createElement('button');
    openBtn.textContent = '↗';
    openBtn.title = 'Open in new tab';
    openBtn.addEventListener('click', () => chrome.tabs.create({ url: item.url }));
    actions.appendChild(openBtn);

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋';
    copyBtn.title = 'Copy URL';
    copyBtn.addEventListener('click', () => navigator.clipboard.writeText(item.url));
    actions.appendChild(copyBtn);

    const addBtn = document.createElement('button');
    addBtn.textContent = '➕';
    addBtn.title = 'Add to Custom Web';
    addBtn.addEventListener('click', () => addToCustomWeb(item));
    actions.appendChild(addBtn);

    entry.appendChild(actions);
    listEl.appendChild(entry);
  }
}

async function addToCustomWeb(item) {
  const { customSites = [] } = await chrome.storage.local.get('customSites');
  if (!customSites.some(s => s.url === item.url)) {
    customSites.push({ name: item.title || item.url, url: item.url });
    await chrome.storage.local.set({ customSites });
  }
}

filterEl.addEventListener('input', e => load(e.target.value));

load();
