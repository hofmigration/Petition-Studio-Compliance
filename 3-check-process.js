// 4-report.js — the daily report email.
// Table-based with inline styles so it renders in Gmail and Outlook. Colour carries the
// priority: the reader should know in one glance whether today is bad, and where.
const { SETTINGS, STATUS_SLA } = require("./config");
const { groupSentence } = require("./7-group");

const C = {
  navy: "#1b2650", navyLite: "#2f3f87",
  ink: "#1f2937", body: "#3f4a5a", soft: "#8792a5", faint: "#a8b1c1",
  rule: "#e6e9f0", panel: "#f7f9fc",
  critical: "#c0392b", criticalBg: "#fdecea", criticalTint: "#fef6f5",
  high: "#c2620f", highBg: "#fff4e6", highTint: "#fffaf3",
  medium: "#9a7b0a", mediumBg: "#fdf8e3", mediumTint: "#fffdf5",
  good: "#2e7d4f", goodBg: "#eaf6ec",
  link: "#2f6ecb",
};
const SEV = {
  critical: { fg: C.critical, bg: C.criticalBg, tint: C.criticalTint, label: "URGENT" },
  high:     { fg: C.high,     bg: C.highBg,     tint: C.highTint,     label: "HIGH" },
  medium:   { fg: C.medium,   bg: C.mediumBg,   tint: C.mediumTint,   label: "WATCH" },
  low:      { fg: C.soft,     bg: C.panel,      tint: "#ffffff",      label: "NOTE" },
};
const F = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const caseLink = (id) => `${SETTINGS.DASHBOARD}?case=${encodeURIComponent(id)}`;
const hrs = (h) => (h ? `${Math.round(h)}h` : "");

// ---- building blocks --------------------------------------------------------
const chip = (severity) => {
  const s = SEV[severity] || SEV.low;
  return `<span style="display:inline-block;background:${s.fg};color:#ffffff;font:700 10px/1 ${F};letter-spacing:.08em;padding:4px 7px;border-radius:3px;">${s.label}</span>`;
};

const heading = (text, accent) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 12px;"><tr>
    <td style="border-left:4px solid ${accent};padding:0 0 0 10px;font:700 15px/1.3 ${F};color:${C.navy};">${esc(text)}</td>
  </tr></table>`;

const para = (html, size = 14.5, colour = C.body) =>
  `<div style="font:400 ${size}px/1.65 ${F};color:${colour};margin:0 0 13px;">${html}</div>`;

// a card: tinted by severity, with a coloured rail
function card({ severity, title, meta, why, action, risk, cases }) {
  const s = SEV[severity] || SEV.low;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;background:${s.tint};border:1px solid ${s.bg};border-left:4px solid ${s.fg};border-radius:4px;">
  <tr><td style="padding:13px 16px 14px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font:600 15px/1.4 ${F};color:${C.ink};">${title}</td>
      <td align="right" style="white-space:nowrap;padding-left:10px;">${chip(severity)}</td>
    </tr></table>
    ${meta ? `<div style="font:400 12px/1.5 ${F};color:${C.soft};margin-top:4px;">${meta}</div>` : ""}
    <div style="font:400 14px/1.6 ${F};color:${C.body};margin-top:9px;">${why}</div>
    <div style="font:400 13.5px/1.6 ${F};color:${C.ink};margin-top:9px;">
      <span style="display:inline-block;background:${s.fg};color:#fff;font:700 9.5px/1 ${F};letter-spacing:.06em;padding:3px 6px;border-radius:2px;vertical-align:1px;">DO</span>
      &nbsp;${esc(action || "review this case")}</div>
    ${risk ? `<div style="font:400 13px/1.6 ${F};color:${C.soft};margin-top:6px;">
      <span style="display:inline-block;border:1px solid ${C.faint};color:${C.soft};font:700 9.5px/1 ${F};letter-spacing:.06em;padding:3px 6px;border-radius:2px;vertical-align:1px;">AVOID</span>
      &nbsp;${esc(risk)}</div>` : ""}
    ${cases ? `<div style="font:400 12.5px/1.8 ${F};margin-top:10px;padding-top:9px;border-top:1px solid ${s.bg};">${cases}</div>` : ""}
  </td></tr></table>`;
}

const caseList = (list, more) =>
  (list || []).map((c) => `<a href="${caseLink(c.caseId)}" style="color:${C.link};text-decoration:none;font-weight:500;">${esc(c.caseName || c.caseId)}</a>${c.ageHours ? `<span style="color:${C.faint};"> ${hrs(c.ageHours)}</span>` : ""}`)
    .join(`<span style="color:${C.faint};"> &nbsp;·&nbsp; </span>`) + (more ? `<span style="color:${C.soft};"> &nbsp;+${more} more</span>` : "");

