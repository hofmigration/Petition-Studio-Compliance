// discover.js — RUN THIS FIRST.
//
// The compliance rules are written against the API guide, but the guide cannot show
// what the data actually looks like in practice. This prints the real shape: the
// fields on a case, the statuses in use, how many cases sit in each, and the distinct
// event actions and titles found on the timeline.
//
// Send the output back and the checks can be tuned to the real data instead of guesses.
const { listCases, caseHistory, getCase, listFilters, mapPool } = require("./0-api");
const { PROBES } = require("./config");
const { STATUS_SLA, SETTINGS } = require("./config");

const SAMPLE_TIMELINES = 12;

(async () => {
  console.log(`=== Petition Studio discovery — ${new Date().toISOString()} ===`);
  console.log(`Base: ${SETTINGS.API_BASE}\n`);

  // ---- what filters does the API actually offer? ----
  try {
    const f = await listFilters();
    const defs = Array.isArray(f) ? f : (f.filters || f.data || []);
    console.log(`FILTERS AVAILABLE: ${defs.length}`);
    for (const d of defs) {
      const opts = (d.options || []).map((o) => o.id || o.value || o).join(", ");
      console.log(`  ${String(d.id || d.name).padEnd(22)} ${opts}`);
    }
    const known = new Set(defs.map((d) => String(d.id || d.name)));
    const used = [...new Set(PROBES.flatMap((p) => Object.keys(p.filter)))];
    const missing = used.filter((u) => !known.has(u));
    if (missing.length) console.log(`\n  !! probes use filters the API does not list: ${missing.join(", ")}`);
    const unused = [...known].filter((k) => !used.includes(k));
    if (unused.length) console.log(`  filters not yet used by any probe: ${unused.join(", ")}`);
  } catch (e) { console.log(`Could not read /filters: ${e.message}`); }

  console.log("");
  const cases = await listCases({}, { includeOnHold: true });
  const list = Array.isArray(cases) ? cases : (cases.cases || cases.data || cases.results || []);
  console.log(`Cases returned: ${list.length}`);
  if (!list.length) { console.log("Nothing returned — check the key and the endpoint."); return; }

  // ---- fields present on a case ----
  const fieldCount = {};
  for (const c of list) for (const k of Object.keys(c || {})) fieldCount[k] = (fieldCount[k] || 0) + 1;
  console.log(`\nFIELDS ON A CASE (name — how many cases have it non-null):`);
  for (const [k, n] of Object.entries(fieldCount).sort((a, b) => b[1] - a[1])) {
    const nonNull = list.filter((c) => c[k] !== null && c[k] !== undefined && c[k] !== "").length;
    console.log(`  ${k.padEnd(28)} ${String(nonNull).padStart(5)}/${list.length}`);
  }

  // ---- statuses actually in use ----
  const byStatus = {};
  for (const c of list) byStatus[c.status || "(none)"] = (byStatus[c.status || "(none)"] || 0) + 1;
  console.log(`\nSTATUSES IN USE:`);
  for (const [s, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    const known = STATUS_SLA[s] ? "" : "   <-- NOT IN config.js STATUS_SLA";
    console.log(`  ${String(n).padStart(5)}  ${s}${known}`);
  }
  const unknown = Object.keys(byStatus).filter((s) => s !== "(none)" && !STATUS_SLA[s]);
  if (unknown.length) console.log(`\n  Add these to STATUS_SLA: ${unknown.join(", ")}`);

  // ---- audit_state values ----
  const byAudit = {};
  for (const c of list) if (c.audit_state) byAudit[c.audit_state] = (byAudit[c.audit_state] || 0) + 1;
  if (Object.keys(byAudit).length) {
    console.log(`\nAUDIT_STATE VALUES:`);
    for (const [s, n] of Object.entries(byAudit).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${s}`);
  }

  // ---- assignment coverage ----
  const roles = ["case_manager", "petition_writer", "processor", "brainstorm_specialist", "reviewer"];
  console.log(`\nASSIGNMENT COVERAGE:`);
  for (const r of roles) {
    const filled = list.filter((c) => c[r] && (c[r].id || c[r].email)).length;
    const notified = list.filter((c) => c[`${r}_notified`] === true).length;
    console.log(`  ${r.padEnd(24)} assigned ${String(filled).padStart(5)}/${list.length}   notified ${notified}`);
  }
  const sameBoth = list.filter((c) => c.reviewer?.id && c.petition_writer?.id && String(c.reviewer.id) === String(c.petition_writer.id));
  console.log(`\n  reviewer is ALSO the writer on ${sameBoth.length} case(s)${sameBoth.length ? "  <-- independence problem" : ""}`);

  // ---- one full case, verbatim ----
  console.log(`\nONE CASE, EXACTLY AS RETURNED:`);
  console.log(JSON.stringify(list[0], null, 2).slice(0, 2000));

  // ---- timelines ----
  const sample = list.slice(0, SAMPLE_TIMELINES);
  console.log(`\nReading ${sample.length} timelines...`);
  const histories = await mapPool(sample, 3, (c) => caseHistory(c.case_id));

  const actions = {}, titles = {}, actors = {};
  let events = 0, withError = 0;
  for (const h of histories) {
    if (!h || h.error) { withError++; continue; }
    for (const e of h.events || []) {
      events++;
      actions[e.action || "(none)"] = (actions[e.action || "(none)"] || 0) + 1;
      titles[(e.title || "").slice(0, 60) || "(none)"] = (titles[(e.title || "").slice(0, 60) || "(none)"] || 0) + 1;
      actors[e.actor_type || "(none)"] = (actors[e.actor_type || "(none)"] || 0) + 1;
    }
  }
  console.log(`Events read: ${events}${withError ? `  (${withError} timeline(s) failed)` : ""}`);
  console.log(`\nACTOR TYPES:`); for (const [a, n] of Object.entries(actors)) console.log(`  ${String(n).padStart(5)}  ${a}`);
  console.log(`\nEVENT ACTIONS (this is what the checks key off):`);
  for (const [a, n] of Object.entries(actions).sort((x, y) => y[1] - x[1]).slice(0, 40)) console.log(`  ${String(n).padStart(5)}  ${a}`);
  console.log(`\nEVENT TITLES (top 40):`);
  for (const [t, n] of Object.entries(titles).sort((x, y) => y[1] - x[1]).slice(0, 40)) console.log(`  ${String(n).padStart(5)}  ${t}`);

  const first = histories.find((h) => h && !h.error && (h.events || []).length);
  if (first) {
    console.log(`\nONE TIMELINE, FIRST 6 EVENTS VERBATIM:`);
    console.log(JSON.stringify((first.events || []).slice(0, 6), null, 2).slice(0, 2500));
  }

  // ---- how many cases does each probe actually match? ----
  console.log(`\nPROBE COUNTS (what today's report would contain):`);
  for (const p of PROBES) {
    try {
      const hit = await listCases(p.filter);
      console.log(`  ${String(hit.length).padStart(5)}  ${p.id.padEnd(26)} [${p.severity}]`);
    } catch (e) { console.log(`  ERROR  ${p.id}: ${e.message}`); }
  }

  // ---- the FULL case record: this is what the document checks read ----
  console.log(`\n===== FULL CASE RECORD =====`);
  const probe = list[0];
  try {
    const raw = await getCase(probe.case_id);
    const rec = raw.case || raw.data || raw;
    console.log(`Top-level fields: ${Object.keys(rec).join(", ")}`);

    const shape = (label, v) => {
      if (v === undefined || v === null) return console.log(`  ${label.padEnd(24)} MISSING`);
      if (Array.isArray(v)) return console.log(`  ${label.padEnd(24)} array of ${v.length}${v.length ? ` — keys: ${Object.keys(v[0] || {}).join(", ")}` : ""}`);
      if (typeof v === "object") return console.log(`  ${label.padEnd(24)} object — keys: ${Object.keys(v).join(", ")}`);
      return console.log(`  ${label.padEnd(24)} ${typeof v} — ${String(v).slice(0, 80)}`);
    };
    console.log(`\nWHAT THE DOCUMENT CHECKS NEED:`);
    for (const k of ["stage", "review_status", "amendments", "client_profile", "documents", "petition",
                     "forms_stage", "client_review", "recommendation_letters", "business_plan", "assigned", "history"]) shape(k, rec[k]);

    // v2: the fields that make hour-level SLAs and the amendment loop possible
    if (rec.stage) {
      console.log(`\nSTAGE TIMING (v2): ${JSON.stringify(rec.stage)}`);
      if (rec.stage.age_hours === undefined) console.log(`  !! age_hours missing — SLA timing will fall back to derived hours`);
    } else console.log(`\n!! no "stage" object — SLA timing falls back to derived hours`);
    if (rec.amendments) console.log(`AMENDMENTS (v2): ${Array.isArray(rec.amendments) ? `${rec.amendments.length} entry(ies)` : typeof rec.amendments}  ${JSON.stringify(rec.amendments).slice(0, 400)}`);
    else console.log(`no amendments on this case`);
    if (rec.review_status) console.log(`REVIEW STATUS (v2): ${JSON.stringify(rec.review_status).slice(0, 400)}`);

    if (Array.isArray(rec.documents) && rec.documents.length) {
      console.log(`\nDOCUMENT LABELS on this case:`);
      for (const d of rec.documents.slice(0, 20))
        console.log(`  ${(d.label || d.name || "(no label)").padEnd(30)} ${d.file_name || d.filename || ""}`);
    }
    if (rec.petition) console.log(`\nPETITION SECTIONS: ${Object.keys(rec.petition).join(", ")}`);
    if (rec.forms_stage) console.log(`FORMS STAGE: ${JSON.stringify(rec.forms_stage).slice(0, 500)}`);
    if (rec.client_review) console.log(`CLIENT REVIEW: ${JSON.stringify(rec.client_review).slice(0, 400)}`);
    if (rec.client_profile) console.log(`\nCLIENT PROFILE (first 800 chars):\n${JSON.stringify(rec.client_profile).slice(0, 800)}`);

    // does the history record status changes? that decides whether real SLA timing is possible
    const hist = rec.history || rec.events || [];
    console.log(`\nHISTORY: ${hist.length} event(s)`);
  } catch (e) { console.log(`Could not read the full case record: ${e.message}`); }

  console.log(`\n=== done — send this whole output back and the rules get tuned to it ===`);
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
