(async () => {
  const { primaryColor } = await chrome.storage.local.get('primaryColor');
  if (primaryColor) {
    document.documentElement.style.setProperty('--accent', primaryColor);
  }
})();
