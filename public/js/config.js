// ─── Firebase Client Config ─────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyBobhek9X2bAfLf29vaIRvsFr8XWikXqS8",
    authDomain: "psyc-app.firebaseapp.com",
    projectId: "psyc-app",
    storageBucket: "psyc-app.firebasestorage.app",
    messagingSenderId: "850502892481",
    appId: "1:850502892481:web:69515e2cfebaf7ec648d40",
    measurementId: "G-NXH9F15YYP"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// ─── Server URL ─────────────────────────────────────────────────
const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const LOCAL_SERVER_URL = 'http://localhost:3000';
const DEPLOYED_SERVER_URL = "https://alwan-railway-server-production.up.railway.app";

// Local-first resolution:
// - if app is running on localhost but not on port 3000, point API calls to local backend on 3000
// - if app is running on localhost:3000, keep same-origin
const SERVER_URL = isLocalHost
    ? (window.location.port === '3000' ? window.location.origin : LOCAL_SERVER_URL)
    : DEPLOYED_SERVER_URL;

// Public VAPID key for Web Push (safe to expose in frontend)
const WEB_PUSH_VAPID_KEY = "BJ1bQIlak6Dz_JofHDTFEHwTQoAjM-nTr1s2OaIOSnyeYoDH4F3Ls6B1ER9s-FdBmSQFNNlRGTrgQX7lIOkkUjQ";
window.WEB_PUSH_VAPID_KEY = WEB_PUSH_VAPID_KEY;

