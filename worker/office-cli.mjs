#!/usr/bin/env node
// Office helper for the CEO assistant (run by the worker on the Mac mini).
//   node office-cli.mjs roster                 -> teams, seats and their ids
//   node office-cli.mjs status [--hours 24]    -> latest job per employee with a short report
//   node office-cli.mjs report <jobId>         -> full report of one job
//   node office-cli.mjs dispatch --seat <seatId> --command "..."   -> queue a job for one employee
//   node office-cli.mjs dispatch --team <teamId> --command "..."   -> queue it for every member of a team
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const here = path.dirname(fileURLToPath(import.meta.url));
const KEY = process.env.OFFICE_KEY || path.join(os.homedir(), ".config/cathero-office/service-account.json");
initializeApp({ credential: cert(JSON.parse(fs.readFileSync(KEY, "utf8"))) });
const db = getFirestore();

// Read the roster from the page's data.js so the two never drift apart.
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(here, "..", "data.js"), "utf8"), sandbox);
const D = sandbox.window.OFFICE_DATA;
const SEATS = D.teams.flatMap((t) => t.seats.map((s) => ({
  id: `${t.id}-${s.role}`, team: t.id, teamName: t.name, game: t.project, role: s.role, title: `${D.roles[s.role].label} · ${t.name}`
})));

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const short = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const when = (t) => (t && t.toDate ? t.toDate().toISOString().replace("T", " ").slice(0, 16) + "Z" : "-");

if (cmd === "roster") {
  for (const t of D.teams) {
    console.log(`team ${t.id}: ${t.name} (${t.project})`);
    for (const s of SEATS.filter((x) => x.team === t.id)) console.log(`  seat ${s.id}: ${s.title}`);
  }
} else if (cmd === "status") {
  const hours = Number(opt("hours") || 72);
  const since = new Date(Date.now() - hours * 3600e3);
  const snap = await db.collection("jobs").where("createdAt", ">=", since).orderBy("createdAt", "desc").limit(300).get();
  const latest = new Map();
  snap.docs.forEach((d) => { const j = d.data(); if (!latest.has(j.seatId)) latest.set(j.seatId, { id: d.id, ...j }); });
  const w = (await db.collection("office").doc("worker").get()).data() || {};
  console.log(`worker last seen ${when(w.lastSeen)}, running: ${(w.running || []).length}`);
  for (const s of [...SEATS, { id: "boss", title: "Trợ lý CEO" }]) {
    const j = latest.get(s.id);
    if (!j) { console.log(`- ${s.title} [${s.id}]: no job in the last ${hours} h`); continue; }
    console.log(`- ${s.title} [${s.id}]: ${j.status} (job ${j.id}, ${when(j.finishedAt || j.startedAt || j.createdAt)}) cmd: ${short(j.command, 100)}${j.report ? ` | report: ${short(j.report, 260)}` : ""}${j.note ? ` | note: ${j.note}` : ""}`);
  }
} else if (cmd === "report") {
  const d = await db.collection("jobs").doc(args[1] || "").get();
  if (!d.exists) { console.error("no such job"); process.exit(1); }
  const j = d.data();
  console.log(`${j.title} | ${j.status} | ${when(j.createdAt)}\ncommand: ${j.command}\n\n${j.report || j.error || "(no report yet)"}`);
} else if (cmd === "dispatch") {
  const command = opt("command");
  const seatId = opt("seat");
  const teamId = opt("team");
  if (!command || (!seatId && !teamId)) { console.error("need --command and --seat or --team"); process.exit(1); }
  const targets = seatId ? SEATS.filter((s) => s.id === seatId) : SEATS.filter((s) => s.team === teamId);
  if (!targets.length) { console.error("unknown seat/team; run: roster"); process.exit(1); }
  const batchId = targets.length > 1 ? `${teamId}-${Date.now().toString(36)}` : undefined;
  for (const [i, s] of targets.entries()) {
    const ref = await db.collection("jobs").add({
      seatId: s.id, title: s.title, role: s.role, team: s.team, command, status: "queued",
      createdAt: FieldValue.serverTimestamp(), createdBy: "ceo-assistant",
      ...(process.env.OFFICE_PARENT_JOB ? { parentJob: process.env.OFFICE_PARENT_JOB } : {}),
      ...(batchId ? { batchId, batchOrder: i } : {})
    });
    console.log(`queued ${ref.id} for ${s.title}`);
  }
} else {
  console.log("usage: roster | status [--hours N] | report <jobId> | dispatch (--seat ID | --team ID) --command TEXT");
}
process.exit(0);
