// 2-check-sla.js — time in the current stage against the SLA, and the chase cadence
// for the client-dependent stages that have no SLA at all.
const { STATUS_SLA, CHASE, SETTINGS } = require("./config");

const round = (h) => Math.round(h * 10) / 10;

module.exports = function checkSla(c, t) {
  const issues = [];
  const status = c.status;
  const rule = STATUS_SLA[status];

  if (!rule) {
    return [{ area: "unknown", severity: "medium",
      problem: `Unknown case status "${status}" — no rule is defined for it`,
      action: "add this status to STATUS_SLA in config.js" }];
  }

  // client dependent -> chase cadence rather than a breach
  if (!rule.breachHours) {
    const days = t.stageSince ? (Date.now() - t.stageSince) / 86400000 : 0;
    const steps = CHASE[status] || [];
    const hit = [...steps].reverse().find((s) => days >= s.afterDays);
    if (hit)
      issues.push({ area: "chase", severity: hit.severity, owner: rule.owner,
        problem: `${rule.phase}: ${hit.message} (${Math.floor(days)} days)`,
        action: "chase the client and record the contact in Petition Studio" });
    return issues;
  }

  if (!SETTINGS.CHECK_SLA) return issues;
  const h = t.hoursInStage;
  if (h >= rule.breachHours * 2)
    issues.push({ area: "sla", severity: "critical", owner: rule.owner,
      problem: `${rule.phase}: ${round(h)} working hours in stage, more than double the ${rule.breachHours}h SLA`,
      action: "move this case forward today or escalate it" });
  else if (h >= rule.breachHours)
    issues.push({ area: "sla", severity: "high", owner: rule.owner,
      problem: `${rule.phase}: ${round(h)} working hours in stage, over the ${rule.breachHours}h SLA`,
      action: "move this case forward" });
  else if (rule.warnHours && h >= rule.warnHours)
    issues.push({ area: "sla", severity: "medium", owner: rule.owner,
      problem: `${rule.phase}: ${round(h)} working hours in stage, approaching the ${rule.breachHours}h SLA`,
      action: "keep this case moving before it breaches" });

  return issues;
};
