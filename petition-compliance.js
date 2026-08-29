// petition-compliance.js — THE RUNNER for Petition Studio compliance.
//
// Two passes:
//   1. PROBES — one filtered query per rule. Petition Studio answers authoritatively
//      where the brainstorm stands, who is waiting on a reviewer, how long a document
//      audit has been open, whether the client has approved. Cases on hold are hidden.
//   2. TIMELINES — for the cases a probe hit, read the history for the things filters
//      cannot answer: reviewer independence, notification flags, skipped stages, and
//      exact working hours in the current stage.
//
// Read-only throughout. SAFE MODE: DRY_RUN=true reports without emailing.
const { SETTINGS, STATUS_SLA, STAFF_IN_SCOPE, PROBES, STAFF, TRAINEES, DUAL_ROLE, staffFor, isTrainee } = require("./config");
const { listCases, caseHistory, getCase, mapPool } = require("./0-api");
const { runProbes } = require("./2-probes");
const { analyse } = require("./1-timeline");
const checkSla = require("./2-check-sla");
const checkProcess = require("./3-check-process");
const checkCaseDetail = require("./5-check-case-detail");
const checkReview = require("./6-check-review");
const { buildReport, sendReport, caseLink } = require("./4-report");

const RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const person = (p) => (p && (p.name || p.email)) || null;

function ownerOf(c, role) {
  const map = { case_manager: c.case_manager, petition_writer: c.petition_writer, reviewer: c.reviewer, processor: c.processor, brainstorm_specialist: c.brainstorm_specialist };
  return person(map[role]) || person(c.case_manager) || person(c.petition_writer) || "unassigned";
}
const ROLES = ["case_manager", "petition_writer", "reviewer", "processor", "brainstorm_specialist", "accountant", "forms_specialist"];

// Scope can be set by email or by name. Names are matched against the roster, so
// "Fatima" or "Fatima Khalid" both work.
function inScope(c) {
  if (!STAFF_IN_SCOPE.length) return true;
  const wanted = STAFF_IN_SCOPE.map((e) => String(e).toLowerCase());
  return ROLES.some((r) => {
    const p = c[r];
    if (!p) return false;
    if (p.email && wanted.includes(String(p.email).toLowerCase())) return true;
    if (p.name) { const n = String(p.name).toLowerCase(); return wanted.some((w) => n === w || n.includes(w) || w.includes(n)); }
    return false;
  });
}

// Anyone on the case who is a trainee writer, so their findings can be raised a level.
function traineeOn(c) {
  for (const r of ["petition_writer", "reviewer"]) if (c[r]?.name && isTrainee(c[r].name)) return c[r].name;
  return null;
}
const RAISE = { medium: "high", high: "critical", critical: "critical", low: "medium" };

