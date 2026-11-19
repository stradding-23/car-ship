// Keeps the vessel pull-down current: reads Dispatch Companion's night and day boards and saves the
// vessel list to the page's Firebase database at ship/shared/vessels (the same shape the page reads).
// Runs on a timer from .github/workflows/vessels.yml. Node 20+, no packages needed.
const FB = (process.env.FIREBASE_URL || "https://car-ship-88342-default-rtdb.firebaseio.com").replace(/\/+$/, "");
const AUTH = process.env.FIREBASE_AUTH ? "?auth=" + encodeURIComponent(process.env.FIREBASE_AUTH) : "";
const DRY = process.argv.includes("--dry-run");

function isoDate(s) {
  const m = String(s || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? "20" + m[3] : m[3];
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

async function board(shift) {
  const r = await fetch(`https://api.dispatchcompanion.com/api/dispatch/${shift}/parsed`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${shift} board: HTTP ${r.status}`);
  const j = await r.json();
  const date = isoDate(j.dispatch_date);
  if (!date) throw new Error(`${shift} board: no date`);
  const vessels = (j.vessels || []).map(v => ({
    name: String(v.name || "").trim().toUpperCase(),
    terminal: v.terminal || "",
    type: v.vessel_type || "",
    start: v.start_time || "",
    drivers: (v.jobs || []).filter(x => x.category === "DRIVERS").reduce((a, x) => a + (x.count || 0), 0),
    notes: String(v.foreman_notes || "").trim(),
  })).filter(v => v.name);
  return { date, shift, vessels, stale: !!j.is_stale };
}

const lists = [await board("night"), await board("day")];
if (!lists.some(L => L.vessels.length)) throw new Error("Both boards are empty; leaving the saved list alone.");
for (const L of lists) { if (L.stale) console.log(`Note: Dispatch Companion marks the ${L.shift} board as stale.`); delete L.stale; }

const url = `${FB}/ship/shared/vessels.json${AUTH}`;
const old = await fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
if (old && JSON.stringify(old.lists || []) === JSON.stringify(lists)) { console.log("No change on the boards."); process.exit(0); }

const doc = { updated: Date.now(), source: "dispatchcompanion.com", lists };
for (const L of lists) console.log(`${L.shift} ${L.date}: ${L.vessels.map(v => `${v.name} (${v.terminal})`).join(", ") || "no vessels"}`);
if (DRY) { console.log("Dry run, nothing written."); process.exit(0); }
const w = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(doc) });
if (!w.ok) throw new Error(`Saving to Firebase failed: HTTP ${w.status} ${await w.text()}`);
console.log("Vessel list saved.");
