import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js';
import { getAuth, signInWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'AIzaSyD4tYdVWd5iqtQwZgrQLiG83GIw62hpn1U',
  authDomain: 'zepra-89473.firebaseapp.com',
  projectId: 'zepra-89473',
  storageBucket: 'zepra-89473.firebasestorage.app',
  messagingSenderId: '868922736037',
  appId: '1:868922736037:web:d2de6153dff4ca0995fc4c',
  measurementId: 'G-S6MGNR8G39'
};

const app = initializeApp(firebaseConfig);
getAnalytics(app);
const auth = getAuth(app);

document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, email, password);
    await chrome.storage.local.set({ loggedIn: true });
    window.location.href = 'popup.html';
  } catch (e) {
    errEl.textContent = e.message;
  }
});
