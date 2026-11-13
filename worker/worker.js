// Cat Hero Studio office worker (Mac mini).
// Listens to the Firestore `jobs` queue written by the office page, runs each
// command with headless Claude Code for that employee, streams progress and
// writes the final report back. Idle = a Firestore listener only, no Claude use.
import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import * as fast from "./fastchrome.js";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

const HOME = os.homedir();
const ROOT = path.join(HOME, "UnityProjects");
const KEY = process.env.OFFICE_KEY || path.join(HOME, ".config/cathero-office/service-account.json");
const PROJECT_URL = "https://claude.ai/code/project/chan_01KHZZY2Zsyqn7jE4CfbzvCK";
const MAX_PARALLEL = 2;              // 16 GB RAM: at most two Claude jobs at once
const JOB_TIMEOUT_MS = 90 * 60 * 1000;
const BUSY_WINDOW_S = 90;            // a game folder touched this recently counts as busy

// Which folder each team works in. Paper-roll-Lazy-Cat is never used.
const TEAMS = {
  b1: { name: "Bản 1 · Dọn dẹp", game: "Cat Hero Spacecraft", folder: path.join(ROOT, "CatHeroSpacecraft") },
  b2: { name: "Bản 2 · Bắn phá", game: "Cat Hero Invaders Universe", folder: path.join(ROOT, "CatHeroInvadersUniverse") },
  b3: { name: "Bản 3 · Thả lính", game: "Cat Hero Animal Soldiers", folder: path.join(ROOT, "CatHeroAnimalSoldiers") },
  b4: { name: "Bản 4 · Solo", game: "Cat Hero Solo Play", folder: path.join(ROOT, "CatHeroSoloPlay") },
  sports: { name: "100 Sports", game: "100 Sports", folder: path.join(ROOT, "100Sports") },
  moe: { name: "Moe Family", game: "Moe Family Only Up", folder: path.join(HOME, "Documents", "GitHub", "MoeFamily") },
  paperroll: { name: "Paper Roll", game: "Paper Roll: Lazy Cat", folder: path.join(ROOT, "Paper-roll-Lazy-Cat") },
  chung: { name: "Chung", game: "cả 7 game", folder: null },
  idea: { name: "Idea maker", game: "cả studio", folder: null },
  ceo: { name: "Bàn CEO", game: "cả studio", folder: null }
};
const GAME_FOLDERS = Object.values(TEAMS).map((t) => t.folder).filter(Boolean);

const log = (...a) => console.log(new Date().toISOString(), ...a);

initializeApp({ credential: cert(JSON.parse(fs.readFileSync(KEY, "utf8"))) });
const db = getFirestore();
const jobsCol = db.collection("jobs");
const workerDoc = db.collection("office").doc("worker");
const sessionsDoc = db.collection("office").doc("sessions");

const running = new Map();     // jobId -> { child, lock }
const locks = new Set();       // lock keys in use
const lastOwnFinish = new Map(); // folder -> ms
let pending = [];              // latest queued/waiting docs

// ---------- helpers ----------
function lockKeyFor(job) {
  const team = TEAMS[job.team];
  return team && team.folder ? team.folder : `seat:${job.seatId}`;
}

function sh(cmd, args) {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 20000, maxBuffer: 1 << 20 },
    (err, stdout) => resolve(err ? "" : String(stdout))));
}

// Busy = a thread (or a person) changed the game folder in the last BUSY_WINDOW_S
// seconds, or git is mid-operation there. Library/Temp/Logs churn from an idle
// Unity editor is ignored.
async function folderBusy(folder) {
  if (!folder) return null;
  if (fs.existsSync(path.join(folder, ".git", "index.lock"))) return "git đang chạy trong thư mục game";
  const own = lastOwnFinish.get(folder) || 0;
  if (Date.now() - own < BUSY_WINDOW_S * 1000) return null;
  const dirs = ["Assets", "Docs", "Tools", "Packages", "ProjectSettings"].map((d) => path.join(folder, d)).filter((d) => fs.existsSync(d));
  if (!dirs.length) return null;
  const out = await sh("/usr/bin/find", [...dirs, "-type", "f", "-newermt", `-${BUSY_WINDOW_S} seconds`, "-not", "-name", "*.meta~", "-print", "-quit"]);
  return out.trim() ? "thread của game đang sửa thư mục này, chờ xong rồi chạy" : null;
}