const groupCard = (g) => card({
  severity: g.severity,
  title: `${esc(g.owner || "Unassigned")} <span style="font-weight:400;color:${SEV[g.severity]?.fg || C.soft};">· ${g.count} cases</span>`,
  meta: g.stage ? esc(g.stage) : "",
  why: esc(groupSentence(g)),
  action: g.action, risk: g.risk,
  cases: caseList(g.cases, g.moreCases),
});

const singleCard = (f) => card({
  severity: f.severity,
  title: `<a href="${caseLink(f.caseId)}" style="color:${C.ink};text-decoration:none;">${esc(f.caseName || f.caseId)}</a>`,
  meta: `${esc(f.owner || "Unassigned")}${f.stage ? ` &nbsp;·&nbsp; ${esc(f.stage)}` : ""}${f.ageHours ? ` &nbsp;·&nbsp; ${hrs(f.ageHours)} in stage` : ""}`,
  why: esc(f.problem),
  action: f.action, risk: f.risk,
});

// the numbers strip across the top
function stats(cells) {
  const w = Math.floor(100 / cells.length);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px;">
  <tr>${cells.map((c) => `<td width="${w}%" align="center" style="background:${c.bg};border:1px solid ${c.border || c.bg};border-radius:4px;padding:13px 6px;">
    <div style="font:700 26px/1 ${F};color:${c.fg};">${esc(c.value)}</div>
    <div style="font:600 10.5px/1.3 ${F};letter-spacing:.07em;text-transform:uppercase;color:${c.fg};opacity:.85;margin-top:5px;">${esc(c.label)}</div>
  </td>${c === cells[cells.length - 1] ? "" : '<td width="10"></td>'}`).join("")}</tr></table>`;
}

function numbers(rows, headerColour) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;width:100%;border:1px solid ${C.rule};border-radius:4px;">
    <tr><td style="background:${C.panel};padding:8px 12px;font:700 11px/1.3 ${F};letter-spacing:.06em;text-transform:uppercase;color:${headerColour || C.navy};">Situation</td>
        <td align="right" style="background:${C.panel};padding:8px 12px;font:700 11px/1.3 ${F};letter-spacing:.06em;text-transform:uppercase;color:${headerColour || C.navy};">Cases</td></tr>
    ${rows.map(([k, v], i) => `<tr>
      <td style="padding:8px 12px;border-top:1px solid ${C.rule};font:400 13px/1.5 ${F};color:${C.body};${i % 2 ? `background:${C.panel};` : ""}">${esc(k)}</td>
      <td align="right" style="padding:8px 12px;border-top:1px solid ${C.rule};font:700 13px/1.5 ${F};color:${C.ink};white-space:nowrap;${i % 2 ? `background:${C.panel};` : ""}">${esc(v)}</td>
    </tr>`).join("")}</table>`;
}

// ---- the report --------------------------------------------------------------
function buildReport({ escalations = [], grouped = [], singles = [], counted, scanned, byStatus, dryRun, excluded = 0, checked = 0 }) {
  const flaggedCases = escalations.reduce((a, b) => a + b.count, 0) + grouped.reduce((a, b) => a + b.count, 0) + singles.length;
  const items = [...escalations, ...grouped, ...singles];
  const urgent = items.filter((x) => x.severity === "critical").length;
  const stopped = singles.filter((f) => f.area === "momentum");
  const others = singles.filter((f) => f.area !== "momentum");
  const nothingChecked = checked === 0 && scanned > 0;
  const mostlyExcluded = excluded > 0 && scanned > 0 && excluded / scanned > 0.5;

  // the banner that decides whether anyone reads on
  let banner;
  if (nothingChecked)
    banner = { bg: C.criticalBg, fg: C.critical, text: `<strong>Nothing was actually checked.</strong> All ${scanned} live cases were set aside before any rule ran — this is not an all-clear. Check the filters in config.js.` };
  else if (escalations.length)
    banner = { bg: C.criticalBg, fg: C.critical, text: `<strong>${escalations.length} backlog${escalations.length > 1 ? "s" : ""} to plan.</strong> One person is carrying the same problem across many cases — that will not clear case by case.` };
  else if (urgent)
    banner = { bg: C.criticalBg, fg: C.critical, text: `<strong>${urgent} case${urgent > 1 ? "s" : ""} need action today.</strong> Nothing systemic, but these should not wait.` };
  else if (flaggedCases)
    banner = { bg: C.highBg, fg: C.high, text: `<strong>${flaggedCases} case${flaggedCases > 1 ? "s" : ""} need attention.</strong> Nothing urgent today.` };
  else if (mostlyExcluded)
    banner = { bg: C.highBg, fg: C.high, text: `No findings, but ${excluded} of ${scanned} cases were set aside before the rules ran. Treat this as a partial check.` };
  else
    banner = { bg: C.goodBg, fg: C.good, text: `<strong>All clear.</strong> Every live case was checked and came back clean.` };

  const statCells = [
    { value: String(scanned), label: "live cases", fg: C.navy, bg: C.panel, border: C.rule },
    { value: String(urgent), label: "urgent", fg: urgent ? C.critical : C.soft, bg: urgent ? C.criticalBg : C.panel, border: urgent ? C.criticalBg : C.rule },
    { value: String(escalations.length), label: "backlogs", fg: escalations.length ? C.high : C.soft, bg: escalations.length ? C.highBg : C.panel, border: escalations.length ? C.highBg : C.rule },
    { value: String(stopped.length), label: "stopped moving", fg: stopped.length ? C.medium : C.soft, bg: stopped.length ? C.mediumBg : C.panel, border: stopped.length ? C.mediumBg : C.rule },
  ];

  const rest = Object.entries(counted || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, String(n)]);
  const pipeline = Object.entries(byStatus || {}).sort((a, b) => b[1] - a[1]).map(([s, n]) => [STATUS_SLA[s]?.phase || s, String(n)]);

  const body = `
${dryRun ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;"><tr><td style="background:${C.mediumBg};border-left:4px solid ${C.medium};padding:10px 14px;font:400 13px/1.5 ${F};color:${C.medium};"><strong>Dry run.</strong> This was not emailed to anyone else.</td></tr></table>` : ""}

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr>
  <td style="background:${banner.bg};border-left:4px solid ${banner.fg};padding:13px 16px;font:400 14.5px/1.6 ${F};color:${banner.fg};">${banner.text}</td>
