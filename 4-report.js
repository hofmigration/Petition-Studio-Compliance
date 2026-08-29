// 4-report.js — the daily HTML report, in the HOF style.
const T = require("./email-template");
const { SETTINGS, STATUS_SLA } = require("./config");

const caseLink = (id) => `${SETTINGS.DASHBOARD}?case=${encodeURIComponent(id)}`;
const SEV = { critical: "#c0392b", high: "#c0392b", medium: "#b9770e", low: "#7c8aa5" };
const RANK = { critical: 0, high: 1, medium: 2, low: 3 };

function rows(items) {
  return items.map((f, i, a) => T.row({
    name: f.caseName || f.caseId,
    title: f.owner ? `— ${f.owner}` : "",
    link: caseLink(f.caseId),
    linkLabel: "Open case",
    details: [
      `<strong style="color:${SEV[f.severity] || SEV.low};">${String(f.severity).toUpperCase()}</strong> &middot; ${T.esc(f.problem)}`,
      `${T.esc(f.stage || "")}${f.action ? ` &middot; ${T.esc(f.action)}` : ""}`,
    ],
    last: i === a.length - 1,
  })).join("");
}

function buildReport({ findings, counted, scanned, byStatus, dryRun }) {
  const itemised = findings;                       // already filtered and capped by the runner
  const group = (area) => itemised.filter((f) => area.includes(f.area))
    .sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9));

  const controls = group(["control", "assign", "sequence"]);
  const quality  = group(["quality", "documents"]);
  const timing   = group(["sla", "stalled", "chase"]);
  const other    = group(["notify", "unknown"]);
  const criticals = itemised.filter((f) => f.severity === "critical").length;

  const section = (title, list) => (list.length ? T.sectionTitle(`${title} — ${list.length}`) + rows(list) : "");

  // everything not worth a line of its own, as counts
  const rest = Object.entries(counted || {}).sort((a, b) => b[1] - a[1]);
  const restTable = rest.length
    ? T.sectionTitle("Everything else, by count") +
      T.paragraph("These are normal states, not failures. They are here so nothing is hidden, but they do not need action today.", 13) +
      T.table(["Situation", "Cases"], rest.map(([k, n]) => [T.esc(k), String(n)]))
    : "";

  const pipeline = Object.entries(byStatus).sort((a, b) => b[1] - a[1])
    .map(([s, n]) => [`${STATUS_SLA[s]?.phase || s}`, String(n)]);

  const body =
    (dryRun ? T.callout("<strong>DRY RUN / PREVIEW.</strong> This report was not emailed to anyone.", "warn") : "") +
    (criticals
      ? T.callout(`<strong>${criticals} case(s) need action today.</strong> These are control failures, listed first.`, "alert")
      : itemised.length
        ? T.callout(`<strong>${itemised.length} case(s) need attention.</strong> No control failures today.`, "warn")
        : T.callout("Nothing needs action today.", "ok")) +
    T.paragraph(`<strong>${scanned}</strong> live case(s) checked. <strong>${itemised.length}</strong> listed below, one line per case, worst issue only.`) +
    section("Control failures", controls) +
    section("Quality and documents", quality) +
    section("Running late", timing) +
    section("Other", other) +
    (itemised.length === 0 ? T.paragraph("Nothing reached the reporting threshold today.") : "") +
    restTable +
    T.sectionTitle("Pipeline by stage") +
    T.table(["Stage", "Cases"], pipeline) +
    T.footer(`Petition Studio &middot; generated ${new Date().toISOString().slice(0, 10)}.`);

  return T.shell({
    title: "Petition Studio Compliance",
    subtitle: `${scanned} live cases &middot; ${itemised.length} need action &middot; ${criticals} critical`,
    body,
  });
}

async function sendReport(subject, html) {
  if (!process.env.RESEND_KEY) { console.log("No RESEND_KEY secret set."); return false; }
  const body = { from: SETTINGS.FROM_EMAIL, to: [SETTINGS.REPORT_TO], subject, html };
  if (SETTINGS.REPORT_CC.length) body.cc = SETTINGS.REPORT_CC;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = (await res.text()).slice(0, 200);
    console.log(`Report failed: ${res.status} ${t}`);
    if (res.status === 403) console.log(`  The test sender only reaches the address the Resend account was registered with.`);
    return false;
  }
  return true;
}

module.exports = { buildReport, sendReport, caseLink };