function ceoPrompt(job) {
  const cli = `node ${path.join(ROOT, "CatHeroOffice", "worker", "office-cli.mjs")}`;
  return [
    `You are the CEO assistant of Cat Hero Studio, sitting at the CEO desk of Anh Ninh (Phuong) in the studio office web page. Phuong is waiting on that page for your answer.`,
    `The studio has 8 teams and 26 senior employees (each a Claude session run by the same office queue). Office tool (run with Bash):`,
    `  ${cli} roster            -> teams and seat ids`,
    `  ${cli} status [--hours N] -> latest job, status and report summary per employee`,
    `  ${cli} report <jobId>     -> one full report`,
    `  ${cli} dispatch --seat <seatId> --command "..."  or  --team <teamId> --command "..."  -> give work to an employee or a whole team (they run on this Mac and report on their own desks)`,
    `Game folders (read only for you): ${GAME_FOLDERS.join(", ")}. Never edit game files yourself; delegate changes to the right employee with dispatch. Write your own notes only in ${path.join(ROOT, "CatHeroOffice", "workspace", "ceo")}.`,
    `When you dispatch, write a clear self-contained brief (goal, constraints, what done looks like) in Vietnamese, pick the right seat or team, and avoid duplicate work that is already queued or running (check status first). Do not dispatch more than 6 jobs per request unless Phuong asked for it.`,
    `Outward actions are NOT allowed in this run and must not be delegated either: store submissions, publishing, pushing to public places, ad campaigns or budgets, sending messages, purchases, deleting data. If one is needed, begin your final message with "CẦN XÁC NHẬN:" and say exactly what, where and why.`,
    `Your final message is the report on the CEO desk, in Vietnamese. Its FIRST line must be "Đã giao cho: <employee title (team)>, ..." listing every job you dispatched, or "Đã giao cho: không ai (Trợ lý tự trả lời)". Then the answer in short bullets, then one bullet per dispatched job (employee, one-line task), then what you could not verify. No em-dashes.`
  ].join("\n");
}

function rolePrompt(job, team) {
  if (job.team === "ceo") return ceoPrompt(job);
  const threadLink = job.thread ? `${PROJECT_URL}?thread=${job.thread}` : PROJECT_URL;
  const where = team.folder
    ? `Your game folder is ${team.folder}. Work only inside it. Do not edit any other game folder (${GAME_FOLDERS.filter((f) => f !== team.folder).join(", ")}) or anything else outside your folder, except notes in your memory.`
    : `You are a shared role for all seven games (folders ${GAME_FOLDERS.join(", ")}). You may read them, but do not edit game files; write your own files only in ${path.join(ROOT, "CatHeroOffice", "workspace", job.role)}.`;
  return [
    `You are "${job.title}" (${team.name}, ${team.game}), a senior ${String(job.title).split(" · ")[0]} at Cat Hero Studio working for Phuong. Work like a senior: understand the codebase and project notes before changing anything, make careful, well-tested changes, keep the game's existing style and rules, and push back with reasons when a request would hurt the game.`,
    `This command was sent from the studio office web page and Phuong is waiting on that page for your report.`,
    ...(job.batchId ? [`This request went to your whole team at once (every member gets it). Answer and act for your own role only; leave teammates' parts to them. Teammates in the same game folder run one after another, so keep your changes small and committed in clear steps.`] : []),
    where,
    `Outward actions are NOT allowed in this run: submitting or changing anything on App Store Connect or Google Play, publishing or pushing to public places, creating or changing ad campaigns or budgets, sending messages (Telegram, email, chat, social), purchases, deleting data or accounts. If the task needs one, do all the safe work first, then stop and begin your final message with "CẦN XÁC NHẬN:" and say exactly which action, its target and why, and ask Phuong to confirm it in the thread ${threadLink}.`,
    `Run at most one Unity batch/editor job at a time; follow the project notes in your memory.`,
    `Your final message is the report shown on the web page: write it in Vietnamese, lead with the result, keep it short (bullets are fine), name files you changed, and say what you could not verify. No em-dashes.`
  ].join("\n");
}

