// config.js — HOF Petition Studio Compliance. SAFE TO EDIT.

// ---------------------------------------------------------------------------
// WHO IS IN SCOPE — leave empty to audit everybody.
// Add emails to limit the audit to certain staff, e.g. ["warda@hofmigration.com"].
// ---------------------------------------------------------------------------
const STAFF_IN_SCOPE = [];

// ---------------------------------------------------------------------------
// THE PETITION STUDIO TEAM
//
// Matched on NAME, because Petition Studio returns each assignee's name and email in
// the case record, and not every writer exists as a HubSpot user. Emails are resolved
// at run time from whichever source has them; nothing needs to be typed here.
//
// Spellings below were verified against HubSpot, and several differed from the list
// as first written: Aleena Najeeb (not Najeed), Kysha d'Abdon, Kushra Leigh Price,
// Sashalene Vas Vas, Neline Van Zyl.
// ---------------------------------------------------------------------------
const STAFF = [
  // ---- petition writers ----
  { name: "Aleena Najeeb",       role: "petition_writer" },
  { name: "Umme Aimon",          role: "petition_writer" },
  { name: "Tahir Khalil",        role: "petition_writer" },
  { name: "Kushra Leigh Price",  role: "petition_writer" },
  { name: "Faryal Khalid",       role: "petition_writer" },
  { name: "Aliza Ejaz",          role: "petition_writer" },
  { name: "Samra Goraya",        role: "petition_writer" },

  { name: "Fatima Khalid",       role: "petition_writer" },
  { name: "Samina Naseer",       role: "petition_writer" },

  // ---- brainstorm ----
  { name: "Kysha d'Abdon",       role: "brainstorm_specialist" },

  // ---- writers currently in training ----
  { name: "Stella",              role: "petition_writer", trainee: true },
  { name: "Sashalene Vas Vas",   role: "petition_writer", trainee: true },
  { name: "Yvette",              role: "petition_writer", trainee: true },
  { name: "Neline Van Zyl",      role: "petition_writer", trainee: true },
];

const TRAINEES = STAFF.filter((p) => p.trainee).map((p) => p.name.toLowerCase());
const DUAL_ROLE = STAFF.filter((p) => p.alsoReviewer).map((p) => p.name);

// Matches a name from the case record against the roster, tolerantly: a first name on
// its own matches, and so does a fuller surname than the roster carries.
function staffFor(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return null;
  return STAFF.find((p) => {
    const r = p.name.toLowerCase();
    if (r === n) return true;
    const rFirst = r.split(/\s+/)[0], nFirst = n.split(/\s+/)[0];
    return rFirst === nFirst && (r.includes(n) || n.includes(r) || r.split(/\s+/).length === 1 || n.split(/\s+/).length === 1);
  }) || null;
}
const isTrainee = (name) => { const p = staffFor(name); return !!(p && p.trainee); };

// ---------------------------------------------------------------------------
// STATUS MAP
// The API returns its own statuses, which do NOT line up 1:1 with the seven phases
// in the workflow document. In particular there is no status for the Brainstorm
// Session (Phase 3) or Client Review & Approval (Phase 6) — those are detected from
// the events timeline instead (see EVENT_MARKERS).
//
// warnHours  -> approaching the limit
// breachHours-> over the SLA
// null       -> client dependent, chased on a cadence instead (see CHASE)
// ---------------------------------------------------------------------------
const STATUS_SLA = {
  intake:            { phase: "1. Onboarding & Documents",      warnHours: null, breachHours: null, owner: "case_manager" },
  ai_reading:        { phase: "2. Case Analysis (AI reading)",  warnHours: 12,   breachHours: 24,   owner: "petition_writer" },
  profile_review:    { phase: "2. Writer Assignment & Case Analysis", warnHours: 48, breachHours: 72, owner: "petition_writer" },
  advanced_review:   { phase: "3. Advanced Review / Brainstorm", warnHours: 48,  breachHours: 72,   owner: "petition_writer" },
  ai_drafting:       { phase: "4. Drafting",                    warnHours: 24,   breachHours: 48,   owner: "petition_writer" },
  internal_review:   { phase: "5. Internal Review",             warnHours: 24,   breachHours: 48,   owner: "reviewer" },
  ready_to_file:     { phase: "7. Finalization",                warnHours: 12,   breachHours: 24,   owner: "case_manager" },
};

