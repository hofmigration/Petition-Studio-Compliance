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
check("Fatima Khalid and Samina Naseer are marked as also reviewing",
  DUAL_ROLE.includes("Fatima Khalid") && DUAL_ROLE.includes("Samina Naseer"));
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
check("Drafting breaches at 48 working hours", STATUS_SLA.ai_drafting.breachHours === 48);
check("Internal review breaches at 48 and warns at 24",
  STATUS_SLA.internal_review.breachHours === 48 && STATUS_SLA.internal_review.warnHours === 24);
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
check("drafting over 48h is flagged",
  has(run(kase({ status: "ai_drafting" }), [ev(24 * 9, "ai_drafting", "moved to drafting")]), /over the 48h SLA/));
check("drafting far over the SLA is critical",
  run(kase({ status: "ai_drafting" }), [ev(24 * 30, "ai_drafting", "moved to drafting")])
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

check("drafting at 20 business hours is not flagged", sla("ai_drafting", 20).length === 0);
check("drafting at 30 business hours warns", (sla("ai_drafting", 30)[0] || {}).severity === "medium");
check("drafting at 60 business hours breaches", (sla("ai_drafting", 60)[0] || {}).severity === "high");
check("drafting at 120 business hours is critical", (sla("ai_drafting", 120)[0] || {}).severity === "critical");
check("case analysis breaches at 80 hours, not 50", sla("profile_review", 50).length && (sla("profile_review", 50)[0] || {}).severity === "medium" && (sla("profile_review", 80)[0] || {}).severity === "high");
check("the reported figure is the API's own hours", /60 business hours/.test((sla("ai_drafting", 60)[0] || {}).problem || ""));
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

// ---- report ----
const html = buildReport({
  findings: [
    { caseId: "C1", caseName: "Ahmed Khan", stage: "4. Drafting", owner: "Writer Two", severity: "critical", area: "control", problem: "The reviewer and the writer are the same person", action: "assign a different reviewer" },
    { caseId: "C2", caseName: "Sara Ali", stage: "5. Internal Review", owner: "Reviewer Three", severity: "high", area: "sla", problem: "62 working hours in stage, over the 48h SLA", action: "move this case forward" },
  ],
  scanned: 84, byStatus: { ai_drafting: 30, internal_review: 12, intake: 42 }, dryRun: true,
});
check("the report renders with its sections", /Control failures/.test(html) && /SLA breaches/.test(html) && /Pipeline by stage/.test(html));
check("the report links to the dashboard", html.includes("petition.hofmigration.com/dashboard"));
check("the report escapes text", !/<script/i.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nA rule stopped working. Fix it before running for real."); process.exit(1); }