function short(s, n = 140) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function describeTool(block) {
  const i = block.input || {};
  const name = block.name || "tool";
  const arg = i.description || i.command || i.file_path || i.pattern || i.url || i.query || i.prompt || "";
  const label = { Bash: "Chạy lệnh", Read: "Đọc", Edit: "Sửa", Write: "Ghi", Grep: "Tìm", Glob: "Tìm file", WebFetch: "Đọc web", WebSearch: "Tìm web", Agent: "Giao phụ tá", TodoWrite: "Cập nhật kế hoạch" }[name] || name;
  return short(`${label}: ${String(arg).replace(HOME, "~")}`);
}

// ---------- running a job ----------
// (Running Claude locally on the Mac was removed: commands only go into claude.ai.)

// ---------- delivering a command into claude.ai through Chrome ----------
// Sending and reading go through fastchrome.js (one warm tab in Phuong's Chrome,
// no AI). If it fails the job is marked "send_failed" with the reason; nothing retries.
function targetFor(job) {
  const isBoss = job.seatId === "boss";
  return {
    isBoss,
    which: isBoss && !job.targetUrl ? "project" : (job.targetUrl && !/thread=/.test(job.targetUrl) ? "project" : "thread"),
    url: job.targetUrl || (isBoss ? PROJECT_URL : `${PROJECT_URL}?thread=${job.thread}`)
  };
}

async function runDelivery(ref, job) {
  locks.add("chrome");
  running.set(ref.id, { child: { kill: () => {} }, lock: "chrome" });
  const t = targetFor(job);
  log("deliver", ref.id, job.title, short(job.command, 80));
  await ref.update({ status: "sending", startedAt: FieldValue.serverTimestamp(), note: FieldValue.delete(), progress: [], targetUrl: t.url });
  let update;
  try {
    const f = await fast.send({ url: t.url, which: t.which, message: job.command });
    let ok = f.ok;
    if (!ok) {
      // Maybe it went through but the check was slow: look once more, never resend.
      const seen = await fast.readReplies({ url: t.url, which: t.which, since: job.command }).catch(() => null);
      ok = !!(seen && seen.found);
    }
    update = ok
      ? { status: "sent", sentAt: FieldValue.serverTimestamp(), watchNext: Date.now() + 15000, watchTries: 0, report: "", timing: f.timing,
          progress: [{ t: Date.now(), text: `Đã gửi trong ${(f.timing.totalMs / 1000).toFixed(1)} giây` }] }
      : { status: "send_failed", error: "Đã gõ nhưng không thấy tin hiện trong thread. Mở thread kiểm tra, nếu chưa có thì gửi lại.", finishedAt: FieldValue.serverTimestamp() };
    log(ok ? "delivered fast" : "send not confirmed", ref.id, JSON.stringify(f.timing));
  } catch (e) {
    update = { status: "send_failed", error: short(e.message, 400), finishedAt: FieldValue.serverTimestamp() };
    log("send failed", ref.id, e.message);
  }
  running.delete(ref.id); locks.delete("chrome");
  if (job.replyTo && update.status === "sent") {
    // A reply typed on a job card: the parent card keeps following the thread.
    update = { ...update, status: "sent_reply", watchNext: FieldValue.delete() };
    await jobsCol.doc(job.replyTo).update({ status: "replying", watchTries: 0, watchNext: Date.now() + 10000, lastActivity: Date.now(),
      ask: FieldValue.delete(), finishedAt: FieldValue.delete() }).catch((e) => log("reopen parent failed", e.message));
  }
  await ref.update(update);
  bumpIdle();
  schedule();
}

// Seat titles for every desk, read from the page's data.js.
function officeSeats() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "CatHeroOffice", "data.js"), "utf8"), sandbox);
  const D = sandbox.window.OFFICE_DATA;
  return D.teams.flatMap((t) => t.seats.map((s) => ({ id: `${t.id}-${s.role}`, title: t.center ? D.roles[s.role].label : `${D.roles[s.role].label} · ${t.name}`, label: D.roles[s.role].label, team: t.name })));
}

