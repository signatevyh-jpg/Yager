import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

let firebaseConfig = null;
export let app = null;
export let auth = null;

export async function initFirebase() {
  if (app) return;
  const res = await fetch('/api/firebase-config');
  firebaseConfig = await res.json();
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
}

export { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile };
