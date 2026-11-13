// Google sign-in gate + Firestore storage. Only accounts in ALLOWED_EMAILS get in;
// Firestore rules enforce the same list on the server, so data stays private
// even though this code is public.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithCredential, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, collection, query, orderBy, limit, onSnapshot, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, ALLOWED_EMAILS, GOOGLE_CLIENT_ID } from "./firebase-config.js?v=20261114r";

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
  const [roster, history, icons] = await Promise.all([getDoc(rosterRef), getDoc(historyRef), getDoc(doc(db, "office", "icons"))]);
  const api = {
    // seedJson (a JSON string set once in the console) is the starting roster;
    // `threads` holds later edits, where "" means the desk was emptied.
    threads: Object.fromEntries(Object.entries({
      ...JSON.parse((roster.exists() && roster.data().seedJson) || "{}"),
      ...((roster.exists() && roster.data().threads) || {})
    }).filter(([, v]) => v)),
    history: (history.exists() && history.data().seats) || {},
    icons: icons.exists() ? icons.data() : {},
    saveThread: (seatId, threadId) =>
      setDoc(rosterRef, { threads: { [seatId]: threadId || "" } }, { merge: true }),
    saveHistory: (key, list) =>
      setDoc(historyRef, { seats: { [key]: list || [] } }, { merge: true }),
    // Job queue read by the worker on the Mac mini (worker/worker.js).
    createJob: (job) => addDoc(collection(db, "jobs"), {
      ...job, status: "queued", createdAt: serverTimestamp(), createdBy: user.email
    }),
    cancelJob: (id) => updateDoc(doc(db, "jobs", id), { cancelRequested: true }),
    watchJobs: (cb) => onSnapshot(
      query(collection(db, "jobs"), orderBy("createdAt", "desc"), limit(80)),
      { includeMetadataChanges: false },
      (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))),
      (err) => console.warn("jobs", err)
    ),
    watchThreadStates: (cb) => onSnapshot(doc(db, "office", "threadStates"),
      (d) => cb(d.exists() ? (d.data().seats || {}) : {}), (err) => console.warn("threadStates", err)),
    watchWorker: (cb) => onSnapshot(doc(db, "office", "worker"),
      (d) => cb(d.exists() ? d.data() : null), (err) => console.warn("worker", err))
  };
  // Console helper for bulk edits: officeAdmin.setThreads({ "b1-developer": "cmsg_…" })
  window.officeAdmin = {
    setThreads: (map) => setDoc(rosterRef, { threads: map }, { merge: true })
  };
  $("#user-email").textContent = user.email;
  if (!started) { started = true; window.OfficeApp.start(api); }
  setState("in");
}

// Local design preview with fake data: http://localhost:8765/?demo (never on the live site).
const DEMO = location.hostname === "localhost" && new URLSearchParams(location.search).has("demo");
if (DEMO) {
  const T = (ms) => ({ toMillis: () => ms });
  const now = Date.now();
  window.OfficeApp.start({
    threads: { "b1-developer": "demo", "b2-developer": "demo", "b3-developer": "demo", "b4-developer": "demo", "chung-marketing": "demo", "chung-data": "demo" },
    history: {}, icons: Object.fromEntries(["b1", "b2", "b3", "b4", "sports", "moe", "paperroll"].map((k) => [k, `icons/${k}.png`])), saveThread: async () => {}, saveHistory: async () => {}, createJob: async () => {}, cancelJob: async () => {},
    watchJobs: (cb) => cb([
      { id: "d1", seatId: "b2-developer", status: "running", command: "Kiểm tra lỗi màn 12", createdAt: T(now - 60000), startedAt: T(now - 50000), progress: [{ text: "Đọc: Assets/Scripts/Wave.cs" }] },
      { id: "c1", seatId: "boss", team: "ceo", status: "needs_you", command: "bản 4: solo bị reject ở trên app store connect kìa, xử lý đi", createdBy: "me@x.com", createdAt: T(now - 600000), startedAt: T(now - 598000), sentAt: T(now - 597000), delegatedTo: "Developer · Bản 4 Solo", delegatedSeat: "b4-developer", followUrl: "https://claude.ai/code/project/x?thread=y", ask: "Bạn đồng ý đổi Simulated Gambling thành None rồi gửi duyệt lại không?", conversation: [{ who: "claude", text: "Apple từ chối vì khai báo độ tuổi có mô phỏng cờ bạc." }, { who: "claude", text: "Bạn đồng ý đổi Simulated Gambling thành None rồi gửi duyệt lại không?" }] },
      { id: "c2", seatId: "chung-qa", team: "chung", parentJob: "c1", createdBy: "ceo-assistant", status: "running", command: "Liệt kê 3 rủi ro chất lượng lớn nhất của 100 Sports", createdAt: T(now - 95000), startedAt: T(now - 90000), progress: [{ text: "Đọc: Docs/release/2026-11-12-health-check.md" }] },
      { id: "t1", seatId: "b1-developer", batchId: "b1-demo", batchOrder: 0, status: "done", command: "Mỗi người đề xuất 3 việc nên làm tuần này", createdAt: T(now - 300000), startedAt: T(now - 290000), finishedAt: T(now - 200000), report: "- Sửa lỗi kẹt boss màn 18\n- Giảm dung lượng build\n- Thêm test tự động" },
      { id: "t2", seatId: "b1-designer", batchId: "b1-demo", batchOrder: 1, status: "running", command: "Mỗi người đề xuất 3 việc nên làm tuần này", createdAt: T(now - 300000), startedAt: T(now - 100000), progress: [{ text: "Đọc: Docs/GameDesign.md" }] },
      { id: "t3", seatId: "b1-artist", batchId: "b1-demo", batchOrder: 2, status: "waiting", note: "nhân viên cùng thư mục đang làm việc trước, xếp hàng chờ", command: "Mỗi người đề xuất 3 việc nên làm tuần này", createdAt: T(now - 300000) },
      { id: "d2", seatId: "chung-data", status: "done", command: "Thử hệ thống", createdAt: T(now - 900000), startedAt: T(now - 880000), finishedAt: T(now - 60000), report: "Mình đã đọc xong cả 4 thư mục.\n\n| Game | Nhánh |\n|---|---|\n| Spacecraft | `main` |\n| Invaders | `art/blender-models` |" }
    ]),
watchThreadStates: (cb) => cb({ "b2-developer": { kind: "run", label: "Đang làm", summary: "Đang sửa lỗi màn 12", ago: "3m" }, "b3-artist": { kind: "ask", label: "Cần bạn", summary: "Chọn ý tưởng 1, 2 hoặc 3", ago: "2h" }, "chung-qa": { kind: "run", label: "Đang làm", summary: "Testing build 2 on Galaxy A17", ago: "2h" } }),
        watchWorker: (cb) => cb({ lastSeen: T(now) })
  });
  setState("in");
}

onAuthStateChanged(auth, async (user) => {
  if (DEMO) return;
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

// Primary sign-in: Google Identity Services button -> Firebase credential.
// Works on phones because it never needs the firebaseapp.com redirect page.
function setupGsi(tries = 0) {
  const gsi = window.google && window.google.accounts && window.google.accounts.id;
  if (!gsi) { if (tries < 60) setTimeout(() => setupGsi(tries + 1), 150); return; }
  gsi.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: async (resp) => {
      $("#gate-error").textContent = "";
      try {
        await signInWithCredential(auth, GoogleAuthProvider.credential(resp.credential));
      } catch (e) {
        $("#gate-error").textContent = "Đăng nhập lỗi: " + (e.code || e.message);
      }
    },
    auto_select: false,
    itp_support: true,
    context: "signin",
    ux_mode: "popup"
  });
  const box = $("#gsi-btn");
  const width = Math.min(340, Math.max(220, box.clientWidth || 300));
  gsi.renderButton(box, { theme: "outline", size: "large", shape: "pill", text: "signin_with", logo_alignment: "left", width, locale: "vi" });
}
setupGsi();

// Fallback: classic Firebase popup.
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
  $(id).addEventListener("click", () => {
    try { window.google && window.google.accounts.id.disableAutoSelect(); } catch (e) { /* ignore */ }
    signOut(auth).then(() => { if (started) location.reload(); });
  });
}