// Roster kept live in memory so a send does not wait for a read.
let rosterCache = null;
db.collection("office").doc("roster").onSnapshot((d) => {
  const r = d.data() || {};
  rosterCache = { ...JSON.parse(r.seedJson || "{}"), ...(r.threads || {}) };
}, (e) => log("roster listener error", e.message));
async function rosterThreads() {
  const r = ((await db.collection("office").doc("roster").get()).data() || {});
  return { ...JSON.parse(r.seedJson || "{}"), ...(r.threads || {}) };
}

// ---------- copying the employee's reply back from claude.ai ----------
// Reading is cheap now (no AI): check often at first, then back off.
const WATCH_STEPS_MIN = [0.25, 0.25, 0.5, 0.5, 1, 1, 2, 3, 5];
const WATCH_MAX_MS = 8 * 3600 * 1000;
let watching = false;
const WATCHED = ["sent", "replying", "delegated", "needs_you"];
const ASK_RE = /CẦN XÁC NHẬN|cần (bạn|anh|chị)|bạn (muốn|chọn|đồng ý|xác nhận|quyết định|cho phép)|xác nhận (giúp|một câu)|đồng ý (không|chưa)|có (muốn|nên)[^.?]*\?|chọn (1|một|phương án)|\?\s*$/im;

// Find which employee seat a coordinator thread card points at ("Developer · Bản 4 Solo").
function seatForCard(title) {
  const n = (x) => String(x || "").toLowerCase().replace(/\s+/g, " ").trim();
  const t = n(title);
  const seats = officeSeats().sort((a, b) => b.title.length - a.title.length);
  return seats.find((s) => t === n(s.title) || t.startsWith(n(s.title)))
    || seats.find((s) => t.startsWith(n(s.label)) && t.includes("· " + n(s.team)));
}

