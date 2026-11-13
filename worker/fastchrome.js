// Fast, deterministic claude.ai driver for the office worker (no AI in the loop).
// Drives ONE warm tab in Phuong's own Chrome (already signed in) through
// AppleScript: point the tab at the thread link, type into the fixed composer,
// press Enter, confirm the "You said" row appeared. Reading replies reuses the tab.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "chrome.applescript");
const TAB_FILE = path.join(os.homedir(), ".config", "cathero-office", "warm-tab.json");
const SEL = {
  thread: '[data-testid="code-prompt-input"][aria-label="Write your reply to Claude"]',
  project: '[data-testid="code-prompt-input"][aria-label="Write your prompt to Claude"]'
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

function osa(...args) {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/osascript", [BRIDGE, ...args.map(String)], { timeout: 20000, maxBuffer: 4 << 20 }, (err, out, errOut) => {
      if (err) reject(new Error((String(errOut || "").trim() || String(err.message || err).split("\n")[0]).slice(0, 300)));
      else resolve(String(out).replace(/\n$/, ""));
    });
  });
}

let tabId = null;
try { tabId = JSON.parse(fs.readFileSync(TAB_FILE, "utf8")).tabId; } catch { /* none yet */ }

async function warmTab(url) {
  if (tabId && (await osa("exists", tabId).catch(() => "NOTAB")) === "OK") return { id: tabId, created: false };
  tabId = Number(await osa("new", url));
  try { fs.mkdirSync(path.dirname(TAB_FILE), { recursive: true }); fs.writeFileSync(TAB_FILE, JSON.stringify({ tabId })); } catch { /* ignore */ }
  return { id: tabId, created: true };
}

async function js(code) {
  const out = await osa("js", tabId, code);
  try { return JSON.parse(out); } catch { return out; }
}

// Point the tab at `url` (no reload if already there) and wait for the composer.
async function goReady(url, which, timeoutMs = 20000) {
  const { created } = await warmTab(url);
  if (!created) {
    const [cur] = (await osa("state", tabId)).split("|");
    if (cur !== url) await osa("go", tabId, url);
  }
  const t = Date.now();
  while (Date.now() - t < timeoutMs) {
    const st = await js(`JSON.stringify({ ok: !!document.querySelector(${JSON.stringify(SEL[which])}), login: /\\/login|challenge/.test(location.href) })`).catch(() => null);
    if (st && st.login) throw new Error("Chrome chưa đăng nhập claude.ai");
    if (st && st.ok) return;
    await sleep(120);
  }
  throw new Error("Không thấy ô chat trên trang");
}

function rowsCode(which) {
  return `JSON.stringify((() => {
    const feeds = [...document.querySelectorAll('[role=feed]')].map(f => ({ f, x: f.getBoundingClientRect().x })).sort((a, b) => a.x - b.x);
    if (!feeds.length) return { rows: [], working: false };
    const feed = (${JSON.stringify(which)} === "thread" ? feeds[feeds.length - 1] : feeds[0]).f;
    const rows = [...feed.querySelectorAll('[data-testid=transcript-row]')].map(r => ({ h: ((r.querySelector('h3') || {}).textContent || ""), text: r.innerText || "" }));
    return { rows, working: !!feed.querySelector('[data-working-row]') };
  })())`;
}

function clean(row) {
  let t = row.text.replace(/^New\n/, "");
  if (row.h && t.startsWith(row.h)) t = t.slice(row.h.length);
  t = t.replace(/\n+\s*(now|just now|\d+\s*[smhd]\s*ago|\d+\s*(minutes?|hours?|days?)\s*ago)\s*\n[\s\S]*$/i, "");
  t = t.replace(/\n+\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),[^\n]*$/i, "");
  return t.trim();
}

