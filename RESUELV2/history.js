async function loadHistory(){
  const { contextQA=[] } = await chrome.storage.local.get('contextQA');
  window._allHistory = contextQA;
  render(contextQA);
}

function render(list){
  const container = document.getElementById('historyList');
  container.innerHTML = list.map(e=>`
    <div class="hist-item">
      <div class="hist-q">Q: ${e.q}</div>
      <div class="hist-a">A: ${e.a}</div>
      <div class="hist-p">Prompt: ${e.promptName||'auto'}</div>
    </div>
  `).join('');
}

document.getElementById('filter').addEventListener('input', e=>{
  const tag = e.target.value.trim().toLowerCase();
  const filtered = window._allHistory.filter(h => !tag || (h.promptName||'').toLowerCase().includes(tag));
  render(filtered);
});

loadHistory();