function lastQuestion(text) {
  const parts = String(text).split(/(?<=[.?!:])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const qs = parts.filter((x) => /\?|xác nhận|đồng ý|chọn|quyết định|cần bạn/i.test(x));
  return (qs.slice(-2).join(" ") || parts.slice(-1)[0] || "").slice(0, 600);
}

async function watchTick() {
  if (watching || locks.has("chrome") || pending.length > 0) return;
  watching = true;
  try {
    const due = watchedDocs.filter((d) => !d.get("replyTo") && d.get("followUrl") !== "none" && d.get("watchNext") && d.get("watchNext") <= Date.now())
      .sort((a, b) => (a.get("watchNext") || 0) - (b.get("watchNext") || 0));
    const d = due[0];
    if (!d) return;
    const j = d.data();
    if (j.cancelRequested) { await d.ref.update({ status: "cancelled", finishedAt: FieldValue.serverTimestamp() }); return; }
    const sentAt = j.sentAt && j.sentAt.toMillis ? j.sentAt.toMillis() : Date.now();
    const tries = (j.watchTries || 0) + 1;
    const step = WATCH_STEPS_MIN[Math.min(tries, WATCH_STEPS_MIN.length - 1)];
    if (Date.now() - (j.lastActivity || sentAt) > WATCH_MAX_MS) {
      await d.ref.update({ status: j.status === "needs_you" ? "needs_you" : "done", watchNext: FieldValue.delete(), finishedAt: FieldValue.serverTimestamp() });
      return;
    }
    locks.add("chrome");
    let conv = null, delegated = null;
    try {
      const isBoss = j.seatId === "boss";
      if (isBoss && !j.followUrl && !overviewTitles.size) { return; }
      if (isBoss && !j.followUrl) {
        // CEO desk: wait for the coordinator; a thread card in its reply = handoff.
        const pc = await fast.readConversation({ url: PROJECT_URL, which: "project" });
        const head = String(j.command).replace(/\s+/g, " ").trim().slice(0, 40);
        let idx = -1;
        pc.rows.forEach((r, k) => { if (r.who === "you" && r.text.replace(/\s+/g, " ").includes(head)) idx = k; });
        const after = idx >= 0 ? pc.rows.slice(idx + 1).filter((r) => r.who === "claude") : [];
        const card = after.find((r) => r.card);
        if (card) {
          const seat = seatForCard(card.card);
          const threads = rosterCache || await rosterThreads();
          // Any thread can be followed: desks via the roster, others via the Threads list titles.
          const tid = (seat && threads[seat.id]) || overviewTitles.get(card.card.replace(/\s+/g, " ").trim().toLowerCase()) || null;
          delegated = { title: card.card, seatId: seat ? seat.id : null, url: tid ? `${PROJECT_URL}?thread=${tid}` : null };
        }
        conv = { rows: after.map((r) => ({ who: "coordinator", text: r.text, at: r.at })), working: pc.working, found: idx >= 0 };
      } else {
        const url = j.followUrl || targetFor(j).url;
        const which = j.followUrl ? "thread" : targetFor(j).which;
        const c = await fast.readConversation({ url, which });
        let rows;
        if (j.followUrl) {
          // Followed thread: everything since the CEO command was sent.
          const since = sentAt - 60000;
          rows = c.rows.filter((r) => r.at && Date.parse(r.at) >= since);
        } else {
          const head = String(j.command).replace(/\s+/g, " ").trim().slice(0, 40);
          let idx = -1;
          c.rows.forEach((r, k) => { if (idx < 0 && r.who === "you" && r.text.replace(/\s+/g, " ").includes(head)) idx = k; });
          rows = idx >= 0 ? c.rows.slice(idx + 1) : [];
        }
        conv = { rows, working: c.working, found: true };
      }
    } catch (e) {
      log("read failed", e.message);
    } finally { locks.delete("chrome"); bumpIdle(); }

    const next = Date.now() + step * 60000;
    if (!conv) { await d.ref.update({ watchTries: tries, watchNext: next }); return; }
    const upd = { watchTries: tries, watchNext: next };
    if (delegated) {
      Object.assign(upd, { status: "delegated", delegatedTo: delegated.title, delegatedSeat: delegated.seatId || null,
        followUrl: delegated.url || null, watchTries: 0, watchNext: Date.now() + 15000, lastActivity: Date.now(),
        conversation: conv.rows.slice(-20) });
      if (!delegated.url) {
        // Thread not found in the Threads list: show the handoff as the result instead of a stale "working".
        Object.assign(upd, { status: "done", followUrl: "none", watchNext: FieldValue.delete(), finishedAt: FieldValue.serverTimestamp(),
          report: `Đã giao cho: ${delegated.title}.` + (conv.rows.length ? "\n\n" + conv.rows.map((r) => r.text).join("\n\n").slice(0, 4000) : ""),
          note: "Xem tiếp trong thread đó trên claude.ai." });
      }
      log("delegated", d.id, delegated.title);
      await d.ref.update(upd);
      return;
    }
    const msgs = conv.rows.slice(-24);
    const prev = JSON.stringify(j.conversation || []);
    if (JSON.stringify(msgs) !== prev) { upd.conversation = msgs; upd.lastActivity = Date.now(); upd.watchTries = 0; upd.watchNext = Date.now() + 15000; }
    const lastClaude = [...msgs].reverse().find((r) => r.who === "claude" || r.who === "coordinator");
    const lastIsYou = msgs.length && msgs[msgs.length - 1].who === "you";
    if (conv.working || lastIsYou) {
      upd.status = j.followUrl || msgs.length ? "replying" : j.status;
    } else if (lastClaude && (!j.seatId || j.seatId !== "boss" || j.followUrl)) {
      if (ASK_RE.test(lastClaude.text)) {
        upd.status = "needs_you";
        upd.ask = lastQuestion(lastClaude.text);
        upd.watchNext = Date.now() + Math.max(step, 1) * 60000;
      } else {
        upd.status = "done";
        upd.report = lastClaude.text.slice(0, 12000);
        upd.finishedAt = FieldValue.serverTimestamp();
        upd.watchNext = FieldValue.delete();
      }
    } else if (lastClaude && j.seatId === "boss" && !j.followUrl) {
      // Coordinator answered without handing off: that answer is the result.
      if (ASK_RE.test(lastClaude.text)) { upd.status = "needs_you"; upd.ask = lastQuestion(lastClaude.text); }
      else if (Date.now() - sentAt > 90000) { upd.status = "done"; upd.report = lastClaude.text.slice(0, 12000); upd.finishedAt = FieldValue.serverTimestamp(); upd.watchNext = FieldValue.delete(); }
    }
    if (upd.status && upd.status !== "done" && upd.status !== "needs_you") upd.ask = FieldValue.delete();
    await d.ref.update(upd);
    if (upd.status && upd.status !== j.status) {
      log("job", d.id, j.status, "->", upd.status);
      setTimeout(() => overviewTick(), 4000);
    }
  } catch (e) {
    log("watch error", e.message);
  } finally {
    watching = false;
  }
}
// Watched jobs come from a live listener (no repeated queries, so Firestore reads stay tiny).
let watchedDocs = [];
jobsCol.where("status", "in", WATCHED).onSnapshot((snap) => { watchedDocs = snap.docs; }, (e) => log("watch listener error", e.message));
setInterval(() => { watchTick(); }, 5000);

// ---------- desk status from claude.ai's own thread list ----------
// Every 45 s (when Chrome is free) read the project's Threads overview and store
// each desk's real state, so work handed out in chat shows on the web too.
const SECTION_LABEL = [[/^Waiting/i, "ask", "Cần bạn"], [/^Working/i, "run", "Đang làm"], [/^Idle/i, "idle", "Rảnh"], [/^Resolved/i, "done", "Xong"]];
let overviewBusy = false, lastOverview = "";
const detailCache = new Map();
const overviewTitles = new Map();
async function overviewTick() {
  if (overviewBusy || watching || locks.has("chrome") || pending.length > 0) return;
  overviewBusy = true;
  locks.add("chrome");
  try {
    const rows = await fast.readOverview(PROJECT_URL);
    if (!rows.length) return;
    for (const r of rows) if (r.title) overviewTitles.set(r.title.replace(/\s+/g, " ").trim().toLowerCase(), r.id);
    const threads = rosterCache || await rosterThreads();
    const byThread = Object.fromEntries(Object.entries(threads).map(([seat, th]) => [th, seat]));
    const out = {};
    for (const r of rows) {
      const seat = byThread[r.id];
      if (!seat) continue;
      const m = SECTION_LABEL.find(([re]) => re.test(r.section)) || [null, "idle", r.state || "Rảnh"];
      out[seat] = { kind: m[1], label: m[2], summary: r.summary.slice(0, 300), ago: r.ago, unread: !!r.unread, title: r.title };
    }
    // For desks that wait on Phuong, keep the employee's full latest message so
    // the web can show the real question. Re-read only when that thread changed.
    let reads = 0;
    for (const [seat, st] of Object.entries(out)) {
      if (st.kind !== "ask") continue;
      const sig = `${st.summary}|${st.ago}`;
      const cached = detailCache.get(seat);
      if (cached && cached.sig === sig) { st.detail = cached.detail; continue; }
      if (reads >= 4) { if (cached) st.detail = cached.detail; continue; }
      reads++;
      const latest = await fast.latestReply(`${PROJECT_URL}?thread=${threads[seat]}`).catch(() => null);
      if (latest) { detailCache.set(seat, { sig, detail: latest.text }); st.detail = latest.text; }
    }
    if (reads) await fast.backToOverview().catch(() => {});
    const key = JSON.stringify(out);
    if (key !== lastOverview) {
      lastOverview = key;
      await db.collection("office").doc("threadStates").set({ seats: out, readAt: Timestamp.now() });
      log("desk states updated");
    }
  } catch (e) {
    log("overview read failed", e.message);
  } finally {
    locks.delete("chrome");
    overviewBusy = false;
  }
}
setInterval(overviewTick, 50000);
setTimeout(overviewTick, 5000);

// Close the warm tab after 10 idle minutes (nothing sending or being watched).
let idleTimer = null;
function bumpIdle() {
  // The desk-status poll uses the tab every 45 s, so it stays open (one tab only).
  if (true) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const busy = locks.has("chrome") || (await jobsCol.where("status", "in", ["sent", "replying", "delegated", "queued", "sending"]).limit(1).get()).size;
    if (busy) return bumpIdle();
    await fast.closeTab();
    log("warm tab closed (idle)");
  }, 10 * 60 * 1000);
}

