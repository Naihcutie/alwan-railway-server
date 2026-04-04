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
const SERVER_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? window.location.origin
    : "https://alwan-railway-server-production.up.railway.app";

