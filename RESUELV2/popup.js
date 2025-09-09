document.getElementById('openIdentities').addEventListener('click',()=>{
  chrome.tabs.create({url: chrome.runtime.getURL('identities.html')});
});

document.getElementById('openOptions').addEventListener('click',()=>{
  chrome.runtime.openOptionsPage();
});