// ---------- scheduler ----------
let scheduling = false;
async function schedule() {
  if (scheduling) return;
  scheduling = true;
  try {
    const t = (d) => d.createdAt?.toMillis?.() || 0;
    const list = [...pending].sort((a, b) => (t(a.data) - t(b.data)) || ((a.data.batchOrder || 0) - (b.data.batchOrder || 0)));
    for (const { ref, data } of list) {
      if (running.has(ref.id)) continue;
      if (data.cancelRequested) {
        await ref.update({ status: "cancelled", finishedAt: FieldValue.serverTimestamp() });
        continue;
      }
      if (!TEAMS[data.team] || !data.command) {
        await ref.update({ status: "error", error: "Không rõ nhân viên hoặc lệnh trống.", finishedAt: FieldValue.serverTimestamp() });
        continue;
      }
      // Every command is posted into claude.ai (one delivery at a time). No AI runs here.
      {
        if (locks.has("chrome")) {
          const w = "đang gửi lệnh khác vào claude.ai, xếp hàng chờ";
          if (data.status !== "waiting" || data.note !== w) await ref.update({ status: "waiting", note: w });
          continue;
        }
        const claimed = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists || !["queued", "waiting"].includes(snap.get("status"))) return false;
          tx.update(ref, { status: "sending", claimedBy: os.hostname() });
          return true;
        });
        if (!claimed) continue;
        const thread = (rosterCache || await rosterThreads())[data.seatId] || "";
        if (data.seatId !== "boss" && !thread && !data.targetUrl) {
          await ref.update({ status: "error", error: "Bàn này chưa gắn thread claude.ai.", finishedAt: FieldValue.serverTimestamp() });
          continue;
        }
        runDelivery(ref, { ...data, thread }).catch(async (e) => {
          log("delivery crashed", ref.id, e);
          running.delete(ref.id); locks.delete("chrome");
          await ref.update({ status: "error", error: short(e.message, 600), finishedAt: FieldValue.serverTimestamp() }).catch(() => {});
        });
      }
    }
  } catch (e) {
    log("schedule error", e.message);
  } finally {
    scheduling = false;
  }
}

