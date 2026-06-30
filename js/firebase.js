import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCH9QilfBI6lorKexzFASfF_wHqtrVLPHU",
  authDomain: "evolution-tamborilero.firebaseapp.com",
  projectId: "evolution-tamborilero",
  storageBucket: "evolution-tamborilero.firebasestorage.app",
  messagingSenderId: "647006792385",
  appId: "1:647006792385:web:9cf86bb9eca722b4dbc240"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

let _polarSaveTimer = null;

export function setFbStatus(text, cls='') {
  const el = document.getElementById('fb-signal');
  if(el) { el.textContent = text; el.className = cls; }
}

export function schedulePolarSave(polar) {
  clearTimeout(_polarSaveTimer);
  _polarSaveTimer = setTimeout(() => flushPolarSave(polar), 2500);
}

async function flushPolarSave(polar) {
  try {
    await setDoc(doc(db, "polar_data", "current_polar"), polar);
    setFbStatus("Nube: Guardado ✓", "synced");
  } catch(e) {
    setFbStatus("Nube: Error al guardar", "error");
  }
}

export async function loadPolarFirebase() {
  setFbStatus("Nube: Leyendo...");
  try {
    const snap = await getDoc(doc(db, "polar_data", "current_polar"));
    setFbStatus("Nube: OK", "synced");
    return snap.exists() ? snap.data() : {};
  } catch(e) {
    setFbStatus("Nube: Offline (local)", "synced");
    return {};
  }
}

export async function saveHistoryEntry(entry) {
  try { await addDoc(collection(db, "historial"), entry); } catch(e) {}
}

export async function loadHistoryFirebase() {
  try {
    const q = query(collection(db, "historial"), orderBy("timestamp", "desc"), limit(500));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data());
  } catch(e) {
    return [];
  }
}