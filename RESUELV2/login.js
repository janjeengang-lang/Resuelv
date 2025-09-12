const firebaseConfig = {
  apiKey: 'AIzaSyD4tYdVWd5iqtQwZgrQLiG83GIw62hpn1U',
  authDomain: 'zepra-89473.firebaseapp.com',
  projectId: 'zepra-89473',
  storageBucket: 'zepra-89473.firebasestorage.app',
  messagingSenderId: '868922736037',
  appId: '1:868922736037:web:d2de6153dff4ca0995fc4c',
  measurementId: 'G-S6MGNR8G39'
};

const clickSound = new Audio(chrome.runtime.getURL('src/media/click.mp3'));
const successSound = new Audio(chrome.runtime.getURL('src/media/success.mp3'));

window.performLogin = async (email, password) => {
  clickSound.play();
  if (!email || !password) {
    return { success: false, message: 'Please enter email and password' };
  }
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`, {
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
    successSound.play();
    setTimeout(() => { window.location.href = 'popup.html'; }, 600);
    return { success: true };
  } catch (e) {
    return { success: false, message: 'Invalid email or password' };
  }
};

chrome.storage.local.get(['loggedIn', 'logoutMsg'], ({ loggedIn, logoutMsg }) => {
  if (loggedIn) {
    window.location.href = 'popup.html';
    return;
  }
  if (logoutMsg) {
    window.__sessionExpired = true;
    chrome.storage.local.remove('logoutMsg');
  }
});