// Client-dependent stages have no SLA, so the team is measured on THEIR action.
const CHASE = {
  intake: [
    { afterDays: 3,  message: "client has not started uploading documents", severity: "medium" },
    { afterDays: 7,  message: "still no documents from the client",         severity: "high" },
    { afterDays: 14, message: "no documents for two weeks, needs escalation", severity: "critical" },
  ],
  // used for phases detected from events rather than status
  brainstorm: [
    { afterDays: 3,  message: "brainstorm session still not confirmed", severity: "medium" },
    { afterDays: 7,  message: "brainstorm session unconfirmed for a week", severity: "high" },
  ],
  client_review: [
    { afterDays: 5,  message: "no client response on the shared package", severity: "medium" },
    { afterDays: 10, message: "client has not responded for ten days",    severity: "high" },
  ],
};

// Phrases used to spot the phases the API has no status for. Tune after discovery.
const EVENT_MARKERS = {
  brainstormScheduled: /brainstorm.*(schedul|confirm|slot|book)/i,
  brainstormDone:      /brainstorm.*(complet|conduct|done|held|session)/i,
  packageShared:       /(shared|sent|deliver).*(client|package|draft)/i,
  clientApproved:      /(client).*(approv|sign.?off|confirm)/i,
  documentRequested:   /(request|missing|pending).*(document|evidence)/i,
  documentUploaded:    /(upload|received).*(document|file|evidence)/i,
  reviewAmendments:    /(amend|revision|change).*(request|required|raised)/i,
  reviewSignoff:       /(sign.?off|review complete|approved by reviewer)/i,
};


