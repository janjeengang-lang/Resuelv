let qaHistory = [];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if(msg.type === 'saveQA'){
    qaHistory.push({q: msg.q, a: msg.a});
    if(qaHistory.length > 10) qaHistory.shift();
    chrome.storage.local.set({qaHistory});
  }
  if(msg.type === 'mapForm'){
    fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer YOUR_API_KEY'},
      body: JSON.stringify({model:'gpt-3.5-turbo',messages:[{role:'user',content:`Map this form to identity keys and return JSON: ${msg.html}`}]}),
    }).then(r=>r.json()).then(data=>{
      const text = data.choices[0].message.content;
      sendResponse({mapping: JSON.parse(text)});
    }).catch(err=>{ console.error(err); sendResponse({mapping:{}}); });
    return true;
  }
  if(msg.type === 'checkConsistency'){
    chrome.storage.local.get(['identities','activeId','qaHistory'], res=>{
      const active = res.identities?.[res.activeId];
      const last = res.qaHistory || [];
      let warn = false;
      if(active){
        for(const k in active){
          if(typeof active[k]==='string' && msg.text && msg.text.toLowerCase().includes(active[k].toLowerCase())){
            warn = false; break;
          }
        }
      }
      if(!warn){
        const recent = last.slice(-10).map(x=>x.a).join(' ');
        if(recent && msg.text && !recent.includes(msg.text)) warn=false; // simplified
      }
      sendResponse({warn});
    });
    return true;
  }
});
