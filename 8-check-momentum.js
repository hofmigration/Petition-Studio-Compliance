// 8-check-momentum.js — THE CASE THAT WAS MOVING AND SUDDENLY STOPPED.
//
// Why this exists: in a caseload where 188 cases have been static for over two weeks,
// "this case is stuck" is the baseline, not a signal. Reporting it tells nobody
// anything they did not already know.
//
// What IS a signal is a case that was genuinely progressing — several events in the
// recent past — and then went silent. Somebody was working it, and stopped. That is
// the case worth interrupting someone about, and it is invisible to a stage-age filter
// because the stage clock says nothing about whether anyone was actually working.
//
// A case dormant for months does not qualify: there is no momentum to have lost.
const { SETTINGS } = require("./config");

const ts = (v) => Date.parse(v || 0) || 0;

function analyseMomentum(events) {
  const list = (events || []).map((e) => ts(e.created_at)).filter(Boolean).sort((a, b) => a - b);
  if (!list.length) return null;

  const now = Date.now();
  const last = list[list.length - 1];
  const gapDays = (now - last) / 86400000;

  // how much work happened in the window before it went quiet
  const activeFrom = last - SETTINGS.MOMENTUM_LOOKBACK_DAYS * 86400000;
  const before = list.filter((t) => t >= activeFrom).length;

  return { last, gapDays, eventsBefore: before, total: list.length };
}

// How long silence is normal here. Drafting gets over a week; nothing sits at filing.
const stopDaysFor = (status) => {
  const map = SETTINGS.MOMENTUM_STOP_DAYS_BY_STAGE || {};
  const v = map[String(status || "").toLowerCase()];
  return Number.isFinite(v) ? v : SETTINGS.MOMENTUM_STOP_DAYS;
};

module.exports = function checkMomentum(caseRow, history) {
  if (!SETTINGS.CHECK_MOMENTUM) return [];
  const m = analyseMomentum((history && (history.events || history.history)) || []);
  if (!m) return [];

  // it has to have been moving for a stop to mean anything
  if (m.eventsBefore < SETTINGS.MOMENTUM_MIN_EVENTS) return [];

  // the threshold is the STAGE's own. A drafting case quiet for a week is normal;
  // a case at Ready to File quiet for a week is not.
  const limit = stopDaysFor(caseRow && caseRow.status);
  if (m.gapDays < limit) return [];
  // dormant for months: no momentum was lost, this is old backlog and is counted elsewhere
  if (m.gapDays > SETTINGS.MOMENTUM_MAX_GAP_DAYS) return [];

  const days = Math.floor(m.gapDays);
  // severity is relative to what is normal for THIS stage, not an absolute day count
  const over = m.gapDays / limit;
  const severity = over >= 3 ? "critical" : over >= 2 ? "high" : "medium";
  const pace = m.eventsBefore >= 8 ? "moving quickly" : "moving steadily";

  return [{
    area: "momentum",
    severity,
    owner: null,                       // resolved by the runner from the case
    problem: `Was ${pace} — ${m.eventsBefore} updates in the weeks before — then stopped ${days} days ago, when ${limit} days is normal at this stage`,
    action: "pick this case back up, or say plainly what it is waiting on",
    risk: "Avoid a case going quiet mid-flight. Nobody notices, because it does not look old — it looks recent, right up until the client asks why nothing has happened.",
  }];
};
module.exports.analyseMomentum = analyseMomentum;