// ---------------------------------------------------------------------------
// PROBES — each one is a filtered query against the API, and each is a rule.
//
// This is the heart of the audit. Petition Studio already knows, authoritatively,
// where the brainstorm call stands, whether a client is sitting unapproved, what is
// waiting in a reviewer's queue and how long a document audit has been open. Asking
// it directly is far more accurate than reading the event text and guessing.
//
// Every probe runs with hold=hide, so cases legitimately paused are never flagged.
// `onlyStatuses` narrows a probe to the stages where it makes sense.
// ---------------------------------------------------------------------------
const PROBES = [
  // ---- critical: something has failed and needs a person today ----
  {
    id: "brainstorm_overdue", risk: 'Avoid drafting from a call nobody captured. The endeavour statement ends up built on memory, and the gaps only surface at review when they cost more to fix.', filter: { brainstorm: "overdue" },
    area: "control", severity: "critical", owner: "brainstorm_specialist",
    problem: "The brainstorm slot has passed and nothing was captured, no transcript or summary",
    action: "capture the brainstorm outcome, or rebook the call",
  },
  {
    id: "drafting_escalated", risk: 'Avoid leaving it in the loop. It will never clear itself, and the case ages with nobody actually holding it.', filter: { drafting_health: "escalated" },
    area: "control", severity: "critical", owner: "petition_writer",
    problem: "The automated review loop hit its retry limit without ever approving the draft",
    action: "resolve this case by hand, it will not clear itself",
  },

  // ---- high: the process has stalled on us, not on the client ----
  {
    id: "no_reviewer", risk: 'Avoid the case reaching filing without an independent read. The review exists so the writer is not the last person to see it.', filter: { reviewer_queue: "no_reviewer" },
    area: "assign", severity: "high", owner: "case_manager",
    problem: "No reviewer is assigned to this case",
    action: "assign a reviewer",
  },
  {
    id: "review_unanswered", risk: 'Avoid leaving the writer blocked. They cannot move on, and the stage clock keeps running against them, not the reviewer.', filter: { reviewer_queue: "awaiting_me" },
    area: "control", severity: "high", owner: "reviewer",
    problem: "The writer asked for a review and no reviewer has responded",
    action: "pick this case up for review",
  },
  {
    id: "intake_needs_review", risk: 'Avoid making the client wait immediately after they did what we asked. It is the point where confidence is easiest to lose.', filter: { intake_state: "needs_review" },
    area: "sla", severity: "high", owner: "case_manager",
    problem: "The client has submitted their intake form and nobody has reviewed it",
    action: "review the submitted intake form",
  },
  {
    id: "audit_over_5d", risk: 'Avoid document problems surfacing after drafting has started. Anything found late means rework, not a correction.', filter: { audit_age: "over_5d" },
    area: "sla", severity: "high", owner: "processor",
    problem: "The document audit has been open for more than 5 days",
    action: "complete the document audit",
  },
  {
    id: "never_invited", risk: 'Avoid the case sitting at intake with no way for the client to send anything. Nothing else can start until this is done.', filter: { client_portal: "never_invited" },
    area: "control", severity: "high", owner: "case_manager",
    problem: "The client has never been invited to the portal",
    action: "send the client their portal invitation",
  },
  {
    id: "brainstorm_needs_booking", risk: 'Avoid reaching drafting without the endeavour discussion. Writing first and asking later produces a petition that has to be rebuilt.', filter: { brainstorm_followup: "needs_booking" },
    area: "chase", severity: "high", owner: "case_manager",
    problem: "The case is at case analysis and brainstorm, and no call time has been picked",
    action: "coordinate the client and pick a brainstorm slot",
  },
  {
    id: "approval_over_week", risk: 'Avoid silence hardening into a lost case. The longer a client sits with an unapproved petition, the harder it is to restart.', filter: { client_approval: "waiting_over_week" },
    area: "chase", severity: "high", owner: "case_manager",
    problem: "The petition has been with the client for over a week with no approval",
    action: "chase the client for their approval",
  },
  {
    id: "stale_stage", risk: 'Avoid a case quietly ageing. Nothing is wrong with it except that nobody has touched it, which is how cases get lost rather than lost on merit.', filter: { stage_age: "stale" },
    area: "stalled", severity: "high", owner: null,
    problem: "The case has been sitting in the same stage for more than two weeks",
    action: "move this case forward or escalate it",
  },

  // ---- medium: worth attention before it becomes a problem ----
  {
    id: "audit_over_2d", risk: 'Keep the audit moving so the writer is not waiting on documents.', informational: true, filter: { audit_age: "over_2d" },
    area: "sla", severity: "medium", owner: "processor",
    problem: "The document audit has been open for more than 2 days",
    action: "complete the document audit",
    supersededBy: "audit_over_5d",
  },
  {
    id: "approval_waiting", risk: 'Keep the client engaged so the approval does not drift.', informational: true, filter: { client_approval: "waiting" },
    area: "chase", severity: "medium", owner: "case_manager",
    problem: "The petition is with the client and not yet approved",
    action: "keep the client moving toward approval",
    supersededBy: "approval_over_week",
  },
  {
    id: "portal_not_activated", risk: 'The client cannot upload anything until the account is set up.', informational: true, filter: { client_portal: "invited_not_activated" },
    area: "chase", severity: "medium", owner: "case_manager",
    problem: "The client was invited to the portal but never finished setting it up",
    action: "help the client activate their portal account",
  },
  {
    id: "brainstorm_unconfirmed", risk: 'An unconfirmed slot is not a booking; it will quietly pass.', informational: true, filter: { brainstorm: "awaiting_confirmation" },
    area: "chase", severity: "medium", owner: "case_manager",
    problem: "A brainstorm time was picked but never confirmed",
    action: "confirm the brainstorm slot with the client",
  },
  {
    id: "reschedule_requested", risk: 'Agree the new time before the old one lapses.', informational: true, filter: { brainstorm: "reschedule_requested" },
    area: "chase", severity: "medium", owner: "case_manager",
    problem: "Somebody asked to move the confirmed brainstorm slot",
    action: "agree a new brainstorm time and confirm it",
  },
  {
    id: "audit_changes_requested", risk: 'The case is waiting on the client, so it needs chasing rather than watching.', informational: true, filter: { audit_state: "changes_requested" },
    area: "chase", severity: "medium", owner: "processor",
    problem: "The document audit was sent back to the client for changes",
    action: "chase the client for the corrected documents",
  },
  {
    id: "intake_awaiting", risk: 'Nothing can start until the form arrives.', informational: true, filter: { intake_state: "awaiting" },
    area: "chase", severity: "medium", owner: "case_manager",
    problem: "Still waiting on the client to submit their intake form",
    action: "chase the client for the intake form",
  },

  // ---- quality: the analyst's read on the case ----
  {
    id: "verdict_no_go", risk: 'Avoid taking a case forward the analyst judged not ready. Strengthen it now, or the weakness travels all the way to filing.', filter: { analysis_verdict: "no_go" },
    area: "quality", severity: "high", owner: "petition_writer",
    problem: "The case analysis verdict is NO GO, the case is not ready to file",
    action: "strengthen the case before it goes any further",
  },
  {
    id: "verdict_weak", risk: 'Address the weak points while there is still time to strengthen them.', informational: true, filter: { analysis_verdict: "weak" },
    area: "quality", severity: "medium", owner: "petition_writer",
    problem: "The case analysis verdict is WEAK, there are real concerns about positioning",
    action: "review the weak points before drafting goes further",
    supersededBy: "verdict_no_go",
  },
];

