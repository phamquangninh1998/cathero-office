// Cat Hero Studio office worker (Mac mini).
// Listens to the Firestore `jobs` queue written by the office page, runs each
// command with headless Claude Code for that employee, streams progress and
// writes the final report back. Idle = a Firestore listener only, no Claude use.
import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

const HOME = os.homedir();
const ROOT = path.join(HOME, "UnityProjects");
const KEY = process.env.OFFICE_KEY || path.join(HOME, ".config/cathero-office/service-account.json");
const CLAUDE = process.env.CLAUDE_BIN || "/opt/homebrew/bin/claude";
const PROJECT_URL = "https://claude.ai/code/project/chan_01KHZZY2Zsyqn7jE4CfbzvCK";
const MAX_PARALLEL = 2;              // 16 GB RAM: at most two Claude jobs at once
const JOB_TIMEOUT_MS = 90 * 60 * 1000;
const BUSY_WINDOW_S = 90;            // a game folder touched this recently counts as busy
const MODEL = process.env.OFFICE_MODEL || "claude-opus-5-5";
const EFFORT = process.env.OFFICE_EFFORT || "high";

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
async function runJob(ref, job) {
  const team = TEAMS[job.team];
  const lock = lockKeyFor(job);
  locks.add(lock);
  const sessions = (await sessionsDoc.get()).data() || {};
  const resumeId = sessions[job.seatId];
  const sessionId = resumeId || randomUUID();

  // Game teams may only edit their own folder; shared roles may not edit any game.
  const editDeny = GAME_FOLDERS.filter((f) => f !== team.folder)
    .flatMap((f) => ["Edit", "Write"].map((t) => `${t}(/${f}/**)`));
  const settings = JSON.stringify({ permissions: { deny: editDeny } });
  const args = [
    "-p", job.command,
    "--output-format", "stream-json", "--verbose",
    "--model", MODEL, "--effort", EFFORT,
    "--permission-mode", "auto", "--permission-prompts", "none",
    "--append-system-prompt", rolePrompt(job, team),
    "--settings", settings
  ];
  // Folders outside ~/UnityProjects (Moe Family) must be added explicitly.
  for (const f of team.folder ? [team.folder] : GAME_FOLDERS) if (!f.startsWith(ROOT + path.sep)) args.push("--add-dir", f);
  if (resumeId) args.push("--resume", resumeId); else args.push("--session-id", sessionId);

  log("run", ref.id, job.title, short(job.command, 80), resumeId ? `(resume ${resumeId})` : "");
  await ref.update({ status: "running", startedAt: FieldValue.serverTimestamp(), note: FieldValue.delete(), sessionId, progress: [] });

  const child = spawn(CLAUDE, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, OFFICE_PARENT_JOB: ref.id, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || "/usr/bin:/bin"}` } });
  running.set(ref.id, { child, lock });

  let progress = [];
  let dirty = false;
  let result = null;
  let lastText = "";
  let stderr = "";
  let buf = "";
  const push = (text) => { progress.push({ t: Date.now(), text }); progress = progress.slice(-30); dirty = true; };
  const flush = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    ref.update({ progress }).catch((e) => log("progress write failed", e.message));
  }, 2500);
  const killer = setTimeout(() => { push("Quá 90 phút, dừng lại."); child.kill("SIGTERM"); }, JOB_TIMEOUT_MS);

  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === "assistant" && ev.message && Array.isArray(ev.message.content)) {
        for (const b of ev.message.content) {
          if (b.type === "text" && b.text.trim()) { lastText = b.text; push(short(b.text)); }
          if (b.type === "tool_use") push(describeTool(b));
        }
      } else if (ev.type === "result") {
        result = ev;
      }
    }
  });
  child.stderr.on("data", (d) => { stderr = (stderr + d).slice(-4000); });

  const code = await new Promise((resolve) => child.on("close", resolve));
  clearInterval(flush);
  clearTimeout(killer);
  running.delete(ref.id);
  locks.delete(lock);
  if (team.folder) lastOwnFinish.set(team.folder, Date.now());

  const cancelled = (await ref.get()).get("cancelRequested");
  const report = (result && typeof result.result === "string" && result.result.trim()) || lastText.trim();
  let status = "done";
  if (cancelled) status = "cancelled";
  else if (!result || result.is_error || (code !== 0 && !report)) status = "error";
  else if (/^\s*\**\s*CẦN XÁC NHẬN/i.test(report)) status = "needs_confirm";

  const update = {
    status, progress, finishedAt: FieldValue.serverTimestamp(),
    report: report || "", exitCode: code
  };
  if (result) {
    if (typeof result.total_cost_usd === "number") update.costUsd = result.total_cost_usd;
    if (result.num_turns) update.turns = result.num_turns;
    if (result.session_id) update.sessionId = result.session_id;
  }
  if (status === "error") update.error = short((result && result.subtype) || stderr || `exit ${code}`, 600);
  await ref.update(update);
  const sid = (result && result.session_id) || sessionId;
  if (status !== "error") await sessionsDoc.set({ [job.seatId]: sid }, { merge: true });
  log("finished", ref.id, status, code);
  schedule();
}

// ---------- delivering a command into claude.ai through Chrome ----------
// The page's command is posted, word for word, into the employee's thread (or the
// project chat for the CEO desk) by a small headless Claude using Claude in Chrome.
const DELIVER_TEMPLATE = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "deliver-prompt.md"), "utf8");
const CHROME_DEVICE = process.env.OFFICE_CHROME_DEVICE || "cd9e24d3-e70c-47e6-b029-7cc63d55d04a";
const DELIVER_MODEL = process.env.OFFICE_DELIVER_MODEL || "claude-sonnet-5-5";

async function runDelivery(ref, job) {
  locks.add("chrome");
  const isBoss = job.seatId === "boss";
  const url = isBoss ? PROJECT_URL : `${PROJECT_URL}?thread=${job.thread}`;
  const box = isBoss
    ? `the main project chat box on the left (placeholder like "Ask Claude a question or start a task..."), NOT any thread panel on the right`
    : `the reply box of the thread panel on the right side (placeholder like "Steer this thread..."), in the thread titled "${job.title}". NOT the main project chat box on the left`;
  const prompt = DELIVER_TEMPLATE.replaceAll("{{DEVICE}}", CHROME_DEVICE).replaceAll("{{URL}}", url)
    .replaceAll("{{BOX}}", box).replaceAll("{{MESSAGE}}", job.command);
  log("deliver", ref.id, job.title, short(job.command, 80));
  await ref.update({ status: "sending", startedAt: FieldValue.serverTimestamp(), note: FieldValue.delete(), progress: [], targetUrl: url });
  const args = ["-p", prompt, "--chrome", "--strict-mcp-config", "--model", DELIVER_MODEL,
    "--permission-mode", "auto", "--permission-prompts", "none", "--output-format", "stream-json", "--verbose", "--no-session-persistence"];
  const child = spawn(CLAUDE, args, { cwd: path.join(ROOT, "CatHeroOffice"), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || "/usr/bin:/bin"}` } });
  running.set(ref.id, { child, lock: "chrome" });
  let result = null, buf = "", stderr = "", progress = [], dirty = false;
  const flush = setInterval(() => { if (dirty) { dirty = false; ref.update({ progress }).catch(() => {}); } }, 2500);
  const killer = setTimeout(() => child.kill("SIGTERM"), 6 * 60 * 1000);
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === "assistant" && ev.message && Array.isArray(ev.message.content)) {
        for (const b of ev.message.content) if (b.type === "tool_use" && /navigate|computer|form_input|tabs_create/.test(b.name)) {
          const step = /navigate/.test(b.name) ? "Mở thread trong Chrome" : /tabs_create/.test(b.name) ? "Mở tab mới" : /form_input/.test(b.name) ? "Điền lệnh" : `Thao tác: ${(b.input && b.input.action_summary) || (b.input && b.input.action) || ""}`;
          progress.push({ t: Date.now(), text: short(step, 120) }); progress = progress.slice(-20); dirty = true;
        }
      } else if (ev.type === "result") result = ev;
    }
  });
  child.stderr.on("data", (d) => { stderr = (stderr + d).slice(-3000); });
  const code = await new Promise((resolve) => child.on("close", resolve));
  clearInterval(flush); clearTimeout(killer);
  running.delete(ref.id); locks.delete("chrome");
  const text = String((result && result.result) || "").trim();
  const ok = /^DELIVERED\b/.test(text);
  await ref.update({
    status: ok ? "sent" : "error", progress, finishedAt: FieldValue.serverTimestamp(),
    report: ok ? (isBoss ? "Đã gửi vào project chat trên claude.ai." : "Đã gửi vào thread trên claude.ai. Xem trả lời trong thread.") : "",
    ...(ok ? {} : { error: short(text.replace(/^FAILED:\s*/, "") || stderr || `exit ${code}`, 600) }),
    ...(result && typeof result.total_cost_usd === "number" ? { costUsd: result.total_cost_usd } : {})
  });
  log("delivered", ref.id, ok ? "ok" : "failed", short(text, 120));
  schedule();
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
      // Default path: post the command into claude.ai (one delivery at a time).
      if (data.mode !== "local") {
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
        const r = ((await db.collection("office").doc("roster").get()).data() || {});
        const threads = { ...JSON.parse(r.seedJson || "{}"), ...(r.threads || {}) };
        const thread = threads[data.seatId] || "";
        if (data.seatId !== "boss" && !thread) {
          await ref.update({ status: "error", error: "Bàn này chưa gắn thread claude.ai.", finishedAt: FieldValue.serverTimestamp() });
          continue;
        }
        runDelivery(ref, { ...data, thread }).catch(async (e) => {
          log("delivery crashed", ref.id, e);
          running.delete(ref.id); locks.delete("chrome");
          await ref.update({ status: "error", error: short(e.message, 600), finishedAt: FieldValue.serverTimestamp() }).catch(() => {});
        });
        continue;
      }
      const lock = lockKeyFor(data);
      let wait = null;
      if (running.size >= MAX_PARALLEL) wait = "Mac mini đang làm 2 việc khác, xếp hàng chờ";
      else if (locks.has(lock)) wait = "nhân viên cùng thư mục đang làm việc trước, xếp hàng chờ";
      else wait = await folderBusy(TEAMS[data.team].folder);
      if (wait) {
        if (data.status !== "waiting" || data.note !== wait) await ref.update({ status: "waiting", note: wait });
        continue;
      }
      // claim it (another worker instance must not take the same job)
      const ok = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || !["queued", "waiting"].includes(snap.get("status"))) return false;
        tx.update(ref, { status: "running", claimedBy: os.hostname() });
        return true;
      });
      if (!ok) continue;
      const seatThread = ((await db.collection("office").doc("roster").get()).data() || {});
      const threads = { ...JSON.parse(seatThread.seedJson || "{}"), ...(seatThread.threads || {}) };
      runJob(ref, { ...data, thread: threads[data.seatId] || "" }).catch(async (e) => {
        log("job crashed", ref.id, e);
        running.delete(ref.id);
        locks.delete(lock);
        await ref.update({ status: "error", error: short(e.message, 600), finishedAt: FieldValue.serverTimestamp() }).catch(() => {});
      });
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
log("worker started; model", MODEL, "effort", EFFORT);
