// 4-report.js — the daily HTML report, in the HOF style.
const T = require("./email-template");
const { SETTINGS, STATUS_SLA } = require("./config");
const { groupSentence } = require("./7-group");

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

// one grouped problem, with the oldest cases named underneath
function groupRow(item, i, arr) {
  const colour = SEV[item.severity] || SEV.low;
  const cases = item.cases.map((c) =>
    `<a href="${caseLink(c.caseId)}" style="color:#2f6ecb;text-decoration:none;">${T.esc(c.caseName || c.caseId)}</a>${c.ageHours ? ` <span style="color:#7c8aa5;">(${Math.round(c.ageHours)}h)</span>` : ""}`
  ).join(" &middot; ");
  const more = item.moreCases ? ` <span style="color:#7c8aa5;">and ${item.moreCases} more</span>` : "";
  return `<div style="padding:11px 0;${i === arr.length - 1 ? "" : "border-bottom:1px solid #ebeef4;"}">
    <div style="font-size:13px;color:#33475b;line-height:1.5;">
      <strong style="color:${colour};">${item.count} cases</strong> &middot; <strong style="color:#1f2d5c;">${T.esc(item.owner || "Unassigned")}</strong>
    </div>
    <div style="font-size:13px;color:#33475b;line-height:1.55;margin-top:3px;">${T.esc(groupSentence(item))}</div>
    <div style="font-size:12px;color:#516f90;margin-top:5px;">What to do: ${T.esc(item.action || "review these cases")}</div>
    <div style="font-size:11.5px;margin-top:5px;">${cases}${more}</div>
  </div>`;
}

function buildReport({ escalations = [], grouped = [], singles = [], counted, scanned, byStatus, dryRun }) {
  const totalCases = escalations.reduce((a, b) => a + b.count, 0) + grouped.reduce((a, b) => a + b.count, 0) + singles.length;
  const criticals = [...escalations, ...grouped].filter((g) => g.severity === "critical").length + singles.filter((f) => f.severity === "critical").length;

  const section = (title, html, n) => (n ? T.sectionTitle(`${title} — ${n}`) + html : "");

  const headline = escalations.length
    ? T.callout(`<strong>${escalations.length} systemic problem(s).</strong> One person is carrying a backlog of the same issue — these will not clear case by case.`, "alert")
    : totalCases
      ? T.callout(`<strong>${totalCases} case(s) need attention.</strong> Nothing systemic today.`, "warn")
      : T.callout("Nothing needs action today.", "ok");

  const rest = Object.entries(counted || {}).sort((a, b) => b[1] - a[1]);

  const body =
    (dryRun ? T.callout("<strong>DRY RUN / PREVIEW.</strong> This report was not emailed to anyone.", "warn") : "") +
    headline +
    T.paragraph(`<strong>${scanned}</strong> live case(s) checked. ${escalations.length} systemic problem(s), ${grouped.length} grouped issue(s), ${singles.length} individual case(s).`) +

    section("Escalate — a backlog, not a reminder", escalations.map(groupRow).join(""), escalations.length) +
    section("Grouped — the same issue on several cases", grouped.map(groupRow).join(""), grouped.length) +
    section("Individual cases", rows(singles), singles.length) +

    (totalCases === 0 ? T.paragraph("Nothing reached the reporting threshold today.") : "") +
    (rest.length
      ? T.sectionTitle("Normal states, for information") +
        T.paragraph("These are where cases legitimately sit. Counted so nothing is hidden, but no action is needed today.", 13) +
        T.table(["Situation", "Cases"], rest.map(([k, n]) => [T.esc(k), String(n)]))
      : "") +
    T.sectionTitle("Pipeline by stage") +
    T.table(["Stage", "Cases"], Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([s, n]) => [`${STATUS_SLA[s]?.phase || s}`, String(n)])) +
    T.footer(`Petition Studio &middot; generated ${new Date().toISOString().slice(0, 10)}.`);

  return T.shell({
    title: "Petition Studio Compliance",
    subtitle: `${scanned} live cases &middot; ${escalations.length} to escalate &middot; ${totalCases} cases flagged`,
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
