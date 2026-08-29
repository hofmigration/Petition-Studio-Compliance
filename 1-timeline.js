// 1-timeline.js — turns a case plus its events into the facts the checks need:
// when the current stage began, what the stage history was, and whether the
// milestones that have no status (brainstorm, client review, approval) happened.
const { EVENT_MARKERS, STATUS_SLA, SETTINGS } = require("./config");

const ts = (v) => (v ? Date.parse(v) || 0 : 0);
const text = (e) => `${e.action || ""} ${e.title || ""} ${e.detail || ""}`;

// Business-hours difference. SLAs in the workflow are working time, so a case that
// sits over a weekend is not treated as breached.
function hoursBetween(from, to) {
  if (!from) return 0;
  const end = to || Date.now();
  if (!SETTINGS.USE_BUSINESS_HOURS) return (end - from) / 3600000;

  const off = SETTINGS.TZ_OFFSET_HOURS * 3600000;
  const dayOf = (t) => Math.floor((t + off) / 86400000);
  const dow = (t) => new Date(t + off).getUTCDay();
  const weekend = new Set(SETTINGS.WEEKEND_DAYS);

  let hours = 0;
  const startDay = dayOf(from), endDay = dayOf(end);
  if (startDay === endDay) return weekend.has(dow(from)) ? 0 : (end - from) / 3600000;

  // partial first day
  if (!weekend.has(dow(from))) {
    const endOfFirst = (startDay + 1) * 86400000 - off;
    hours += (endOfFirst - from) / 3600000;
  }
  // whole days between
  for (let d = startDay + 1; d < endDay; d++) {
    const noon = d * 86400000 - off + 43200000;
    if (!weekend.has(dow(noon))) hours += SETTINGS.BUSINESS_DAY_HOURS;
  }
  // partial last day
  if (!weekend.has(dow(end))) {
    const startOfLast = endDay * 86400000 - off;
    hours += (end - startOfLast) / 3600000;
  }
  return Math.max(0, hours);
}

function analyse(caseRow, history) {
  const events = ((history && history.events) || [])
    .map((e) => ({ ...e, at: ts(e.created_at) }))
    .filter((e) => e.at)
    .sort((a, b) => a.at - b.at);

  const status = caseRow.status || null;
  const known = Object.keys(STATUS_SLA);

  // Stage history: any event whose text names a known status is treated as a move.
  const moves = [];
  for (const e of events) {
    const t = text(e).toLowerCase();
    for (const s of known) {
      const spaced = s.replace(/_/g, " ");
      if (t.includes(s) || t.includes(spaced)) {
        if (!moves.length || moves[moves.length - 1].status !== s) moves.push({ status: s, at: e.at });
        break;
      }
    }
  }

  const lastMoveToCurrent = [...moves].reverse().find((m) => m.status === status);
  const firstEvent = events[0]?.at || 0;
  const lastEvent = events[events.length - 1]?.at || 0;

  const has = (re) => events.some((e) => re.test(text(e)));
  const lastAt = (re) => { const hit = [...events].reverse().find((e) => re.test(text(e))); return hit ? hit.at : 0; };

  return {
    events,
    eventCount: events.length,
    firstEvent,
    lastEvent,
    // when the current stage began: the last move into it, else the first event, else intake time
    stageSince: lastMoveToCurrent?.at || firstEvent || ts(caseRow.intake_reviewed_at) || ts(caseRow.intro_form_uploaded_at) || 0,
    stageHistory: moves,
    hoursInStage: hoursBetween(lastMoveToCurrent?.at || firstEvent || 0),
    daysSinceLastEvent: lastEvent ? (Date.now() - lastEvent) / 86400000 : null,

    // the phases the API has no status for
    brainstormScheduled: has(EVENT_MARKERS.brainstormScheduled),
    brainstormScheduledAt: lastAt(EVENT_MARKERS.brainstormScheduled),
    brainstormDone: has(EVENT_MARKERS.brainstormDone),
    packageShared: has(EVENT_MARKERS.packageShared),
    packageSharedAt: lastAt(EVENT_MARKERS.packageShared),
    clientApproved: has(EVENT_MARKERS.clientApproved),
    clientApprovedAt: lastAt(EVENT_MARKERS.clientApproved),
    documentRequested: has(EVENT_MARKERS.documentRequested),
    documentRequestedAt: lastAt(EVENT_MARKERS.documentRequested),
    documentUploadedAt: lastAt(EVENT_MARKERS.documentUploaded),
    amendmentsRaised: has(EVENT_MARKERS.reviewAmendments),
    reviewSignedOff: has(EVENT_MARKERS.reviewSignoff),
  };
}

module.exports = { analyse, hoursBetween, ts, text };
