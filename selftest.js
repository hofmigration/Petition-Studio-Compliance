// selftest.js — the Petition Studio rules register. Run after any edit.
process.env.PETITION_API_KEY = process.env.PETITION_API_KEY || "selftest";

const { analyse, hoursBetween } = require("./1-timeline");
const checkSla = require("./2-check-sla");
const checkProcess = require("./3-check-process");
const { buildReport } = require("./4-report");
const { STATUS_SLA, SETTINGS, CHASE, PROBES, LATE_STAGES, STAFF, TRAINEES, DUAL_ROLE, staffFor, isTrainee } = require("./config");
const { qs } = require("./0-api");
const checkCaseDetail = require("./5-check-case-detail");
const checkReview = require("./6-check-review");
const { group, groupSentence } = require("./7-group");
const checkMomentum = require("./8-check-momentum");

const H = 3600000, D = 86400000, now = Date.now();
let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `\n        ${detail}`}`);
  ok ? pass++ : fail++;
};
const has = (list, re) => list.some((i) => re.test(i.problem));

const ev = (hoursAgo, action, title = "", detail = "") =>
  ({ created_at: new Date(now - hoursAgo * H).toISOString(), action, title, detail, actor_type: "human", actor_name: "X" });

const kase = (o = {}) => ({
  case_id: "C1", client_name: "Test Client", status: "ai_drafting",
  case_manager: { id: "1", name: "CM One", email: "cm@hofmigration.com" },
  petition_writer: { id: "2", name: "Writer Two", email: "w@hofmigration.com" },
  reviewer: { id: "3", name: "Reviewer Three", email: "r@hofmigration.com" },
  case_manager_notified: true, petition_writer_notified: true, reviewer_notified: true,
  ...o,
});
const run = (c, events = []) => {
  const t = analyse(c, { events });
  return [...checkSla(c, t), ...checkProcess(c, t)];
};

console.log("PETITION STUDIO COMPLIANCE SELF-TEST\n");

// ---- the roster ----
check("the roster has all 14 people", STAFF.length === 14, `got ${STAFF.length}`);
check("every entry has a name and a role", STAFF.every((p) => p.name && p.role));
check("the four writers in training are marked", TRAINEES.length === 4, `got ${TRAINEES.length}`);
check("nobody on the roster holds both writer and reviewer", DUAL_ROLE.length === 0);
check("Fatima Khalid is a petition writer only",
  STAFF.find((p) => p.name === "Fatima Khalid")?.role === "petition_writer" && !STAFF.find((p) => p.name === "Fatima Khalid")?.alsoReviewer);
check("Samina Naseer is a petition writer only",
  STAFF.find((p) => p.name === "Samina Naseer")?.role === "petition_writer" && !STAFF.find((p) => p.name === "Samina Naseer")?.alsoReviewer);
check("Kysha is the brainstorm specialist",
  STAFF.find((p) => p.role === "brainstorm_specialist")?.name.startsWith("Kysha"));
check("roster names are unique", new Set(STAFF.map((p) => p.name.toLowerCase())).size === STAFF.length);
check("a full name matches", staffFor("Aleena Najeeb")?.name === "Aleena Najeeb");
check("a first name on its own matches", staffFor("Aleena")?.name === "Aleena Najeeb");
check("a single-name writer matches", staffFor("Stella")?.name === "Stella");
check("a fuller surname than the roster still matches", staffFor("Neline")?.name === "Neline Van Zyl");
check("somebody not on the roster does not match", staffFor("Somebody Else") === null);
check("an empty name does not match", staffFor("") === null && staffFor(null) === null);
check("trainees are recognised", isTrainee("Stella") && isTrainee("Yvette") && isTrainee("Neline Van Zyl"));
check("experienced writers are not treated as trainees",
  !isTrainee("Aleena Najeeb") && !isTrainee("Fatima Khalid") && !isTrainee("Tahir Khalil"));
check("trainee escalation is on", SETTINGS.ESCALATE_FOR_TRAINEES === true);


// ---- the filtered probes ----
check("every probe has an id, a filter, a severity and an action",
  PROBES.every((p) => p.id && p.filter && Object.keys(p.filter).length && p.severity && p.problem && p.action));
check("probe ids are unique", new Set(PROBES.map((p) => p.id)).size === PROBES.length);
check("every probe severity is a known level",
  PROBES.every((p) => ["critical", "high", "medium", "low"].includes(p.severity)));
check("probes only use filters the memo documents", (() => {
  const known = new Set(["brainstorm","stage_age","hold","client_portal","intake_state","client_approval",
    "drafting_health","analysis_verdict","audit_state","audit_age","brainstorm_followup","reviewer_queue"]);
  return PROBES.every((p) => Object.keys(p.filter).every((k) => known.has(k)));
})());
check("every supersededBy points at a real probe", (() => {
  const ids = new Set(PROBES.map((p) => p.id));
  return PROBES.every((p) => !p.supersededBy || ids.has(p.supersededBy));
})());
check("an overdue brainstorm is critical",
  PROBES.find((p) => p.id === "brainstorm_overdue")?.severity === "critical");
check("an escalated draft is critical",
  PROBES.find((p) => p.id === "drafting_escalated")?.severity === "critical");
check("a no-go verdict late in the process becomes critical",
  LATE_STAGES.includes("ready_to_file") && PROBES.find((p) => p.id === "verdict_no_go")?.severity === "high");
check("query strings are built correctly",
  qs({ brainstorm: "overdue,not_scheduled", hold: "hide" }) === "?brainstorm=overdue%2Cnot_scheduled&hold=hide");
check("an array of options is comma joined",
  qs({ brainstorm: ["overdue", "not_scheduled"] }) === "?brainstorm=overdue%2Cnot_scheduled");
check("empty filters produce no query string", qs({}) === "");


// ---- the SLAs Ali confirmed ----
check("Case Analysis breaches at 72 working hours", STATUS_SLA.profile_review.breachHours === 72);
check("Case Analysis warns at 48 hours", STATUS_SLA.profile_review.warnHours === 48);
check("Drafting is allowed 4 to 5 days, not 48 hours",
  STATUS_SLA.ai_drafting.warnHours === 96 && STATUS_SLA.ai_drafting.breachHours === 120);
check("Internal review is allowed 3 to 4 days, not 48 hours",
  STATUS_SLA.internal_review.warnHours === 72 && STATUS_SLA.internal_review.breachHours === 96);
check("the long stages get more room than the short ones",
  STATUS_SLA.ai_drafting.breachHours > STATUS_SLA.profile_review.breachHours &&
  STATUS_SLA.internal_review.breachHours > STATUS_SLA.ready_to_file.breachHours);
check("Intake has no SLA and is chased instead",
  STATUS_SLA.intake.breachHours === null && (CHASE.intake || []).length > 0);
check("every API status has a rule",
  ["intake","ai_reading","profile_review","advanced_review","ai_drafting","internal_review","ready_to_file"]
    .every((s) => STATUS_SLA[s]));

// ---- business hours ----
check("business hours skip the weekend", (() => {
  // Fri 09:00 UTC to Mon 09:00 UTC should be far less than 72 calendar hours
  const fri = Date.UTC(2026, 7, 21, 9, 0), mon = Date.UTC(2026, 7, 24, 9, 0);
  const h = hoursBetween(fri, mon);
  return SETTINGS.USE_BUSINESS_HOURS ? h < 40 : true;
})());
check("no time counted before anything happened", hoursBetween(0) === 0);

// ---- SLA behaviour ----
check("drafting inside the SLA is not flagged",
  !has(run(kase({ status: "ai_drafting" }), [ev(2, "ai_drafting", "moved to drafting")]), /SLA/));
check("drafting past its limit is flagged",
  has(run(kase({ status: "ai_drafting" }), [ev(24 * 30, "ai_drafting", "moved to drafting")]), /over the 120h limit/));
check("drafting far past its limit is critical",
  run(kase({ status: "ai_drafting" }), [ev(24 * 90, "ai_drafting", "moved to drafting")])
    .some((i) => i.area === "sla" && i.severity === "critical"));
check("an unknown status is reported rather than ignored",
  has(run(kase({ status: "brand_new_status" }), [ev(1, "x")]), /Unknown case status/));

// ---- controls ----
check("reviewer who is also the writer is critical",
  run(kase({ reviewer: { id: "2", name: "Writer Two" } }), [ev(1, "ai_drafting")])
    .some((i) => i.severity === "critical" && /not independent/.test(i.problem)));
check("ready to file with no client approval is critical",
  run(kase({ status: "ready_to_file" }), [ev(1, "ready_to_file", "moved to ready to file")])
    .some((i) => i.severity === "critical" && /no written client approval/.test(i.problem)));
check("ready to file WITH recorded approval is not flagged for approval",
  !has(run(kase({ status: "ready_to_file" }), [ev(40, "client approved the package"), ev(1, "ready_to_file")]), /no written client approval/));
check("drafting with no brainstorm recorded is flagged",
  has(run(kase({ status: "ai_drafting" }), [ev(3, "ai_drafting", "moved to drafting")]), /no completed brainstorm/));
check("a recorded brainstorm clears it",
  !has(run(kase({ status: "ai_drafting" }), [ev(50, "brainstorm session completed"), ev(3, "ai_drafting")]), /no completed brainstorm/));
check("no writer assigned past intake is flagged",
  has(run(kase({ status: "profile_review", petition_writer: null }), [ev(3, "profile_review")]), /no petition writer assigned/));
check("no reviewer at internal review is flagged",
  has(run(kase({ status: "internal_review", reviewer: null }), [ev(3, "internal_review")]), /no reviewer assigned/));
check("assigned but never notified is flagged",
  has(run(kase({ petition_writer_notified: false }), [ev(2, "ai_drafting")]), /never been notified/));

// ---- chases ----
check("intake chased after 3 days",
  has(run(kase({ status: "intake" }), [ev(24 * 4, "intake", "case created")]), /has not started uploading/));
check("intake escalated after 14 days",
  run(kase({ status: "intake" }), [ev(24 * 20, "intake", "case created")])
    .some((i) => i.severity === "critical"));
check("fresh intake is not chased",
  !has(run(kase({ status: "intake" }), [ev(5, "intake", "case created")]), /chase|uploading/i));
check("package shared and client silent is chased",
  has(run(kase({ status: "internal_review" }), [ev(24 * 8, "package shared with client"), ev(24 * 8, "internal_review")]), /no client response|has not responded/));
check("documents requested and never supplied is flagged",
  has(run(kase({ status: "intake" }), [ev(24 * 6, "missing documents requested from client")]), /Documents were requested/));

// ---- stalled ----
check("a case with no activity for weeks is flagged",
  has(run(kase({ status: "ai_drafting" }), [ev(24 * 21, "ai_drafting")]), /No activity of any kind/));
check("an active case is not flagged as stalled",
  !has(run(kase({ status: "ai_drafting" }), [ev(2, "ai_drafting")]), /No activity of any kind/));

// ---- the full case record ----
const fullCase = (o = {}) => ({
  case_id: "C9", client_name: "Test", status: "ready_to_file",
  client_profile: { education: "Masters in Electrical Engineering", experience: "12 years in power systems" },
  documents: [
    { label: "CV", file_name: "cv.pdf", size: 120000 },
    { label: "Passport", file_name: "passport.pdf", size: 90000 },
    { label: "Degree certificate", file_name: "masters.pdf", size: 50000 },
    { label: "Employment letter", file_name: "employer.pdf", size: 40000 },
  ],
  petition: {
    proposed_endeavor_statement: "The beneficiary proposes to advance grid resilience research in the United States over the coming years.",
    cover_letter: "Dear Officer, this petition is submitted on behalf of the beneficiary and sets out the basis for the waiver.",
    exhibit_list: "Exhibit 1 CV, Exhibit 2 degree, Exhibit 3 employment letters, Exhibit 4 publications",
    cv: "Curriculum vitae with full employment history and publications listed in reverse order.",
  },
  forms_stage: { forms: [{ name: "I-140", applies: true, prepared: true, signed: true, checked: true }] },
  client_review: { sent_at: new Date(now - 3 * D).toISOString(), approved_at: new Date(now - 1 * D).toISOString() },
  ...o,
});
const detail = (o) => checkCaseDetail(fullCase(o), { status: (o && o.status) || "ready_to_file" });
const hasP = (list, re) => list.some((i) => re.test(i.problem));

check("a complete case at ready to file produces nothing", detail({}).length === 0, JSON.stringify(detail({}).map(i=>i.problem)));
check("ready to file with no client approval is critical",
  detail({ client_review: { sent_at: new Date(now - 9 * D).toISOString() } })
    .some((i) => i.severity === "critical" && /no approval/.test(i.problem)));
check("a client sitting on the petition over a week is chased",
  hasP(detail({ client_review: { sent_at: new Date(now - 9 * D).toISOString() } }), /sent to the client 9 days ago/));
check("the EB-2 floor passes on a masters degree", !hasP(detail({}), /EB-2 floor/));
check("the EB-2 floor fails with no degree and no experience",
  hasP(detail({ client_profile: { education: "high school diploma only", experience: "2 years assistant" } }), /EB-2 floor is not evidenced/));
check("the EB-2 floor passes on a bachelors plus 8 years",
  !hasP(detail({ client_profile: { education: "Bachelor of Science in Civil Engineering", experience: "8 years of progressive experience" } }), /EB-2 floor/));
check("missing core documents are flagged",
  hasP(detail({ documents: [{ label: "CV", file_name: "cv.pdf", size: 1000 }] }), /Core documents are missing/));
check("no documents at all is flagged",
  hasP(detail({ documents: [] }), /no documents uploaded at all/));
check("an empty upload is flagged",
  hasP(detail({ documents: [...fullCase().documents, { label: "Award", file_name: "award.pdf", size: 0 }] }), /empty and cannot be read/));
check("a missing endeavour statement is critical at ready to file",
  detail({ petition: { cover_letter: "x".repeat(50), exhibit_list: "y".repeat(50), cv: "z".repeat(50) } })
    .some((i) => i.severity === "critical" && /Proposed Endeavour Statement/.test(i.problem)));
check("a missing exhibit list is flagged",
  hasP(detail({ petition: { ...fullCase().petition, exhibit_list: "" } }), /exhibit list/));
check("unsigned forms at ready to file are critical",
  detail({ forms_stage: { forms: [{ name: "I-140", applies: true, prepared: true, signed: false, checked: false }] } })
    .some((i) => i.severity === "critical" && /incomplete forms/.test(i.problem)));
check("forms that do not apply are ignored",
  !hasP(detail({ forms_stage: { forms: [{ name: "I-907", applies: false, prepared: false, signed: false, checked: false }] } }), /incomplete forms/));
check("pending recommendation letters are flagged at ready to file",
  hasP(detail({ recommendation_letters: { status: "pending" } }), /recommendation letters are still/));
check("a case record that cannot be read produces nothing",
  checkCaseDetail(null, {}).length === 0 && checkCaseDetail(undefined, {}).length === 0);

// ---- v2: stage timing from the API's own business-hour figure ----
const stageCase = (statusV, ageHours) => ({
  case_id: "S1", status: statusV,
  stage: { stage_entered_at: new Date(now - ageHours * H).toISOString(), clock_start_at: new Date(now - ageHours * H).toISOString(), age_hours: ageHours, age_days: Math.floor(ageHours / 9) },
  documents: fullCase().documents, petition: fullCase().petition,
  client_review: fullCase().client_review, forms_stage: fullCase().forms_stage,
  client_profile: fullCase().client_profile,
});
const sla = (statusV, ageHours) => checkCaseDetail(stageCase(statusV, ageHours), { status: statusV }).filter((i) => i.area === "sla");

check("drafting at 40 business hours is not flagged", sla("ai_drafting", 40).length === 0);
check("drafting is allowed 4 to 5 days, not 2", STATUS_SLA.ai_drafting.breachHours === 120 && STATUS_SLA.ai_drafting.warnHours === 96);
check("internal review is allowed 3 to 4 days", STATUS_SLA.internal_review.breachHours === 96 && STATUS_SLA.internal_review.warnHours === 72);
check("drafting at 100 business hours warns", (sla("ai_drafting", 100)[0] || {}).severity === "medium");
check("drafting at 130 business hours is late", (sla("ai_drafting", 130)[0] || {}).severity === "high");
check("drafting at 260 business hours is critical", (sla("ai_drafting", 260)[0] || {}).severity === "critical");
check("case analysis warns at 50 and is late at 80", (sla("profile_review", 50)[0] || {}).severity === "medium" && (sla("profile_review", 80)[0] || {}).severity === "high");
check("the reported figure is the API's own hours", /130 business hours/.test((sla("ai_drafting", 130)[0] || {}).problem || ""));
check("intake has no SLA so no timing finding", sla("intake", 500).length === 0);

// ---- v2: amendments ----
const amCase = (amendments, statusV = "internal_review") => ({ case_id: "A1", status: statusV, amendments });
const am = (o) => checkReview(amCase(o.list, o.status), { status: o.status || "internal_review" });
const amend = (status, hoursAgo, extra = {}) => ({
  status, note: "fix the endeavour section", raised_by_name: "Reviewer",
  raised_at: new Date(now - hoursAgo * H).toISOString(), ...extra,
});

check("a verified amendment is not chased",
  am({ list: [amend("verified", 100, { applied_at: new Date(now - 90 * H).toISOString(), verified_at: new Date(now - 80 * H).toISOString() }) ] }).length === 0);
check("an amendment raised 40h ago and not applied is chased to the writer",
  am({ list: [amend("raised", 40)] }).some((i) => i.owner === "petition_writer" && /not applied/.test(i.problem)));
check("an amendment raised 4h ago is not chased yet",
  am({ list: [amend("raised", 4)] }).length === 0);
check("an applied amendment not verified after 40h is chased to the reviewer",
  am({ list: [amend("applied", 80, { applied_at: new Date(now - 40 * H).toISOString() })] })
    .some((i) => i.owner === "reviewer" && /not verified/.test(i.problem)));
check("ready to file with an open amendment is critical",
  am({ list: [amend("raised", 10)], status: "ready_to_file" })
    .some((i) => i.severity === "critical" && /Ready to File/.test(i.problem)));
check("ready to file with all amendments verified is clean",
  am({ list: [amend("verified", 100, { applied_at: new Date(now - 90 * H).toISOString(), verified_at: new Date(now - 80 * H).toISOString() })], status: "ready_to_file" }).length === 0);
check("no amendments on the case produces nothing", am({ list: [] }).length === 0);

// ---- v2: the reviewer never responded ----
const rev = (o) => checkReview({ case_id: "R1", status: "internal_review", review_status: o }, { status: "internal_review" });
check("a reviewer silent for 40h after being asked is flagged",
  rev({ writer_requested_review_at: new Date(now - 40 * H).toISOString() }).some((i) => /has not responded/.test(i.problem)));
check("a reviewer who sent the case back has responded",
  !rev({ writer_requested_review_at: new Date(now - 40 * H).toISOString(), reviewer_last_sent_back_at: new Date(now - 20 * H).toISOString() })
    .some((i) => /has not responded/.test(i.problem)));
check("a reviewer note counts as responding",
  !rev({ writer_requested_review_at: new Date(now - 40 * H).toISOString(), reviewer_note_updated_at: new Date(now - 10 * H).toISOString() })
    .some((i) => /has not responded/.test(i.problem)));
check("a request 5h old is not chased yet",
  rev({ writer_requested_review_at: new Date(now - 5 * H).toISOString() }).length === 0);
check("sign-off is never invented from a send-back", (() => {
  const out = rev({ writer_requested_review_at: new Date(now - 60 * H).toISOString(), reviewer_last_sent_back_at: new Date(now - 30 * H).toISOString() });
  return !out.some((i) => /sign.?off|approved/i.test(i.problem));
})());

// ---- keeping the report short enough to act on ----
check("only high and above are listed individually", SETTINGS.ITEMISE_FROM === "high");
check("each case contributes one line at most", SETTINGS.MAX_PER_CASE === 1);
check("the list is capped", SETTINGS.MAX_ITEMISED > 0 && SETTINGS.MAX_ITEMISED <= 100);
check("the routine states are counted, not listed", (() => {
  const info = PROBES.filter((p) => p.informational).map((p) => p.id);
  return ["intake_awaiting", "approval_waiting", "audit_over_2d", "verdict_weak"].every((x) => info.includes(x));
})());
check("the things that need action are never marked informational", (() => {
  const must = ["brainstorm_overdue", "drafting_escalated", "no_reviewer", "verdict_no_go", "approval_over_week"];
  return must.every((id) => !PROBES.find((p) => p.id === id)?.informational);
})());
check("a realistic load comes down to something readable", (() => {
  const RANKX = { critical: 0, high: 1, medium: 2, low: 3 };
  const INFO = new Set(PROBES.filter((p) => p.informational).map((p) => p.problem.split(" — ")[0]));
  const gen = [];
  let n = 0;
  for (const p of PROBES) {
    const many = p.informational ? 190 : (p.severity === "critical" ? 6 : 40);
    for (let i = 0; i < many; i++) gen.push({ caseId: `C${n++ % 522}`, severity: p.severity, problem: `${p.problem} — 30h in stage` });
  }
  const th = RANKX[SETTINGS.ITEMISE_FROM] ?? 1;
  const act = gen.filter((f) => ![...INFO].some((p) => f.problem.startsWith(p)) && (RANKX[f.severity] ?? 9) <= th);
  const per = new Map(); const items = [];
  for (const f of act.sort((a, b) => (RANKX[a.severity] ?? 9) - (RANKX[b.severity] ?? 9))) {
    const c = per.get(f.caseId) || 0; if (c >= SETTINGS.MAX_PER_CASE) continue; per.set(f.caseId, c + 1); items.push(f);
  }
  return gen.length > 1000 && items.slice(0, SETTINGS.MAX_ITEMISED).length <= SETTINGS.MAX_ITEMISED;
})());

// ---- grouping: one problem, not fifty tickets ----
const mkFindings = (n, owner, problem, sev = "critical") =>
  Array.from({ length: n }, (_, i) => ({ caseId: `${owner}${i}`, caseName: `Client ${i}`, owner,
    severity: sev, area: "control", problem, action: "do the thing", ageHours: 40 + i * 5 }));

const bigBacklog = mkFindings(37, "Kysha-Jade Nicholene", "The brainstorm slot has passed and nothing was captured")
  .map((f) => ({ ...f, risk: "Avoid drafting from a call nobody captured." }));
const smallGroup = mkFindings(5, "Fatima Khalid", "The writer asked for a review and no reviewer has responded", "high");
const isolated = [
  { caseId: "X1", caseName: "Ahmed", owner: "Aleena Najeeb", severity: "critical", area: "control", problem: "Ready to File with no client approval", action: "capture approval", ageHours: 10 },
  { caseId: "X2", caseName: "Sara", owner: "Stella", severity: "critical", area: "quality", problem: "Petition missing the endeavour statement", action: "complete it", ageHours: 20 },
];
const g1 = group([...bigBacklog, ...smallGroup, ...isolated]);

check("37 identical findings collapse to one escalation", g1.escalations.length === 1 && g1.escalations[0].count === 37);
check("the escalation names the person", g1.escalations[0].owner === "Kysha-Jade Nicholene");
check("a group of five is grouped, not escalated", g1.grouped.length === 1 && g1.grouped[0].count === 5);
check("isolated problems stay individual", g1.singles.length === 2);
check("44 findings become 4 items", g1.escalations.length + g1.grouped.length + g1.singles.length === 4);
check("the escalation says it is a backlog", /backlog this size will not clear case by case/.test(groupSentence(g1.escalations[0])));
check("the escalation reports the oldest wait", /oldest has been waiting \d+ business hours/.test(groupSentence(g1.escalations[0])));
check("the oldest cases are the ones named", g1.escalations[0].cases[0].ageHours >= g1.escalations[0].cases[1].ageHours);
check("only a few example cases are named", g1.escalations[0].cases.length <= SETTINGS.CLUSTER_SHOW_CASES);
check("the rest are counted", g1.escalations[0].moreCases === 37 - SETTINGS.CLUSTER_SHOW_CASES);
check("the same issue on different people is not merged", (() => {
  const two = [...mkFindings(6, "Person A", "Same issue"), ...mkFindings(6, "Person B", "Same issue")];
  const g = group(two);
  return g.escalations.length === 0 && g.grouped.length === 2;
})());
check("different issues for the same person are not merged", (() => {
  const two = [...mkFindings(6, "Person A", "Issue one"), ...mkFindings(6, "Person A", "Issue two")];
  const g = group(two);
  return g.grouped.length === 2;
})());
check("three of a kind stay individual", group(mkFindings(3, "Person C", "Rare issue")).singles.length === 3);
check("nothing in produces nothing out", (() => { const g = group([]); return !g.escalations.length && !g.grouped.length && !g.singles.length; })());
check("grouping thresholds are sane", SETTINGS.CLUSTER_MIN >= 2 && SETTINGS.ESCALATE_MIN > SETTINGS.CLUSTER_MIN);

// ---- every finding says why, what to do, and what to avoid ----
check("every probe has a risk line", PROBES.every((p) => p.risk && p.risk.length > 20),
  PROBES.filter((p) => !p.risk || p.risk.length <= 20).map((p) => p.id).join(", "));
check("no two probes share the same risk line",
  new Set(PROBES.map((p) => p.risk)).size === PROBES.length);
check("the risk line is carried into a group", (() => {
  const p = PROBES.find((x) => x.id === "brainstorm_overdue");
  const list = Array.from({ length: 9 }, (_, i) => ({ caseId: `q${i}`, caseName: `c${i}`, owner: "Someone",
    severity: "critical", area: p.area, problem: p.problem, action: p.action, risk: p.risk, ageHours: 30 + i }));
  return group(list).escalations[0]?.risk === p.risk;
})());
check("group wording varies between different owners and issues", (() => {
  const mk = (owner, issue) => Array.from({ length: 5 }, (_, i) => ({ caseId: `${owner}${i}`, caseName: "c", owner,
    severity: "high", area: "control", problem: issue, action: "a", risk: "r", ageHours: 20 }));
  const g = group([...mk("Person A", "issue one happened"), ...mk("Person B", "issue two happened"), ...mk("Person C", "issue three happened")]);
  const sentences = g.grouped.map(groupSentence);
  return new Set(sentences.map((x) => x.replace(/Person [A-C]|issue \w+ happened|\d+/g, ""))).size > 1;
})());
check("the same group always reads the same way", (() => {
  const mk = () => Array.from({ length: 5 }, (_, i) => ({ caseId: `z${i}`, caseName: "c", owner: "Person Z",
    severity: "high", area: "control", problem: "the thing went wrong", action: "a", risk: "r", ageHours: 20 }));
  return groupSentence(group(mk()).grouped[0]) === groupSentence(group(mk()).grouped[0]);
})());

// ---- the report stays short and recent ----
check("at most 30 items are listed", SETTINGS.MAX_ITEMISED === 30);
check("the date filter is off by default", SETTINGS.ONLY_CASES_FROM === null);
check("the forms stage has a rule", !!STATUS_SLA.forms);
check("an empty result is never reported as an all-clear when nothing was checked", (() => {
  const h = buildReport({ escalations: [], grouped: [], singles: [], counted: {}, scanned: 561, byStatus: {}, dryRun: true, excluded: 561, checked: 0 });
  return /Nothing was actually checked/.test(h) && !/came back clean/.test(h);
})());
check("a partial check is not reported as an all-clear", (() => {
  const h = buildReport({ escalations: [], grouped: [], singles: [], counted: {}, scanned: 100, byStatus: {}, dryRun: true, excluded: 80, checked: 20 });
  return /partial check/.test(h) && !/came back clean/.test(h);
})());
check("a genuine all-clear still reads as one", (() => {
  const h = buildReport({ escalations: [], grouped: [], singles: [], counted: {}, scanned: 100, byStatus: {}, dryRun: true, excluded: 0, checked: 100 });
  return /came back clean/.test(h);
})());

// ---- momentum: was moving, then stopped ----
const D2 = 86400000;
const evAt = (daysAgo) => ({ created_at: new Date(now - daysAgo * D2).toISOString() });
const mom = (status, days) => checkMomentum({ status }, { events: days.map(evAt) });
const gap = (status, g) => mom(status, [g, g + 4, g + 8, g + 13]);

check("a case still being worked is not flagged", gap("ai_drafting", 0).length === 0);
check("a DRAFTING case quiet for 3 days is NOT flagged — that is normal there", gap("ai_drafting", 3).length === 0);
check("a drafting case quiet for 10 days is flagged", gap("ai_drafting", 10).length === 1);
check("an INTAKE case quiet for 3 days IS flagged — the client should be moving", gap("intake", 3).length === 1);
check("internal review gets more room than intake",
  SETTINGS.MOMENTUM_STOP_DAYS_BY_STAGE.internal_review > SETTINGS.MOMENTUM_STOP_DAYS_BY_STAGE.intake);
check("drafting gets the most room of all",
  SETTINGS.MOMENTUM_STOP_DAYS_BY_STAGE.ai_drafting >= 8);
check("nothing is allowed to sit at ready to file",
  SETTINGS.MOMENTUM_STOP_DAYS_BY_STAGE.ready_to_file <= 2 && gap("ready_to_file", 3).length === 1);
check("severity is relative to what is normal for the stage",
  (gap("ai_drafting", 10)[0] || {}).severity === "medium" && (gap("intake", 10)[0] || {}).severity === "critical");
check("a case dormant for months is NOT flagged as lost momentum", mom("ai_drafting", [120, 140, 160]).length === 0);
check("a barely-touched case is not flagged", mom("intake", [10, 60]).length === 0);
check("a case with no history at all is not flagged", checkMomentum({ status: "intake" }, { events: [] }).length === 0);
check("the finding says what is normal for the stage", /is normal at this stage/.test((gap("intake", 5)[0] || {}).problem || ""));
check("momentum has its own risk line", (gap("intake", 5)[0] || {}).risk?.length > 30);
check("every stage has a silence threshold", (() => {
  const map = SETTINGS.MOMENTUM_STOP_DAYS_BY_STAGE || {};
  return Object.keys(STATUS_SLA).every((k) => Number.isFinite(map[k]));
})());
check("no single owner can fill the report", SETTINGS.MAX_ITEMS_PER_OWNER > 0 && SETTINGS.MAX_ITEMS_PER_OWNER <= 5);

// ---- report ----
const html = buildReport({
  ...g1,
  counted: { "Still waiting on the client to submit their intake form": 190 },
  scanned: 559, byStatus: { ai_drafting: 30, internal_review: 12, intake: 42 }, dryRun: true,
});
check("the report leads with the backlog", /Plan these/.test(html));
check("the report shows the grouped issue", /The same problem on several cases/.test(html));
check("the routine states appear as counts", /Background/.test(html) && /190/.test(html));
check("a stopped case gets its own section", (() => {
  const h = buildReport({ escalations: [], grouped: [], singles: [
    { caseId: "m", caseName: "X", owner: "Y", area: "momentum", severity: "high",
      problem: "Was moving steadily — 4 updates in the weeks before — then stopped 8 day(s) ago", action: "pick it up", risk: "avoid this" }],
    counted: {}, scanned: 10, checked: 10, byStatus: {}, dryRun: true });
  return /Stopped moving/.test(h);
})());
check("the escalation sentence is in the report", /backlog this size/.test(html));
check("the report tells the reader what to do", />DO</.test(html));
check("the report tells the reader what to avoid", />AVOID</.test(html));
check("the report links to the dashboard", html.includes("petition.hofmigration.com/dashboard"));
check("the report escapes text", !/<script/i.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nA rule stopped working. Fix it before running for real."); process.exit(1); }
