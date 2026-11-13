// api: { threads, history, saveThread(id, threadId|null), saveHistory(key, list) } from auth.js
window.OfficeApp = { start: function (api) {
  const D = window.OFFICE_DATA;
  const A = window.OfficeArt;
  const $ = (sel, root) => (root || document).querySelector(sel);

  // ---------- storage (per-browser conveniences only) ----------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("cho." + key); return v ? JSON.parse(v) : fallback; }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("cho." + key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- links ----------
  function threadUrl(threadId) { return `${D.projectUrl}?thread=${encodeURIComponent(threadId)}`; }

  // Accept a full claude.ai link or a bare cmsg id; return the thread id or null.
  function parseThread(input) {
    const s = (input || "").trim();
    if (!s) return null;
    const m = s.match(/cmsg_[A-Za-z0-9]+/);
    return m ? m[0] : null;
  }

  // ---------- model ----------
  const overrides = api.threads; // seatId -> threadId (synced in Firestore)
  const seats = {};

  function buildModel() {
    D.teams.forEach((team) => {
      team.seats.forEach((seat) => {
        const id = `${team.id}-${seat.role}`;
        const role = D.roles[seat.role];
        const thread = overrides[id] || "";
        seats[id] = {
          id, team, roleKey: seat.role, role,
          title: `${role.label} · ${team.name}`,
          thread,
          look: A.lookFor(id, role)
        };
      });
    });
  }

  // ---------- render ----------
  function seatButton(s) {
    const hired = !!s.thread;
    return `<button class="seat ${hired ? "hired" : "hiring"}" data-seat="${s.id}" aria-label="${esc(s.title)}${hired ? "" : " (đang tuyển)"}">
      <span class="bubble" data-bubble="${s.id}" hidden></span>
      <div class="seat-art">${A.seatSVG({ look: s.look, prop: s.role.prop, hired })}</div>
      <div class="seat-label">
        <span class="role">${esc(s.role.label)}</span>
        <span class="pill ${hired ? "on" : "off"}">${hired ? "Có thread" : "Đang tuyển"}</span>
      </div>
    </button>`;
  }

  function zone(team) {
    const list = team.seats.map((x) => seats[`${team.id}-${x.role}`]);
    return `<section class="zone ${team.shared ? "shared" : ""}" style="--zc:${team.color}" data-zone="${team.id}">
      <header class="zone-sign">
        <span class="zone-icon">${A.ICONS[team.icon] || ""}</span>
        <span class="zone-text"><b>${esc(team.name)} · ${esc(team.game)}</b><small>${esc(team.project)}</small></span>
      </header>
      <div class="desks">${list.map(seatButton).join("")}</div>
    </section>`;
  }

  function bossArea() {
    const b = D.boss;
    return `<section class="boss-area">
      <div class="boss-rug"></div>
      <div class="plant plant-l">${A.plantSVG(0)}</div>
      <div class="plant plant-r">${A.plantSVG(1)}</div>
      <button class="seat boss" data-seat="boss" aria-label="${esc(b.name)} · ${esc(b.title)}">
        <div class="seat-art">${A.seatSVG({ look: b.look, hired: true, boss: true, prop: "", label: b.title })}</div>
        <div class="cat">${A.catSVG()}</div>
        <div class="seat-label boss-label"><span class="role">${esc(b.name)}</span><span class="pill gold">Bàn giám đốc</span></div>
      </button>
      <p class="boss-hint">Bấm vào bàn mình để nhắn điều phối</p>
    </section>`;
  }

  function render() {
    const byId = Object.fromEntries(D.teams.map((t) => [t.id, t]));
    const floor = $("#floor");
    floor.innerHTML =
      `<div class="area a-b1">${zone(byId.b1)}</div>
       <div class="area a-b2">${zone(byId.b2)}</div>
       <div class="area a-boss">${bossArea()}</div>
       <div class="area a-b3">${zone(byId.b3)}</div>
       <div class="area a-b4">${zone(byId.b4)}</div>
       <div class="area a-chung">${zone(byId.chung)}</div>`;

    const all = Object.values(seats);
    const hired = all.filter((s) => s.thread).length;
    $("#stat-staff").textContent = hired;
    $("#stat-open").textContent = all.length - hired;
    $("#brand-name").textContent = D.studio;
    renderBubbles();
  }

  // ---------- panel ----------
  let current = null; // { kind: "seat"|"boss", seat? }

  function targetFor(cur) {
    if (cur.kind === "boss") return { url: D.projectUrl, label: "project chat (điều phối)" };
    if (cur.seat.thread) return { url: threadUrl(cur.seat.thread), label: `thread “${cur.seat.title}”` };
    return { url: D.projectUrl, label: "project chat (điều phối) để tuyển" };
  }

  function templatesFor(cur) {
    if (cur.kind === "boss") {
      return [
        "Tạo thread mới: ",
        "Báo cáo tình hình cả studio hôm nay.",
        "Ai đang bị kẹt và cần mình quyết định gì?"
      ];
    }
    const s = cur.seat;
    if (!s.thread) {
      return [
        `Tuyển nhân viên mới: tạo thread “${s.role.label} · ${s.team.name}” (${s.team.game}${s.team.shared ? "" : ", " + s.team.project}). Việc đầu tiên: `,
        `Tuyển “${s.role.label} · ${s.team.name}” và giao việc: ${s.role.desc.toLowerCase()}`
      ];
    }
    return D.common.concat(s.role.templates);
  }

  function openPanel(cur) {
    current = cur;
    const panel = $("#panel");
    const isBoss = cur.kind === "boss";
    const s = cur.seat;
    const hired = isBoss || !!s.thread;

    $("#p-avatar").innerHTML = isBoss
      ? A.seatSVG({ look: D.boss.look, hired: true, boss: true, label: D.boss.title })
      : A.seatSVG({ look: s.look, prop: s.role.prop, hired });
    $("#p-title").textContent = isBoss ? `${D.boss.name} · ${D.boss.title}` : s.title;
    $("#p-sub").textContent = isBoss ? "Gửi lệnh cho điều phối trong project chat"
      : `${s.team.name} · ${s.team.game}${s.team.shared ? "" : " · " + s.team.project}`;
    $("#p-desc").textContent = isBoss
      ? "Điều phối là Claude trong project chat: tạo thread mới, chia việc, tổng hợp báo cáo."
      : s.role.desc;

    const badge = $("#p-badge");
    badge.textContent = isBoss ? "Giám đốc" : (hired ? "Có thread" : "Đang tuyển");
    badge.className = "pill " + (isBoss ? "gold" : hired ? "on" : "off");

    const target = targetFor(cur);
    const open = $("#p-open");
    open.href = target.url;
    open.textContent = isBoss ? "Mở project chat ↗" : hired ? "Mở thread ↗" : "Mở project chat ↗";
    $("#p-target").textContent = target.label;
    const direct = canRunJob(cur);
    panel.classList.toggle("direct", direct);
    $("#p-send").firstChild.textContent = direct ? "Giao việc " : "Copy & mở ";

    $("#p-chips").innerHTML = templatesFor(cur)
      .map((t, i) => `<button class="chip" data-i="${i}">${esc(t.replace(/[: ]+$/, ""))}${/[: ]$/.test(t) ? "…" : ""}</button>`)
      .join("");

    const draftKey = isBoss ? "boss" : s.id;
    const drafts = store.get("drafts", {});
    $("#p-cmd").value = drafts[draftKey] || "";

    // link settings (seats only)
    const linkBox = $("#p-link");
    linkBox.hidden = isBoss;
    if (!isBoss) {
      $("#p-link-input").value = s.thread ? threadUrl(s.thread) : "";
      $("#p-link-summary").textContent = s.thread ? "Đổi link thread" : "Đã tạo thread? Gắn link vào bàn này";
    }

    renderHistory();
    renderPanelJobs();
    markSeen(cur);
    document.body.classList.add("panel-open");
    panel.setAttribute("aria-hidden", "false");
    setTimeout(() => $("#p-cmd").focus(), 220);
  }

  function closePanel() {
    document.body.classList.remove("panel-open");
    $("#panel").setAttribute("aria-hidden", "true");
    current = null;
  }

  function historyKey() { return current.kind === "boss" ? "boss" : current.seat.id; }

  function renderHistory() {
    const all = api.history;
    const list = (all[historyKey()] || []).slice(0, 6);
    const box = $("#p-history");
    box.hidden = list.length === 0;
    $("#p-history-list").innerHTML = list
      .map((h, i) => `<li><button class="hist" data-i="${i}"><span>${esc(h.text)}</span><time>${esc(fmtTime(h.at))}</time></button></li>`)
      .join("");
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    return d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through */ }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  async function send() {
    if (!current) return;
    const text = $("#p-cmd").value.trim();
    if (!text) { shake($("#p-cmd")); $("#p-cmd").focus(); return; }
    if (canRunJob(current)) return sendJob(text);
    const target = targetFor(current);
    const ok = await copyText(text);

    const all = api.history;
    const key = historyKey();
    all[key] = [{ text, at: Date.now() }].concat((all[key] || []).filter((h) => h.text !== text)).slice(0, 12);
    api.saveHistory(key, all[key]).catch((e) => toast("Không lưu được lịch sử: " + e.message));
    const drafts = store.get("drafts", {});
    delete drafts[key];
    store.set("drafts", drafts);

    window.open(target.url, "_blank", "noopener");
    toast(ok
      ? `Đã copy lệnh. Trong tab vừa mở, bấm vào ô chat, dán (⌘V) rồi Enter.`
      : `Không copy được tự động. Hãy chọn chữ trong ô lệnh và copy tay.`);
    renderHistory();
  }

  function saveLink() {
    const s = current && current.seat;
    if (!s) return;
    const raw = $("#p-link-input").value;
    const id = parseThread(raw);
    if (raw.trim() && !id) { toast("Link chưa đúng: cần có đoạn “cmsg_…” của thread."); shake($("#p-link-input")); return; }
    if (id) overrides[s.id] = id; else delete overrides[s.id];
    s.thread = id || "";
    api.saveThread(s.id, id || null)
      .then(() => rerenderKeepPanel(s.id, id ? "Đã gắn thread vào bàn này." : "Đã gỡ thread, bàn này chuyển sang đang tuyển."))
      .catch((e) => toast("Không lưu được: " + e.message));
  }

  function rerenderKeepPanel(seatId, msg) {
    render();
    openPanel({ kind: "seat", seat: seats[seatId] });
    const el = document.querySelector(`[data-seat="${seatId}"]`);
    if (el) { el.classList.add("pop"); setTimeout(() => el.classList.remove("pop"), 700); }
    toast(msg);
  }

  // ---------- small UI helpers ----------
  let toastTimer = null;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 4200);
  }
  function shake(el) { el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); }

  function tickClock() {
    const d = new Date();
    $("#clock").textContent = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
    const h = d.getHours();
    document.body.classList.toggle("night", h < 6 || h >= 18);
  }

  // ---------- events ----------
  function wire() {
    document.addEventListener("click", (e) => {
      const seatEl = e.target.closest("[data-seat]");
      if (seatEl) {
        const id = seatEl.getAttribute("data-seat");
        openPanel(id === "boss" ? { kind: "boss" } : { kind: "seat", seat: seats[id] });
        return;
      }
      const chip = e.target.closest(".chip");
      if (chip && current) {
        const t = templatesFor(current)[+chip.dataset.i];
        const box = $("#p-cmd");
        box.value = t;
        box.focus();
        box.setSelectionRange(t.length, t.length);
        saveDraft();
        return;
      }
      const hist = e.target.closest(".hist");
      if (hist && current) {
        const all = api.history;
        const h = (all[historyKey()] || [])[+hist.dataset.i];
        if (h) { $("#p-cmd").value = h.text; $("#p-cmd").focus(); saveDraft(); }
      }
    });

    $("#scrim").addEventListener("click", closePanel);
    $("#p-close").addEventListener("click", closePanel);
    $("#p-send").addEventListener("click", send);
    $("#p-link-save").addEventListener("click", saveLink);
    $("#btn-coordinator").addEventListener("click", () => openPanel({ kind: "boss" }));
    $("#p-cmd").addEventListener("input", saveDraft);
    $("#p-cmd").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && current) closePanel(); });
  }

  function saveDraft() {
    if (!current) return;
    const drafts = store.get("drafts", {});
    const v = $("#p-cmd").value;
    if (v.trim()) drafts[historyKey()] = v; else delete drafts[historyKey()];
    store.set("drafts", drafts);
  }


  // ---------- jobs: commands run by the Mac mini worker ----------
  // Hired seats get a direct "Giao việc": the command goes into the Firestore
  // queue, the worker on the Mac runs it and writes progress + a report back.
  let jobs = [];
  let worker = null;
  const STATUS = {
    queued: ["Đang chờ máy nhận", "wait"],
    waiting: ["Chờ thư mục rảnh", "wait"],
    running: ["Đang làm", "run"],
    done: ["Xong", "ok"],
    needs_confirm: ["Cần bạn xác nhận", "ask"],
    error: ["Lỗi", "err"],
    cancelled: ["Đã huỷ", "off"]
  };
  const ACTIVE = ["queued", "waiting", "running"];

  function canRunJob(cur) { return cur.kind === "seat" && !!cur.seat.thread; }

  function tsMs(t) { return t ? (t.toMillis ? t.toMillis() : +t) : Date.now(); }

  async function sendJob(text) {
    const s = current.seat;
    const btn = $("#p-send");
    btn.disabled = true;
    try {
      await api.createJob({ seatId: s.id, title: s.title, role: s.roleKey, team: s.team.id, command: text });
      const all = api.history;
      all[s.id] = [{ text, at: Date.now() }].concat((all[s.id] || []).filter((h) => h.text !== text)).slice(0, 12);
      api.saveHistory(s.id, all[s.id]).catch(() => {});
      const drafts = store.get("drafts", {}); delete drafts[s.id]; store.set("drafts", drafts);
      $("#p-cmd").value = "";
      renderHistory();
      toast(workerOnline() ? "Đã giao việc. Báo cáo sẽ hiện ngay trong bảng này." : "Đã xếp hàng. Mac mini đang offline, máy bật lại sẽ tự làm.");
    } catch (e) {
      toast("Không gửi được: " + (e.code || e.message));
    } finally {
      btn.disabled = false;
    }
  }

  function workerOnline() {
    return !!(worker && worker.lastSeen && Date.now() - tsMs(worker.lastSeen) < 150000);
  }

  function renderWorker() {
    const chip = $("#worker-chip");
    if (!chip) return;
    const on = workerOnline();
    const busy = jobs.filter((j) => j.status === "running").length;
    chip.className = "stat worker " + (on ? "on" : "off");
    chip.innerHTML = `<i></i>${on ? (busy ? `Mac mini đang làm ${busy} việc` : "Mac mini sẵn sàng") : "Mac mini offline"}`;
  }

  function seatJobs(seatId) { return jobs.filter((j) => j.seatId === seatId); }

  function seenKey(seatId) { return "seen." + seatId; }
  function markSeen(cur) {
    if (cur.kind !== "seat") return;
    const latest = seatJobs(cur.seat.id)[0];
    if (latest && latest.finishedAt) store.set(seenKey(cur.seat.id), tsMs(latest.finishedAt));
    renderBubbles();
  }

  function renderBubbles() {
    document.querySelectorAll("[data-bubble]").forEach((el) => {
      const id = el.getAttribute("data-bubble");
      const list = seatJobs(id);
      const active = list.find((j) => ACTIVE.includes(j.status));
      const latest = list[0];
      let kind = "", label = "";
      if (active) {
        kind = active.status === "running" ? "run" : "wait";
        label = active.status === "running" ? "" : "⏳";
      } else if (latest && latest.finishedAt && tsMs(latest.finishedAt) > store.get(seenKey(id), 0)) {
        const k = (STATUS[latest.status] || [])[1];
        kind = k === "ok" ? "ok" : k === "ask" ? "ask" : k === "err" ? "err" : "";
        label = kind === "ok" ? "✓" : kind === "ask" ? "?" : kind === "err" ? "!" : "";
      }
      el.hidden = !kind;
      el.className = "bubble " + kind;
      el.innerHTML = kind === "run" ? "<i></i><i></i><i></i>" : label;
      el.title = kind ? (active ? STATUS[active.status][0] : STATUS[latest.status][0]) : "";
    });
  }

  // Tiny, safe markdown: escape first, then bold/code/links/lists/headings.
  function md(src) {
    const lines = esc(src || "").split("\n");
    let html = "", inList = false;
    const inline = (t) => t
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    let table = null;
    const endTable = () => { if (table) { html += `<div class="j-table"><table>${table.join("")}</table></div>`; table = null; } };
    for (const raw of lines) {
      if (/^\s*\|.*\|\s*$/.test(raw)) {
        if (inList) { html += "</ul>"; inList = false; }
        if (/^\s*\|[\s:|-]+\|\s*$/.test(raw)) continue;
        const cells = raw.trim().slice(1, -1).split("|").map((c) => inline(c.trim()));
        const tag = table ? "td" : "th";
        table = table || [];
        table.push(`<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`);
        continue;
      }
      endTable();
      const li = raw.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
      if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
      if (inList) { html += "</ul>"; inList = false; }
      const h = raw.match(/^#{1,4}\s+(.*)$/);
      if (h) html += `<h4>${inline(h[1])}</h4>`;
      else if (raw.trim()) html += `<p>${inline(raw)}</p>`;
    }
    if (inList) html += "</ul>";
    endTable();
    return html;
  }

  function ago(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return `${s} giây trước`;
    if (s < 3600) return `${Math.round(s / 60)} phút trước`;
    return fmtTime(ms);
  }

  function dur(a, b) {
    const s = Math.round((tsMs(b) - tsMs(a)) / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  }

  function jobCard(j, open) {
    const [label, kind] = STATUS[j.status] || [j.status, "off"];
    const active = ACTIVE.includes(j.status);
    const progress = (j.progress || []).slice(-5);
    let body = "";
    if (j.status === "waiting" && j.note) body += `<p class="j-note">${esc(j.note)}</p>`;
    if (j.status === "running") {
      body += progress.length
        ? `<ul class="j-progress">${progress.map((p) => `<li>${esc(p.text)}</li>`).join("")}</ul>`
        : `<p class="j-note">Đang khởi động…</p>`;
    }
    if (j.report) body += `<div class="j-report">${md(j.report)}</div>`;
    if (j.status === "error" && j.error) body += `<p class="j-note err">${esc(j.error)}</p>`;
    const when = j.finishedAt ? `${ago(tsMs(j.finishedAt))} · ${dur(j.startedAt || j.createdAt, j.finishedAt)}`
      : j.startedAt ? `bắt đầu ${ago(tsMs(j.startedAt))}` : ago(tsMs(j.createdAt));
    return `<li class="job ${kind}">
      <details ${open ? "open" : ""}>
        <summary>
          <span class="j-chip ${kind}">${kind === "run" ? '<i class="spin"></i>' : ""}${label}</span>
          <span class="j-cmd">${esc(j.command)}</span>
          <time>${esc(when)}</time>
        </summary>
        <div class="j-body">${body}
          ${active ? `<button class="btn small ghost j-cancel" data-job="${j.id}">Huỷ việc này</button>` : ""}
        </div>
      </details>
    </li>`;
  }

  function renderPanelJobs() {
    const box = $("#p-jobs");
    if (!current || !canRunJob(current)) { box.hidden = true; return; }
    const list = seatJobs(current.seat.id).slice(0, 6);
    box.hidden = list.length === 0;
    // keep the user's open/closed choice across live updates
    const openIds = new Set([...box.querySelectorAll("details[open]")].map((d) => d.closest(".job").dataset.id));
    const firstRender = !box.dataset.seat || box.dataset.seat !== current.seat.id;
    box.dataset.seat = current.seat.id;
    $("#p-jobs-list").innerHTML = list.map((j, i) => jobCard(j, firstRender ? i === 0 : openIds.has(j.id) || (i === 0 && ACTIVE.includes(j.status))))
      .join("");
    [...$("#p-jobs-list").children].forEach((li, i) => { li.dataset.id = list[i].id; });
  }

  api.watchJobs((list) => {
    jobs = list;
    renderBubbles();
    renderWorker();
    if (current) { renderPanelJobs(); markSeen(current); }
  });
  api.watchWorker((w) => { worker = w; renderWorker(); });
  setInterval(renderWorker, 30000);

  document.addEventListener("click", (e) => {
    const c = e.target.closest(".j-cancel");
    if (!c) return;
    api.cancelJob(c.dataset.job).then(() => toast("Đã yêu cầu huỷ.")).catch((err) => toast("Không huỷ được: " + err.message));
  });

  buildModel();
  render();
  wire();
  tickClock();
  setInterval(tickClock, 15000);

  // index.html#b1-developer (or #boss) opens that desk's panel directly.
  const hashId = decodeURIComponent(location.hash.slice(1));
  // (runs after sign-in, from auth.js)
  if (hashId === "boss") openPanel({ kind: "boss" });
  else if (seats[hashId]) openPanel({ kind: "seat", seat: seats[hashId] });
} };