</tr></table>

${stats(statCells)}

${escalations.length ? heading("Plan these — a backlog, not a reminder", C.critical) + escalations.map(groupCard).join("") : ""}
${stopped.length ? heading("Stopped moving", C.medium) + para(`These were being actively worked and then went quiet. They do not look old, which is exactly why nobody notices them.`, 13.5, C.soft) + stopped.map(singleCard).join("") : ""}
${grouped.length ? heading("The same problem on several cases", C.high) + grouped.map(groupCard).join("") : ""}
${others.length ? heading("Individual cases", C.high) + others.map(singleCard).join("") : ""}
${flaggedCases === 0 && !nothingChecked ? para(`<span style="color:${C.good};">Nothing reached the reporting threshold today.</span>`) : ""}

${rest.length ? heading("Background — no action needed today", C.soft) + numbers(rest) : ""}
${pipeline.length ? heading("Where the caseload sits", C.navy) + numbers(pipeline) : ""}
`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f6;padding:26px 12px;margin:0;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="width:640px;max-width:640px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(27,38,80,.10);">
  <tr><td style="background-color:${C.navy};background-image:linear-gradient(120deg,${C.navy} 0%,${C.navyLite} 100%);padding:22px 26px;">
    <div style="font:700 21px/1.25 ${F};color:#ffffff;">Petition Studio Compliance</div>
    <div style="font:400 12.5px/1.5 ${F};color:#aab6dc;margin-top:5px;">
      ${new Date().toISOString().slice(0, 10)} &nbsp;·&nbsp; ${scanned} live cases &nbsp;·&nbsp; ${flaggedCases} flagged${urgent ? ` &nbsp;·&nbsp; <span style="color:#ffb4ab;font-weight:600;">${urgent} urgent</span>` : ""}
    </div>
  </td></tr>
  <tr><td style="padding:22px 26px 26px;">${body}</td></tr>
  <tr><td style="background:${C.panel};border-top:1px solid ${C.rule};padding:16px 26px;font:400 11.5px/1.6 ${F};color:${C.soft};">
    <strong style="color:${C.body};">Ali Raza</strong> · Compliance · HOF Migration<br>
    Sent automatically. Read-only — nothing in Petition Studio is changed by this report.
  </td></tr>
</table>
</td></tr></table>`;
}

// ---- sending -----------------------------------------------------------------
async function sendReport(subject, html) {
  if (!process.env.RESEND_KEY) { console.log("No RESEND_KEY secret set."); return false; }
  const body = { from: SETTINGS.FROM_EMAIL, to: [SETTINGS.REPORT_TO], subject, html };
  if (SETTINGS.REPORT_CC && SETTINGS.REPORT_CC.length) body.cc = SETTINGS.REPORT_CC;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = (await res.text()).slice(0, 250);
    console.log(`Report failed to send: ${res.status} ${t}`);
    if (res.status === 403 && SETTINGS.FROM_EMAIL.endsWith("resend.dev"))
      console.log(`  The test sender only delivers to the address this Resend account was registered with.`);
    return false;
  }
  return true;
}
async function checkTransport() {
  if (!process.env.RESEND_KEY) return { ok: false, reason: "RESEND_KEY secret is missing" };
  return { ok: true };
}

module.exports = { buildReport, sendReport, checkTransport, caseLink };