jobsCol.where("status", "in", ["queued", "waiting"]).onSnapshot((snap) => {
  pending = snap.docs.map((d) => ({ ref: d.ref, data: d.data() }));
  schedule();
}, (err) => log("queue listener error", err.message));

// Cancel: kill the Claude process when the page asks.
jobsCol.where("status", "in", ["running", "sending"]).onSnapshot((snap) => {
  for (const d of snap.docs) {
    const r = running.get(d.id);
    if (r && d.get("cancelRequested")) { log("cancel", d.id); r.child.kill("SIGTERM"); }
  }
}, (err) => log("running listener error", err.message));

// Waiting jobs re-check busy folders now and then.
setInterval(schedule, 20000);

// Heartbeat for the "Mac mini online" chip.
async function beat() {
  await workerDoc.set({
    lastSeen: Timestamp.now(), host: os.hostname(), running: [...running.keys()], version: 1
  }, { merge: true }).catch((e) => log("heartbeat failed", e.message));
}
beat();
setInterval(beat, 60000);

// Jobs left "running" by a crash or reboot go back to the queue once.
(async () => {
  const stale = await jobsCol.where("status", "in", ["running", "sending"]).get();
  for (const d of stale.docs) {
    if (running.has(d.id)) continue;
    if (d.get("status") === "sending") {
      // Never re-send: the message may already be in the thread.
      await d.ref.update({ status: "error", error: "Mac mini khởi động lại giữa lúc gửi. Xem thread, nếu chưa có lệnh thì gửi lại.", finishedAt: FieldValue.serverTimestamp() });
      continue;
    }
    const retried = d.get("retried");
    await d.ref.update(retried
      ? { status: "error", error: "Mac mini khởi động lại giữa chừng.", finishedAt: FieldValue.serverTimestamp() }
      : { status: "queued", retried: true, note: "Chạy lại sau khi Mac mini khởi động lại" });
  }
})().catch((e) => log("stale check failed", e.message));

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    log("stopping, jobs running:", running.size);
    for (const { child } of running.values()) child.kill("SIGTERM");
    await workerDoc.set({ lastSeen: Timestamp.fromMillis(0) }, { merge: true }).catch(() => {});
    process.exit(0);
  });
}
log("worker started (claude.ai delivery only, no AI calls)");
fast.probe().then((r) => log("chrome control probe:", r));
