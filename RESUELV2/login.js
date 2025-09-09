const firebaseConfig = {
  apiKey: 'AIzaSyD4tYdVWd5iqtQwZgrQLiG83GIw62hpn1U',
  authDomain: 'zepra-89473.firebaseapp.com',
  projectId: 'zepra-89473',
  storageBucket: 'zepra-89473.firebasestorage.app',
  messagingSenderId: '868922736037',
  appId: '1:868922736037:web:d2de6153dff4ca0995fc4c',
  measurementId: 'G-S6MGNR8G39'
};

const emailEl = document.getElementById('email');
const passEl = document.getElementById('password');
const btn = document.getElementById('loginBtn');
const msg = document.getElementById('loginError');
const headerWrap = document.getElementById('headerWrap');
let headerVideo = document.getElementById('headerVideo');

function switchHeader(src){
  if(!headerWrap) return;
  const newVid = document.createElement('video');
  newVid.autoplay = true;
  newVid.loop = true;
  newVid.muted = true;
  newVid.src = src;
  newVid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.6s';
  headerWrap.appendChild(newVid);
  requestAnimationFrame(()=>{ newVid.style.opacity = 1; });
  if(headerVideo){
    headerVideo.style.opacity = 0;
    setTimeout(()=>{ headerVideo.remove(); headerVideo = newVid; },600);
  } else {
    headerVideo = newVid;
  }
}

// Redirect if already logged in and show any logout message
chrome.storage.local.get(['loggedIn', 'logoutMsg'], ({ loggedIn, logoutMsg }) => {
  if (loggedIn) {
    window.location.href = 'popup.html';
  } else if (logoutMsg) {
    msg.textContent = logoutMsg;
    msg.style.color = 'var(--warn)';
    chrome.storage.local.remove('logoutMsg');
  }
});

btn.addEventListener('click', async () => {
  const email = emailEl.value.trim();
  const password = passEl.value;
  msg.textContent = '';
  msg.style.color = 'var(--warn)';
  if (!email || !password) {
    msg.textContent = 'Please enter email and password';
    return;
  }
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
      });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    await chrome.storage.local.set({
      loggedIn: true,
      userEmail: email,
      loginTime: Date.now()
    });
    msg.style.color = 'var(--accent)';
    msg.textContent = 'Logged in successfully!';
    switchHeader('src/media/zepra.webm');
    setTimeout(() => { window.location.href = 'popup.html'; }, 800);
  } catch (e) {
    switchHeader('src/media/carry.webm');
    msg.textContent = 'Invalid email or password';
  }
});
