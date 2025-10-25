(async () => {
  const { primaryColor } = await chrome.storage.local.get('primaryColor');
  if (primaryColor) {
    document.documentElement.style.setProperty('--accent', primaryColor);
  }
})();

function showLoadingIndicator(parent){
  const vid=document.createElement('video');
  vid.src=chrome.runtime.getURL('src/media/loading.webm');
  vid.autoplay=true;vid.loop=true;vid.muted=true;
  vid.className='loading-indicator';
  parent.appendChild(vid);
  return ()=>vid.remove();
}

document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('.header-video video').forEach(v=>{
    const remove=showLoadingIndicator(v.parentElement);
    v.addEventListener('loadeddata',remove,{once:true});
  });
});

window.showLoadingIndicator=showLoadingIndicator;
