const firebaseConfig = {
  apiKey: 'AIzaSyD4tYdVWd5iqtQwZgrQLiG83GIw62hpn1U',
  authDomain: 'zepra-89473.firebaseapp.com',
  projectId: 'zepra-89473',
  storageBucket: 'zepra-89473.firebasestorage.app',
  messagingSenderId: '868922736037',
  appId: '1:868922736037:web:d2de6153dff4ca0995fc4c',
  measurementId: 'G-S6MGNR8G39'
};

// Redirect if already logged in
chrome.storage.local.get('loggedIn', ({ loggedIn }) => {
  if (loggedIn) {
    window.location.href = 'popup.html';
  }
});

const emailEl = document.getElementById('email');
const passEl = document.getElementById('password');
const btn = document.getElementById('loginBtn');
const msg = document.getElementById('loginError');

btn.addEventListener('click', async () => {
  const email = emailEl.value.trim();
  const password = passEl.value;
  msg.textContent = '';
  msg.style.color = 'var(--warn)';
  if (!email || !password) {
    msg.textContent = 'يرجى إدخال البريد الإلكتروني وكلمة المرور';
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
    await chrome.storage.local.set({ loggedIn: true, idToken: data.idToken });
    msg.style.color = 'var(--accent)';
    msg.textContent = 'تم تسجيل الدخول بنجاح!';
    setTimeout(() => { window.location.href = 'popup.html'; }, 800);
  } catch (e) {
    msg.textContent = 'كلمة المرور أو البريد الإلكتروني غير صحيح';
  }
});
