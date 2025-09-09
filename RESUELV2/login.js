chrome.storage.local.get('loggedIn', res=>{ if(res.loggedIn) window.location.href='popup.html';});

const video = document.getElementById('loginVideo');
const btn = document.getElementById('loginBtn');
const err = document.getElementById('loginError');

function swapVideo(src){
  const clone = video.cloneNode(true);
  clone.src = src;
  clone.classList.add('fade-out');
  video.parentElement.appendChild(clone);
  setTimeout(()=>{
    video.src = src;
    clone.remove();
  },600);
}

btn.addEventListener('click',()=>{
  const email = document.getElementById('email').value.trim();
  const pass = document.getElementById('password').value.trim();
  if(email && pass){
    chrome.storage.local.set({loggedIn:true},()=>{
      swapVideo('videos/zepra.webm');
      setTimeout(()=>{ window.location.href = 'popup.html'; },800);
    });
  } else {
    err.textContent = 'Invalid credentials';
    swapVideo('videos/carry.webm');
    setTimeout(()=>{ swapVideo('videos/key.webm'); },1500);
  }
});