async function main() {
  console.log(`=== Petition Studio Compliance — ${new Date().toISOString()} ===  DRY_RUN=${SETTINGS.DRY_RUN}`);
  console.log(`Staff in scope: ${STAFF_IN_SCOPE.length ? STAFF_IN_SCOPE.join(", ") : "everyone"}`);
  console.log(`Roster: ${STAFF.length} people — ${STAFF.filter((p) => p.role === "petition_writer").length} writers (${TRAINEES.length} in training), ${DUAL_ROLE.length} who also review`);
  if (DUAL_ROLE.length) console.log(`  ${DUAL_ROLE.join(" and ")} hold both roles, so the independence check matters most on their cases.`);
  console.log(`Cases on hold are excluded from every check.`);

  // ---- pass 1: the probes ----
  console.log(`\nRunning ${PROBES.length} filtered checks...`);
  const { found, perProbe } = await runProbes();
  console.log(`\nMatches per check:`);
  for (const p of PROBES) {
    const n = perProbe[p.id];
    console.log(`  ${String(n === undefined ? "-" : n).padStart(5)}  ${p.id.padEnd(26)} [${p.severity}]`);
  }

  // scope + closed
  let entries = [...found.values()]
    .filter((e) => !SETTINGS.CLOSED_STATUSES.includes(String(e.case.status || "").toLowerCase()))
    .filter((e) => inScope(e.case));
  if (SETTINGS.MAX_CASES) entries = entries.slice(0, SETTINGS.MAX_CASES);
  console.log(`\nCases with at least one finding: ${entries.length}`);

  const findings = [];
  for (const e of entries) {
    for (const h of e.hits) {
      findings.push({
        caseId: e.case.case_id,
        caseName: e.case.client_name || e.case.case_id,
        stage: STATUS_SLA[e.case.status]?.phase || e.case.status,
        owner: ownerOf(e.case, h.owner),
        area: h.area, severity: h.severity, problem: h.problem, action: h.action,
      });
    }
  }

  // ---- pass 2: timelines, for what the filters cannot answer ----
  if (SETTINGS.READ_TIMELINES && entries.length) {
    console.log(`Reading ${entries.length} timelines for the checks filters cannot cover...`);
    const histories = await mapPool(entries, SETTINGS.CONCURRENCY, (e) => caseHistory(e.case.case_id));
    const failed = histories.filter((h) => h && h.error).length;
    if (failed) console.log(`  ${failed} timeline(s) unreadable — those cases keep their filter findings only.`);

    entries.forEach((e, i) => {
      const h = histories[i];
      const t = analyse(e.case, h && !h.error ? h : { events: [] });
      let extra = [];
      try { extra = [...checkSla(e.case, t), ...checkProcess(e.case, t)]; }
      catch (err) { console.log(`  check error on ${e.case.case_id}: ${err.message}`); }
      for (const iss of extra) {
        // the probes cover stalling and chases far better, and the full record now owns
        // stage timing with the API's own business-hour figure
        if (["chase", "stalled"].includes(iss.area)) continue;
        if (iss.area === "sla" && SETTINGS.READ_FULL_CASE && SETTINGS.PREFER_API_STAGE_HOURS) continue;
        findings.push({
          caseId: e.case.case_id,
          caseName: e.case.client_name || e.case.case_id,
          stage: STATUS_SLA[e.case.status]?.phase || e.case.status,
          owner: ownerOf(e.case, iss.owner),
          area: iss.area, severity: iss.severity, problem: iss.problem, action: iss.action,
        });
      }
    });
  }

  // ---- pass 3: the full case record — documents, petition, forms, approval ----
  if (SETTINGS.READ_FULL_CASE && entries.length) {
    console.log(`Reading ${entries.length} full case record(s) for documents, petition, forms and approval...`);
    const details = await mapPool(entries, SETTINGS.CONCURRENCY, (e) => getCase(e.case.case_id));
    const bad = details.filter((d) => d && d.error).length;
    if (bad) console.log(`  ${bad} case record(s) unreadable — those keep their other findings only.`);

    entries.forEach((e, i) => {
      const full = details[i];
      if (!full || full.error) return;
      const record = full.case || full.data || full;
      let extra = [];
      try { extra = [...checkCaseDetail(record, e.case), ...checkReview(record, e.case)]; }
      catch (err) { console.log(`  detail check error on ${e.case.case_id}: ${err.message}`); }
      for (const iss of extra) findings.push({
        caseId: e.case.case_id,
        caseName: e.case.client_name || e.case.case_id,
        stage: STATUS_SLA[e.case.status]?.phase || e.case.status,
        owner: ownerOf(e.case, iss.owner),
        area: iss.area, severity: iss.severity, problem: iss.problem, action: iss.action,
      });
    });
  }

  // ---- trainee writers: raise their findings a level ----
  if (SETTINGS.ESCALATE_FOR_TRAINEES) {
    const traineeCases = new Map();
    for (const e of entries) { const t = traineeOn(e.case); if (t) traineeCases.set(e.case.case_id, t); }
    let raised = 0;
    for (const f of findings) {
      const who = traineeCases.get(f.caseId);
      if (!who) continue;
      if (["quality", "control", "documents"].includes(f.area) && RAISE[f.severity] !== f.severity) {
        f.severity = RAISE[f.severity];
        f.problem = `${f.problem} (writer in training: ${who})`;
        raised++;
      }
    }
    if (raised) console.log(`Raised ${raised} finding(s) on trainee writers' cases.`);
  }

  // de-duplicate identical findings on the same case
  const seen = new Set();
  let all = findings.filter((f) => {
    const k = `${f.caseId}|${f.problem}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });

  // ---------------------------------------------------------------------
  // TRIM IT DOWN TO WHAT SOMEBODY CAN ACTUALLY ACT ON
  // A report of two thousand lines gets ignored, which is worse than no report.
  //   - routine states are COUNTED, not listed
  //   - anything below the threshold is COUNTED, not listed
  //   - each case contributes its WORST issue only
  //   - a hard cap keeps the list readable no matter what
  // ---------------------------------------------------------------------
  const INFORMATIONAL = new Set(PROBES.filter((p) => p.informational).map((p) => p.problem.split(" — ")[0]));
  const threshold = RANK[SETTINGS.ITEMISE_FROM] ?? 1;
  const counted = {};
  const countIt = (f) => { const k = f.problem.split(" — ")[0]; counted[k] = (counted[k] || 0) + 1; };

  const actionable = [];
  for (const f of all) {
    const routine = [...INFORMATIONAL].some((p) => f.problem.startsWith(p));
    if (routine || (RANK[f.severity] ?? 9) > threshold) { countIt(f); continue; }
    actionable.push(f);
  }

  // worst issue per case only
  actionable.sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9));
  const perCase = new Map();
  const itemised = [];
  for (const f of actionable) {
    const n = perCase.get(f.caseId) || 0;
    if (n >= SETTINGS.MAX_PER_CASE) { countIt(f); continue; }
    perCase.set(f.caseId, n + 1);
    itemised.push(f);
  }

  const overflow = itemised.length - SETTINGS.MAX_ITEMISED;
  const unique = itemised.slice(0, SETTINGS.MAX_ITEMISED);
  if (overflow > 0) counted[`${overflow} further case(s) over the reporting limit`] = overflow;

  // pipeline snapshot from every live case, not just the flagged ones
  let byStatus = {};
  try {
    const all = await listCases();
    for (const c of all) if (!SETTINGS.CLOSED_STATUSES.includes(String(c.status || "").toLowerCase()))
      byStatus[c.status || "(none)"] = (byStatus[c.status || "(none)"] || 0) + 1;
  } catch (e) { console.log(`Could not read the pipeline snapshot: ${e.message}`); }

  // ---- log ----
  const byArea = {}, byOwner = {}, bySev = {};
  for (const f of unique) {
    byArea[f.area] = (byArea[f.area] || 0) + 1;
    byOwner[f.owner] = (byOwner[f.owner] || 0) + 1;
    bySev[f.severity] = (bySev[f.severity] || 0) + 1;
  }
  const desc = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  const scanned = Object.values(byStatus).reduce((a, b) => a + b, 0) || entries.length;
  console.log(`\n===== SUMMARY =====`);
  console.log(`Live cases ${scanned} | cases with something flagged ${entries.length}`);
  console.log(`Raw findings ${all.length}  ->  LISTED ${unique.length} (worst issue per case, ${SETTINGS.ITEMISE_FROM} and above)`);
  const countedTotal = Object.values(counted).reduce((a, b) => a + b, 0);
  if (countedTotal) {
    console.log(`\nCounted, not listed (${countedTotal}):`);
    for (const [k, n] of Object.entries(counted).sort((a, b) => b[1] - a[1]).slice(0, 15))
      console.log(`  ${String(n).padStart(5)}  ${k}`);
  }
  console.log(`\nBy severity:`); for (const [s, n] of desc(bySev)) console.log(`  ${String(n).padStart(4)}  ${s}`);
  console.log(`\nBy type:`);     for (const [a, n] of desc(byArea)) console.log(`  ${String(n).padStart(4)}  ${a}`);
  console.log(`\nBy owner:`);    for (const [o, n] of desc(byOwner)) console.log(`  ${String(n).padStart(4)}  ${o}`);


  const crit = unique.filter((f) => f.severity === "critical");
  if (crit.length) {
    console.log(`\nCRITICAL (${crit.length}):`);
    for (const f of crit.slice(0, 25)) console.log(`  ${f.owner} — ${f.caseName}\n     ${f.problem}\n     ${caseLink(f.caseId)}`);
  }
  console.log(`\nTHE LIST (${unique.length}):`);
  for (const f of unique)
    console.log(`\n• [${f.severity}] ${f.caseName} (${f.stage}) — ${f.owner}\n  ${f.problem}\n  -> ${f.action}`);

  // ---- report ----
  const html = buildReport({ findings: unique, counted, scanned, byStatus, dryRun: SETTINGS.DRY_RUN });
  require("fs").writeFileSync("petition-compliance-report.html", html);
  console.log(`\nWrote petition-compliance-report.html (download it from this run's Artifacts).`);

  if (SETTINGS.DRY_RUN) { console.log(`DRY RUN: the report was not emailed.`); return; }
  const ok = await sendReport(`Petition Studio compliance — ${unique.length} finding(s), ${crit.length} critical`, html);
  console.log(ok ? `Report sent to ${SETTINGS.REPORT_TO}` : `Report FAILED to send.`);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
