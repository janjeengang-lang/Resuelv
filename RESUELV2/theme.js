chrome.storage.local.get('primaryColor', res => {
  if(res.primaryColor){
    document.documentElement.style.setProperty('--primary', res.primaryColor);
  }
});
