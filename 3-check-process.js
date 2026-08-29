// 3-check-process.js — the control checks. These are the ones that matter most,
// because a breached SLA costs time but a failed control costs a case.
const { STATUS_SLA, CHASE, SETTINGS } = require("./config");

const ORDER = ["intake", "ai_reading", "profile_review", "advanced_review", "ai_drafting", "internal_review", "ready_to_file"];
const idx = (s) => ORDER.indexOf(s);
const person = (p) => (p && (p.name || p.email)) || null;

module.exports = function checkProcess(c, t) {
  const issues = [];
  const status = c.status;
  const rule = STATUS_SLA[status] || {};
  const stage = idx(status);

  // ---- the reviewer must not be the writer ----
  if (SETTINGS.CHECK_INDEPENDENCE && c.reviewer?.id && c.petition_writer?.id &&
      String(c.reviewer.id) === String(c.petition_writer.id))
    issues.push({ area: "control", severity: "critical", owner: "reviewer",
      problem: `The reviewer and the writer are the same person (${person(c.reviewer)}) — the review is not independent`,
      action: "assign a different reviewer to this case" });

  // ---- ready to file without recorded client approval ----
  if (SETTINGS.CHECK_APPROVAL_BEFORE_FILING && status === "ready_to_file" && !t.clientApproved)
    issues.push({ area: "control", severity: "critical", owner: "case_manager",
      problem: "Case is Ready to File but no written client approval is recorded",
      action: "capture the written client approval before this case is filed" });

  // ---- internal review passed with no sign-off ----
  if (stage > idx("internal_review") && !t.reviewSignedOff)
    issues.push({ area: "control", severity: "high", owner: "reviewer",
      problem: "Case moved past internal review with no reviewer sign-off recorded",
      action: "record the reviewer sign-off in Petition Studio" });

  // ---- amendments raised but never signed off ----
  if (t.amendmentsRaised && !t.reviewSignedOff && stage >= idx("internal_review"))
    issues.push({ area: "control", severity: "high", owner: "reviewer",
      problem: "Review amendments were raised but never verified or signed off",
      action: "verify the amendments and record the sign-off" });

  // ---- assignments ----
  if (SETTINGS.CHECK_ASSIGNMENTS) {
    if (stage >= idx("ai_reading") && !person(c.petition_writer))
      issues.push({ area: "assign", severity: "high", owner: "case_manager",
        problem: `Case is at ${rule.phase || status} with no petition writer assigned`,
        action: "assign a petition writer" });
    if (stage >= idx("internal_review") && !person(c.reviewer))
      issues.push({ area: "assign", severity: "high", owner: "case_manager",
        problem: "Case is at internal review with no reviewer assigned",
        action: "assign a reviewer" });
    if (!person(c.case_manager))
      issues.push({ area: "assign", severity: "medium", owner: "case_manager",
        problem: "No case manager is assigned to this case",
        action: "assign a case manager" });
  }

  // ---- assigned but never told ----
  if (SETTINGS.CHECK_NOTIFICATIONS) {
    for (const role of ["case_manager", "petition_writer", "reviewer", "processor", "brainstorm_specialist"]) {
      if (person(c[role]) && c[`${role}_notified`] === false)
        issues.push({ area: "notify", severity: "medium", owner: role,
          problem: `${person(c[role])} is assigned as ${role.replace(/_/g, " ")} but has never been notified`,
          action: `notify the assigned ${role.replace(/_/g, " ")}` });
    }
  }

  // ---- stages skipped ----
  if (SETTINGS.CHECK_SEQUENCE && t.stageHistory.length > 1) {
    for (let i = 1; i < t.stageHistory.length; i++) {
      const from = idx(t.stageHistory[i - 1].status), to = idx(t.stageHistory[i].status);
      if (from >= 0 && to > from + 1)
        issues.push({ area: "sequence", severity: "high", owner: rule.owner,
          problem: `Case jumped from ${t.stageHistory[i - 1].status} straight to ${t.stageHistory[i].status}, skipping a stage`,
          action: "check the skipped stage was actually completed" });
    }
  }

  // ---- drafting started without a brainstorm ----
  if (SETTINGS.CHECK_BRAINSTORM && stage >= idx("ai_drafting") && !t.brainstormDone)
    issues.push({ area: "control", severity: "high", owner: "petition_writer",
      problem: "Drafting started with no completed brainstorm session recorded",
      action: "record the brainstorm session outcomes, or hold drafting until it is done" });

  // ---- brainstorm ready but never confirmed ----
  if (SETTINGS.CHECK_BRAINSTORM && status === "advanced_review" && !t.brainstormScheduled) {
    const days = t.stageSince ? (Date.now() - t.stageSince) / 86400000 : 0;
    const hit = [...(CHASE.brainstorm || [])].reverse().find((s) => days >= s.afterDays);
    if (hit) issues.push({ area: "chase", severity: hit.severity, owner: "case_manager",
      problem: `${hit.message} (${Math.floor(days)} days in this stage)`,
      action: "coordinate the client and confirm the brainstorm slot in Petition Studio" });
  }

  // ---- package shared, client silent ----
  if (SETTINGS.CHECK_CLIENT_REVIEW && t.packageShared && !t.clientApproved && t.packageSharedAt) {
    const days = (Date.now() - t.packageSharedAt) / 86400000;
    const hit = [...(CHASE.client_review || [])].reverse().find((s) => days >= s.afterDays);
    if (hit) issues.push({ area: "chase", severity: hit.severity, owner: "case_manager",
      problem: `${hit.message} (${Math.floor(days)} days since it was shared)`,
      action: "chase the client for their review and approval" });
  }

  // ---- documents requested and never supplied ----
  if (SETTINGS.CHECK_DOCUMENTS && t.documentRequested && t.documentRequestedAt &&
      (!t.documentUploadedAt || t.documentUploadedAt < t.documentRequestedAt)) {
    const days = (Date.now() - t.documentRequestedAt) / 86400000;
    if (days >= 3)
      issues.push({ area: "documents", severity: days >= 7 ? "high" : "medium", owner: "processor",
        problem: `Documents were requested ${Math.floor(days)} days ago and nothing has been uploaded since`,
        action: "chase the outstanding documents and record it in Petition Studio" });
  }

  // ---- nothing happening at all ----
  if (SETTINGS.CHECK_STALLED && t.daysSinceLastEvent !== null && t.daysSinceLastEvent >= SETTINGS.STALLED_AFTER_DAYS)
    issues.push({ area: "stalled", severity: t.daysSinceLastEvent >= SETTINGS.STALLED_AFTER_DAYS * 2 ? "critical" : "high",
      owner: rule.owner,
      problem: `No activity of any kind for ${Math.floor(t.daysSinceLastEvent)} days`,
      action: "pick this case up or escalate it" });

  return issues;
};
module.exports.ORDER = ORDER;