// A NO GO or WEAK verdict on a case that is already at the filing stage is far more
// serious than the same verdict early on. These statuses raise it to critical.
const LATE_STAGES = ["ai_drafting", "internal_review", "ready_to_file"];

const SETTINGS = {
  DRY_RUN: process.env.DRY_RUN_INPUT ? process.env.DRY_RUN_INPUT === "true" : true,

  API_BASE: process.env.PETITION_API_BASE || "https://api.petition.hofmigration.com",
  DASHBOARD: "https://petition.hofmigration.com/dashboard",

  // ---- report ----
  REPORT_TO: process.env.REPORT_TO || "razaali@hofmigration.com",
  REPORT_CC: [],
  FROM_EMAIL: process.env.FROM_EMAIL || "onboarding@resend.dev",

  // ---- scope ----
  STAFF_IN_SCOPE,
  // Only cases from this year. Older cases are historic backlog and drown the report;
  // they are counted, not listed. Set to null to include everything.
  ONLY_CASES_FROM: "2026-01-01",
  // Findings on a trainee writer's case are raised one level, because their work is
  // meant to be watched more closely while they are still in training.
  ESCALATE_FOR_TRAINEES: true,
  // Statuses that mean the case is finished and no longer chased.
  CLOSED_STATUSES: ["filed", "closed", "cancelled", "withdrawn"],

  // ---- business time ----
  // The API now returns stage.age_hours already counted in business hours on the
  // company's own calendar, and stage.clock_start_at restarts the clock on the real
  // waiting event. That figure is used whenever it is present, because it matches the
  // SLA policy exactly. The settings below only apply to the fallback path when the
  // stage object is missing.
  PREFER_API_STAGE_HOURS: true,
  USE_BUSINESS_HOURS: true,
  WEEKEND_DAYS: [0, 6],
  BUSINESS_DAY_HOURS: 9,          // hours counted per business day
  TZ_OFFSET_HOURS: 5,             // PKT

  // A case with no event at all for this long is stalled, whatever its status.
  STALLED_AFTER_DAYS: 7,

  // ---- GROUPING: one problem, not fifty tickets ----
  // A run once produced 37 identical "brainstorm overdue" criticals, all belonging to
  // one person. That is not 37 failures, it is one backlog. Findings that share the
  // same owner AND the same issue are grouped, and a big enough group is escalated as
  // a systemic problem rather than repeated case by case.
  CLUSTER_MIN: 4,          // same owner + same issue, this many or more -> one grouped item
  ESCALATE_MIN: 8,         // a group this big is a systemic problem, escalated
  CLUSTER_SHOW_CASES: 5,   // example cases named inside a group (the oldest first)

  // ---- HOW MUCH IS REPORTED ----
  // A report of two thousand findings is not a report. Only things that need somebody
  // to act TODAY are listed case by case; everything else is counted, not listed.
  //
  // ITEMISED: severity at or above this, one line per case.
  ITEMISE_FROM: "high",          // "critical" for the very shortest report
  // At most this many findings per case in the itemised list — the worst one only.
  MAX_PER_CASE: 1,
  // Hard ceiling on the itemised list, so the report never becomes unreadable.
  MAX_ITEMISED: 30,
  // Everything below ITEMISE_FROM is rolled into a count per type.
  SUMMARISE_THE_REST: true,

  // ---- limits ----
  MAX_CASES: (() => { const r = (process.env.LIMIT_INPUT || "all").toLowerCase(); if (!r || r === "all" || r === "0") return 0; const n = parseInt(r, 10); return n > 0 ? n : 0; })(),
  CONCURRENCY: 4,

  // Run the filtered probes above. This is the main audit.
  USE_PROBES: true,
  // Also read each case's timeline for the checks the filters cannot answer
  // (reviewer independence, notification flags, skipped stages, exact stage hours).
  // Slower, because it is one request per case.
  READ_TIMELINES: process.env.READ_TIMELINES_INPUT ? process.env.READ_TIMELINES_INPUT === "true" : true,

  // ---- toggles ----
  CHECK_SLA: true,             // time in the current stage vs the SLA
  CHECK_STALLED: true,         // no activity at all
  CHECK_ASSIGNMENTS: true,     // writer / reviewer / CM assigned for the stage
  CHECK_NOTIFICATIONS: true,   // assignee assigned but never notified
  CHECK_INDEPENDENCE: true,    // the reviewer must not be the writer
  CHECK_SEQUENCE: true,        // stages must not be skipped
  CHECK_DOCUMENTS: true,       // requested documents never supplied
  CHECK_BRAINSTORM: true,      // phase 3, from events
  CHECK_CLIENT_REVIEW: true,   // phase 6, from events
  CHECK_APPROVAL_BEFORE_FILING: true, // ready to file with no client approval

  // ---- the checks that need the FULL case record (Case Search API) ----
  READ_FULL_CASE: process.env.READ_FULL_CASE_INPUT ? process.env.READ_FULL_CASE_INPUT === "true" : true,
  CHECK_ELIGIBILITY: true,       // EB-2 floor from the intake profile
  CHECK_DOCUMENT_PRESENCE: true, // core documents uploaded
  CHECK_PETITION_PARTS: true,    // endeavour statement, cover letter, exhibit list, CV
  CHECK_FORMS: true,             // USCIS forms prepared, signed, checked
  CHECK_SUPPORTING: true,        // recommendation letters and business plan

  // ---- the reviewer loop (v2 fields) ----
  CHECK_AMENDMENTS: true,        // raised -> applied -> verified must close
  AMENDMENT_APPLY_HOURS: 24,     // writer has this long to apply a raised amendment
  AMENDMENT_VERIFY_HOURS: 24,    // reviewer has this long to verify an applied one
  CHECK_REVIEW_RESPONSE: true,   // writer asked for review and nobody responded
  REVIEW_RESPONSE_HOURS: 24,

  // NOTE: reviewer SIGN-OFF is not checked, and cannot be. Petition Studio has no
  // "reviewer approved" action, so no field carries that meaning. The closest one,
  // reviewer_last_sent_back_at, means the reviewer sent work BACK for fixes.
  // Adding a sign-off action to the app is the only way to audit this.
};

module.exports = { STATUS_SLA, CHASE, EVENT_MARKERS, PROBES, LATE_STAGES, SETTINGS, STAFF_IN_SCOPE,
  STAFF, TRAINEES, DUAL_ROLE, staffFor, isTrainee };
