// 7-group.js — turns a pile of findings into something a person can act on.
//
// The problem this solves: one systemic issue produces dozens of identical findings.
// Thirty-seven "brainstorm overdue" criticals against one specialist is not thirty-seven
// failures, it is one backlog, and reporting it as thirty-seven makes the report useless
// and makes "critical" meaningless.
//
// So findings that share the same OWNER and the same ISSUE are grouped:
//   a group of ESCALATE_MIN or more -> an ESCALATION, a systemic problem for management
//   a group of CLUSTER_MIN or more  -> one grouped line, with the oldest cases named
//   anything smaller                -> listed case by case, as before
const { SETTINGS } = require("./config");

const RANK = { critical: 0, high: 1, medium: 2, low: 3 };
// the issue, without the per-case detail appended to it
const issueKey = (f) => String(f.problem || "").split(" — ")[0].trim();
const age = (f) => (Number.isFinite(f.ageHours) ? f.ageHours : -1);

function group(findings) {
  const buckets = new Map();
  for (const f of findings) {
    const k = `${f.owner || "unassigned"}||${issueKey(f)}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(f);
  }

  const escalations = [], grouped = [], singles = [];

  for (const [, list] of buckets) {
    list.sort((a, b) => age(b) - age(a));            // oldest first, they matter most
    const first = list[0];
    const worst = list.reduce((a, b) => ((RANK[a.severity] ?? 9) <= (RANK[b.severity] ?? 9) ? a : b));

    if (list.length >= SETTINGS.CLUSTER_MIN) {
      const oldest = age(first);
      const item = {
        kind: list.length >= SETTINGS.ESCALATE_MIN ? "escalation" : "group",
        owner: first.owner,
        issue: issueKey(first),
        count: list.length,
        severity: worst.severity,
        oldestHours: oldest >= 0 ? oldest : null,
        action: first.action,
        stage: first.stage,
        cases: list.slice(0, SETTINGS.CLUSTER_SHOW_CASES).map((f) => ({
          caseId: f.caseId, caseName: f.caseName, ageHours: Number.isFinite(f.ageHours) ? f.ageHours : null,
        })),
        moreCases: Math.max(0, list.length - SETTINGS.CLUSTER_SHOW_CASES),
      };
      (item.kind === "escalation" ? escalations : grouped).push(item);
    } else {
      for (const f of list) singles.push(f);
    }
  }

  // biggest and most serious first
  const order = (a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9) || b.count - a.count;
  escalations.sort(order);
  grouped.sort(order);
  singles.sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9) || age(b) - age(a));

  return { escalations, grouped, singles };
}

// Wording for a group, so it reads as one problem rather than a repeated line.
function groupSentence(item) {
  const n = item.count;
  const who = item.owner && item.owner !== "unassigned" ? item.owner : "Unassigned";
  const oldest = item.oldestHours ? ` The oldest has been waiting ${Math.round(item.oldestHours)} business hours.` : "";
  if (item.kind === "escalation")
    return `${who} has ${n} cases with the same problem: ${lowerFirst(item.issue)}.${oldest} A backlog this size will not clear case by case and needs to be planned.`;
  return `${who} has ${n} cases where ${lowerFirst(item.issue)}.${oldest}`;
}
const lowerFirst = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);

module.exports = { group, groupSentence, issueKey };
