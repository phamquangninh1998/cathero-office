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
