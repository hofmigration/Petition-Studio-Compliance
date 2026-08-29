// 2-probes.js — runs each filtered query and turns the matching cases into findings.
//
// Petition Studio already knows where the brainstorm stands, who is waiting on a
// reviewer, how long a document audit has been open and whether a client has approved.
// Asking it directly through the filters is authoritative; reading the event text and
// guessing is not. Every query hides cases on hold.
const { PROBES, LATE_STAGES, SETTINGS } = require("./config");
const { listCases } = require("./0-api");

const RANK = { critical: 0, high: 1, medium: 2, low: 3 };

// The same probe fires on many cases, so a static sentence would repeat all down the
// report. Each finding is given the case's own detail — how long it has sat, who holds
// it — so every line reads differently and can be judged on its own.
function contextualise(probe, c) {
  const stageObj = c.stage || {};
  const hours = Number(stageObj.age_hours);
  const days = Number(stageObj.age_days);
  const bits = [];
  if (Number.isFinite(hours) && hours > 0) bits.push(`${hours}h in ${c.status || "this stage"}`);
  else if (Number.isFinite(days) && days > 0) bits.push(`${days}d in ${c.status || "this stage"}`);
  else if (c.status) bits.push(`at ${c.status}`);
  return bits.length ? `${probe.problem} — ${bits.join(", ")}` : probe.problem;
}

async function runProbes(log = console.log) {
  const found = new Map();     // caseId -> { case, hits: [] }
  const perProbe = {};
  const seenIds = new Set();

  for (const probe of PROBES) {
    let cases;
    try { cases = await listCases(probe.filter); }
    catch (e) { log(`  probe "${probe.id}" failed: ${e.message}`); perProbe[probe.id] = "failed"; continue; }

    const list = (cases || []).filter((c) => !probe.onlyStatuses || probe.onlyStatuses.includes(c.status));
    perProbe[probe.id] = list.length;

    for (const c of list) {
      const id = c.case_id;
      seenIds.add(id);
      if (!found.has(id)) found.set(id, { case: c, hits: [] });

      // a late-stage case with a poor verdict is more serious than the same verdict early on
      let severity = probe.severity;
      if (probe.area === "quality" && LATE_STAGES.includes(c.status)) {
        severity = severity === "high" ? "critical" : "high";
      }
      found.get(id).hits.push({ ...probe, severity, problem: contextualise(probe, c) });
    }
  }

  // drop the softer version when the harder one already fired on the same case
  for (const entry of found.values()) {
    const ids = new Set(entry.hits.map((h) => h.id));
    entry.hits = entry.hits.filter((h) => !(h.supersededBy && ids.has(h.supersededBy)));
    entry.hits.sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9));
  }

  return { found, perProbe, caseIds: seenIds };
}

module.exports = { runProbes };
