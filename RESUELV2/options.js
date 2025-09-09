const colorInput = document.getElementById('primaryColor');
const langInput = document.getElementById('answerLang');
const saveBtn = document.getElementById('save');

chrome.storage.local.get(['primaryColor','answerLang'], res => {
  if(res.primaryColor) {
    colorInput.value = res.primaryColor;
    document.documentElement.style.setProperty('--primary', res.primaryColor);
  }
  if(res.answerLang) langInput.value = res.answerLang;
});

colorInput.addEventListener('input',()=>{
  document.documentElement.style.setProperty('--primary', colorInput.value);
});

saveBtn.addEventListener('click',()=>{
  chrome.storage.local.set({primaryColor: colorInput.value, answerLang: langInput.value});
});
