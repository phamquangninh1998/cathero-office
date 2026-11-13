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
// In-page navigation: claude.ai is a single-page app. After the first load we
// switch threads by clicking rows in its Threads list, so the tab never reloads.
const PROJECT_RE = /^https:\/\/claude\.ai\/code\/project\/[^/?#]+/;

async function ensureProject(url) {
  const base = (url.match(PROJECT_RE) || [url])[0];
  const { created } = await warmTab(base);
  if (!created) {
    const [cur] = (await osa("state", tabId)).split("|");
    if (!cur.startsWith(base)) await osa("go", tabId, base);
  }
  const t = Date.now();
  while (Date.now() - t < 20000) {
    const st = await js(`JSON.stringify({ ok: !!document.querySelector('[data-testid="code-prompt-input"]'), login: /\\/login|challenge/.test(location.href) })`).catch(() => null);
    if (st && st.login) throw new Error("Chrome chưa đăng nhập claude.ai");
    if (st && st.ok) return;
    await sleep(150);
  }
  throw new Error("Không mở được trang project");
}

// Show the Threads list in the right panel (click, no reload).
async function showOverview() {
  for (let i = 0; i < 25; i++) {
    const r = await js(`(() => {
      if (document.querySelector('[data-testid=overview-thread-row]')) return "ok";
      const cands = [...document.querySelectorAll('[aria-label]')].filter(b => /^Threads/.test(b.getAttribute('aria-label')) && b.getBoundingClientRect().y < 40);
      const b = cands.find(b => b.getAttribute('aria-label') === 'Threads') || cands[0];
      if (!b) return "none";
      b.click(); return "clicked";
    })()`).catch(() => "none");
    if (r === "ok") return true;
    await sleep(200);
  }
  return false;
}

async function openThreadInPlace(url) {
  const id = (url.match(/thread=(cmsg_[A-Za-z0-9]+)/) || [])[1];
  await ensureProject(url);
  if (!id) return;
  const here = async () => (await js(`location.href.includes(${JSON.stringify(id)}) && !!document.querySelector(${JSON.stringify(SEL.thread)}) ? "yes" : "no"`).catch(() => "no")) === "yes";
  if (await here()) return;
  if (await showOverview()) {
    for (let i = 0; i < 3; i++) {
      const r = await js(`(() => {
        [...document.querySelectorAll('section button')].filter(b => /^Show more$/i.test((b.innerText || "").trim())).forEach(b => b.click());
        const row = document.querySelector('[data-testid=overview-thread-row][data-home-card=${JSON.stringify(id)}]');
        if (!row) return "missing";
        (row.querySelector('a,button,[role=button]') || row).click();
        return "clicked";
      })()`).catch(() => "missing");
      if (r === "clicked") {
        for (let k = 0; k < 40; k++) { if (await here()) return; await sleep(120); }
      }
      await sleep(250);
    }
  }
  // Not in the list (e.g. resolved): fall back to the link (one reload).
  await osa("go", tabId, url);
  for (let k = 0; k < 120; k++) { if (await here()) return; await sleep(150); }
  throw new Error("Không mở được thread");
}

async function goReady(url, which) {
  if (which === "thread") await openThreadInPlace(url);
  else await ensureProject(url);
  for (let k = 0; k < 60; k++) {
    if ((await js(`document.querySelector(${JSON.stringify(SEL[which])}) ? "y" : "n"`).catch(() => "n")) === "y") return;
    await sleep(150);
  }
  throw new Error("Không thấy ô chat trên trang");
}

function rowsCode(which) {
  return `JSON.stringify((() => {
    const feeds = [...document.querySelectorAll('[role=feed]')].map(f => ({ f, x: f.getBoundingClientRect().x })).sort((a, b) => a.x - b.x);
    if (!feeds.length) return { rows: [], working: false };
    const pick = ${JSON.stringify(which)} === "thread" ? feeds.filter(o => o.x > window.innerWidth * 0.45).pop() : feeds[0];
    if (!pick) return { rows: [], working: false };
    const feed = pick.f;
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

// Whole conversation in a panel, as {who, text, at, card} rows, plus "working".
// `who` is "you" for Phuong's messages and "claude" for replies. `card` is the
// thread title when the coordinator handed the work to a thread.
function convoCode(which) {
  return `JSON.stringify((() => {
    const feeds = [...document.querySelectorAll('[role=feed]')].map(f => ({ f, x: f.getBoundingClientRect().x })).sort((a, b) => a.x - b.x);
    if (!feeds.length) return { rows: [], working: false };
    const pick = ${JSON.stringify(which)} === "thread" ? feeds.filter(o => o.x > window.innerWidth * 0.45).pop() : feeds[0];
    if (!pick) return { rows: [], working: false };
    const feed = pick.f;
    const rows = [...feed.querySelectorAll('[data-testid=transcript-row]')].map(r => {
      const h = ((r.querySelector('h3') || {}).textContent || "");
      const time = r.querySelector('time[datetime]');
      const body = r.querySelector('[data-cds=Prose]') || r.querySelector('[data-testid=user-message]');
      const txt = r.innerText || "";
      const ci = txt.indexOf("Thread details and actions");
      return { h, at: time ? time.getAttribute('datetime') : "", body: body ? body.innerText : "", text: txt, card: ci > 0 ? txt.slice(0, ci).trim().split("\\n").pop() : "" };
    });
    return { rows, working: !!feed.querySelector('[data-working-row]') };
  })())`;
}

export async function readConversation({ url, which }) {
  await goReady(url, which);
  const t = Date.now();
  let data = null;
  while (Date.now() - t < 8000) {
    data = await js(convoCode(which)).catch(() => null);
    if (data && data.rows.length) break;
    await sleep(200);
  }
  if (!data) return { rows: [], working: false };
  const rows = [];
  let busy = data.working;
  data.rows.forEach((r, i) => {
    if (!r.h) { if (r.text.trim() && i >= data.rows.length - 2) busy = true; return; }
    const who = /^You said/i.test(r.h) ? "you" : "claude";
    const text = (r.body || clean(r)).trim();
    rows.push({ who, text, at: r.at, card: r.card });
  });
  return { rows, working: busy };
}

// Project overview (the "Threads" list): one entry per thread with its state.
const OVERVIEW_CODE = `JSON.stringify((() => {
  // Expand collapsed sections ("Show more") so every thread row is rendered.
  [...document.querySelectorAll('section button')].filter(b => /^Show more$/i.test((b.innerText || "").trim())).forEach(b => b.click());
  return [...document.querySelectorAll('[data-testid=overview-thread-row]')].map(r => {
    const leaves = [...r.querySelectorAll('*')].filter(e => !e.children.length && e.textContent.trim()).map(e => e.textContent.trim());
    const sec = r.closest('section');
    const head = sec ? ((sec.querySelector('h1,h2,h3,h4,[role=heading]') || {}).textContent || "") : "";
    return { id: r.getAttribute('data-home-card') || "", leaves, section: head.replace(/[·\\d\\s]+$/, "").trim() };
  });
})())`;
const STATE_RE = /^(Needs attention|Working|Idle|Done|Review ready|Blocked|Failed|Stopped|Waiting)/i;
function parseOverviewRow(r) {
  const leaves = r.leaves.map((x) => x.replace(/[\u200b-\u200f\ufeff]/g, "").trim()).filter(Boolean);
  const unread = leaves.includes("Unread");
  const rest = leaves.filter((x) => x !== "Unread");
  const si = rest.findIndex((x) => STATE_RE.test(x));
  let ti = rest.findIndex((x) => x.includes("·"));
  if (ti < 0) ti = Math.max(0, rest.findIndex((x) => /\p{L}{2,}/u.test(x)));
  return { id: r.id, section: r.section || "", title: rest[ti] || "", summary: rest.slice(ti + 1, si > ti ? si : ti + 2).join(" ").trim(), state: si >= 0 ? rest[si] : "", ago: si >= 0 ? (rest[si + 1] || "") : "", unread };
}

export async function readOverview(projectUrl) {
  await ensureProject(projectUrl);
  await showOverview();
  const t = Date.now();
  let clicked = false;
  while (Date.now() - t < 12000) {
    const rows = await js(OVERVIEW_CODE).catch(() => null);
    if (Array.isArray(rows) && rows.length) {
      await sleep(250);
      const expanded = await js(OVERVIEW_CODE).catch(() => rows);
      const seen = new Map([...rows, ...(expanded || [])].map((r) => [r.id, r]));
      for (let step = 0; step < 12; step++) {
        const moved = await js(`(() => {
          const row = document.querySelector('[data-testid=overview-thread-row]');
          let el = row && row.parentElement;
          while (el && !(el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
          if (!el) return "end";
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) { el.scrollTop = 0; return "end"; }
          el.scrollTop += Math.max(200, el.clientHeight - 80);
          return "moved";
        })()`).catch(() => "end");
        if (moved !== "moved") break;
        await sleep(120);
        const more = await js(OVERVIEW_CODE).catch(() => []);
        for (const r of more || []) seen.set(r.id, r);
      }
      return [...seen.values()].map(parseOverviewRow);
    }
    if (!clicked && Date.now() - t > 1500) {
      // Open the Threads overview panel from the project header.
      const r = await js(`(() => { const b = [...document.querySelectorAll('[aria-label]')].find(b => /^Threads/.test(b.getAttribute('aria-label')) && b.getBoundingClientRect().y < 40 && b.getBoundingClientRect().x < window.innerWidth * 0.75); if (!b) return "no"; b.click(); return "yes"; })()`).catch(() => "no");
      clicked = r === "yes";
    }
    await sleep(250);
  }
  return [];
}

// Full text of the newest reply in a thread (what the employee is asking).
export async function latestReply(url) {
  await openThreadInPlace(url);
  for (let k = 0; k < 30; k++) {
    const out = await js(`JSON.stringify((() => {
      // Only the thread panel on the right, never the project chat on the left.
      const feed = [...document.querySelectorAll('[role=feed]')].find(f => f.getBoundingClientRect().x > window.innerWidth * 0.45);
      if (!feed) return null;
      const rows = [...feed.querySelectorAll('[data-testid=transcript-row]')].filter(r => /^Claude responded/i.test((r.querySelector('h3') || {}).textContent || ""));
      const last = rows[rows.length - 1];
      if (!last) return null;
      const body = last.querySelector('[data-cds=Prose]');
      const t = last.querySelector('time[datetime]');
      return { text: (body ? body.innerText : last.innerText).trim().slice(0, 4000), at: t ? t.getAttribute('datetime') : "" };
    })())`).catch(() => null);
    if (out && out.text) return out;
    await sleep(200);
  }
  return null;
}

export async function backToOverview() { await showOverview(); }
