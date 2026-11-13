// Google sign-in gate + Firestore storage. Only accounts in ALLOWED_EMAILS get in;
// Firestore rules enforce the same list on the server, so data stays private
// even though this code is public.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, ALLOWED_EMAILS } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const $ = (s) => document.querySelector(s);
const setState = (s) => { document.body.dataset.auth = s; };
let started = false;

function isAllowed(user) {
  const email = (user.email || "").toLowerCase();
  return user.emailVerified && ALLOWED_EMAILS.map((e) => e.toLowerCase()).includes(email);
}

async function startOffice(user) {
  const rosterRef = doc(db, "office", "roster");
  const historyRef = doc(db, "office", "history");
  const [roster, history] = await Promise.all([getDoc(rosterRef), getDoc(historyRef)]);
  const api = {
    // seedJson (a JSON string set once in the console) is the starting roster;
    // `threads` holds later edits, where "" means the desk was emptied.
    threads: Object.fromEntries(Object.entries({
      ...JSON.parse((roster.exists() && roster.data().seedJson) || "{}"),
      ...((roster.exists() && roster.data().threads) || {})
    }).filter(([, v]) => v)),
    history: (history.exists() && history.data().seats) || {},
    saveThread: (seatId, threadId) =>
      setDoc(rosterRef, { threads: { [seatId]: threadId || "" } }, { merge: true }),
    saveHistory: (key, list) =>
      setDoc(historyRef, { seats: { [key]: list || [] } }, { merge: true })
  };
  // Console helper for bulk edits: officeAdmin.setThreads({ "b1-developer": "cmsg_…" })
  window.officeAdmin = {
    setThreads: (map) => setDoc(rosterRef, { threads: map }, { merge: true })
  };
  $("#user-email").textContent = user.email;
  if (!started) { started = true; window.OfficeApp.start(api); }
  setState("in");
}

onAuthStateChanged(auth, async (user) => {
  $("#gate-error").textContent = "";
  if (!user) { setState("signedout"); return; }
  if (!isAllowed(user)) {
    $("#denied-email").textContent = user.email || "(không rõ email)";
    setState("denied");
    return;
  }
  try {
    await startOffice(user);
  } catch (e) {
    setState("signedout");
    $("#gate-error").textContent = "Không tải được dữ liệu: " + (e.code || e.message);
  }
});

$("#btn-google").addEventListener("click", async () => {
  $("#gate-error").textContent = "";
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
      $("#gate-error").textContent = "Đăng nhập lỗi: " + (e.code || e.message);
    }
  }
});
for (const id of ["#btn-signout", "#btn-switch"]) {
  $(id).addEventListener("click", () => signOut(auth).then(() => { if (started) location.reload(); }));
}