export async function send({ url, which, message }) {
  const t0 = Date.now();
  await goReady(url, which);
  const tReady = Date.now();
  const head = norm(message).slice(0, 40);
  // Type with the editor's own input pipeline, check it, then press Enter.
  const res = await js(`JSON.stringify((() => {
    const ed = document.querySelector(${JSON.stringify(SEL[which])});
    if (!ed) return { err: "no composer" };
    ed.focus();
    const sel = window.getSelection(); sel.selectAllChildren(ed); sel.collapseToEnd();
    if (ed.innerText.trim()) return { err: "ô chat đang có chữ sẵn, chưa gửi" };
    const lines = ${JSON.stringify(String(message))}.split("\\n");
    lines.forEach((line, i) => {
      if (line) document.execCommand("insertText", false, line);
      if (i < lines.length - 1) ed.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
    });
    const typed = ed.innerText.replace(/\\s+/g, " ").trim();
    const want = ${JSON.stringify(norm(message))};
    if (typed !== want) { document.execCommand("selectAll"); document.execCommand("delete"); return { err: "ô chat không nhận đúng nội dung, chưa gửi", typed }; }
    return { ok: true };
  })())`);
  if (!res || !res.ok) throw new Error((res && res.err) || "không gửi được");
  // React shows the Send button a moment after the text lands; click the one by this composer.
  let clicked = false;
  for (let i = 0; i < 15 && !clicked; i++) {
    await sleep(80);
    clicked = (await js(`(() => {
      const ed = document.querySelector(${JSON.stringify(SEL[which])});
      const er = ed.getBoundingClientRect();
      const o = [...document.querySelectorAll('button[aria-label="Send"]')]
        .map(b => ({ b, r: b.getBoundingClientRect() }))
        .filter(o => o.r.width && !o.b.disabled && o.r.x >= er.x - 20 && o.r.x <= er.right + 80)
        .sort((a, b) => Math.abs(a.r.y - er.y) - Math.abs(b.r.y - er.y))[0];
      if (!o) return "no";
      o.b.click();
      return "yes";
    })()`)) === "yes";
  }
  if (!clicked) {
    await js(`(() => { const ed = document.querySelector(${JSON.stringify(SEL[which])}); ed.focus(); document.execCommand("selectAll"); document.execCommand("delete"); return 1; })()`);
    throw new Error("không bấm được nút Send, chưa gửi");
  }
  const tSent = Date.now();
  let ok = false;
  for (let i = 0; i < 50 && !ok; i++) {
    await sleep(120);
    const now = await js(rowsCode(which)).catch(() => null);
    ok = !!now && now.rows.slice(-4).some((r) => /^You said/i.test(r.h) && norm(r.text).includes(head));
  }
  return { ok, timing: { loadMs: tReady - t0, typeMs: tSent - tReady, confirmMs: Date.now() - tSent, totalMs: Date.now() - t0 } };
}

export async function readReplies({ url, which, since }) {
  await goReady(url, which);
  const t = Date.now();
  let data = null;
  while (Date.now() - t < 8000) {
    data = await js(rowsCode(which)).catch(() => null);
    if (data && data.rows.length) break;
    await sleep(200);
  }
  if (!data) return { state: "none", text: "" };
  const head = norm(since).slice(0, 40);
  let idx = -1;
  data.rows.forEach((r, i) => { if (/^You said/i.test(r.h) && norm(r.text).includes(head)) idx = i; });
  if (idx < 0) return { state: "none", text: "", found: false };
  const after = data.rows.slice(idx + 1);
  // Only real messages (rows with a heading); heading-less rows are the live
  // "working" status line, which means the employee is still busy.
  const replies = after.filter((r) => r.h && !/^You said/i.test(r.h)).map(clean).filter(Boolean);
  const busy = data.working || after.some((r) => !r.h && r.text.trim());
  if (!replies.length) return { state: busy ? "working" : "none", text: "", found: true };
  return { state: busy ? "working" : "done", text: replies.join("\n\n").slice(0, 12000), found: true };
}

export async function closeTab() {
  if (tabId) await osa("close", tabId).catch(() => {});
  tabId = null;
  try { fs.unlinkSync(TAB_FILE); } catch { /* ignore */ }
}

// Startup check that this process may control Chrome (macOS Automation permission).
export async function probe() {
  try { return await osa("exists", 1); } catch (e) { return "ERROR " + e.message; }
}
