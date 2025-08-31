// prompts.js
const listEl = document.getElementById('promptList');
const addBtn = document.getElementById('addPrompt');
const formSection = document.getElementById('formSection');
const nameInput = document.getElementById('promptName');
const textInput = document.getElementById('promptText');
const saveBtn = document.getElementById('savePrompt');
const cancelBtn = document.getElementById('cancelPrompt');

async function load() {
  const { customPrompts = [] } = await chrome.storage.sync.get('customPrompts');
  listEl.innerHTML = '';
  customPrompts.forEach(p => {
    const row = document.createElement('div');
    row.className = 'prompt-row';
    row.innerHTML = `
      <span>${p.name}</span>
      <button class="btn warn" data-name="${p.name}">Delete</button>
    `;
    listEl.appendChild(row);
  });
}

addBtn.addEventListener('click', () => {
  formSection.style.display = 'block';
  nameInput.value = '';
  textInput.value = '';
});

cancelBtn.addEventListener('click', () => {
  formSection.style.display = 'none';
});

saveBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  const text = textInput.value.trim();
  if (!name || !text) return;
  const { customPrompts = [] } = await chrome.storage.sync.get('customPrompts');
  customPrompts.push({ name, text });
  await chrome.storage.sync.set({ customPrompts });
  formSection.style.display = 'none';
  load();
});

listEl.addEventListener('click', async (e) => {
  const name = e.target.dataset.name;
  if (!name) return;
  const { customPrompts = [] } = await chrome.storage.sync.get('customPrompts');
  const idx = customPrompts.findIndex(p => p.name === name);
  if (idx > -1) {
    customPrompts.splice(idx, 1);
    await chrome.storage.sync.set({ customPrompts });
    load();
  }
});

load();
