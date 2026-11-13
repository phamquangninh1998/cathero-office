# Cat Hero Studio · Office

A static page (HTML/CSS/JS, no backend) that shows the studio as a cartoon office.
Each Claude thread in the project is an employee at a desk; empty desks are open roles.

Live: https://phamquangninh1998.github.io/cathero-office/ (GitHub Pages).

## Access
- Google sign-in only (Firebase Auth, project `cat-hero-office`).
- Allowed accounts: `ALLOWED_EMAILS` in `firebase-config.js` (UI) and the list in
  `firestore.rules` (enforced by the server). Change both together and publish the rules
  in the Firebase console (Firestore > Rules).
- Anyone else sees only the sign-in screen; Firestore refuses their reads and writes.
- The roster (which desk holds which thread) and command history live in Firestore
  (`office/roster`, `office/history`), not in this repo.

## Using it
- Click a desk to open its panel: pick a quick command or type one, then **Gửi**.
  The command is copied and the employee's thread opens on claude.ai; paste and press Enter.
  claude.ai has no public API for posting into a project thread, so the page cannot send by itself.
- Empty desks send a hiring request to the project chat (the coordinator).
- Attach or remove a thread from a desk with "Gắn link thread" in its panel (saved online).
- `#b1-developer` or `#boss` in the URL opens a desk's panel directly.

## Files
`data.js` teams, roles, quick commands · `art.js` SVG characters · `app.js` office UI ·
`auth.js` sign-in gate and Firestore · `firebase-config.js` · `firestore.rules` · `style.css`.

Local preview: `python3 -m http.server 8765` then open http://localhost:8765 (localhost is an authorized domain).
