// 5-check-case-detail.js — the checks that need the FULL case record.
//
// The Case Search API returns the intake profile, every uploaded document, the drafted
// petition sections, the USCIS forms stage and the client review record. That turns
// several things from "inferred from event text" into "proven from the data".
//
// Field names are matched tolerantly, because a record can spell the same idea more
// than one way. Anything genuinely unreadable is skipped rather than guessed at, so a
// missing field is never reported as a missing action.
const { SETTINGS, LATE_STAGES, STATUS_SLA } = require("./config");

// ---------- tolerant lookups ----------
const lower = (v) => String(v ?? "").toLowerCase();
function pick(obj, ...names) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const n of names) {
    for (const k of Object.keys(obj)) if (k.toLowerCase() === n.toLowerCase() && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
}
const asArray = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : v ? [v] : []);
const truthy = (v) => v === true || /^(true|yes|y|1|done|complete|completed|prepared|signed|checked|approved)$/i.test(String(v ?? ""));
const textOf = (v) => {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(textOf).join(" ");
  if (typeof v === "object") return Object.values(v).map(textOf).join(" ");
  return String(v);
};
const daysSince = (v) => { const t = Date.parse(v || 0); return t ? (Date.now() - t) / 86400000 : null; };

// ---------- document categories we expect ----------
const DOC_RULES = [
  // NOTE: no trailing \b on the stems. "\bemploy\b" does NOT match "Employment",
  // which once flagged a case that had the letter as missing it.
  { key: "cv",         label: "CV or resume",         match: /\b(cv|resume|curriculum)/i },
  { key: "passport",   label: "passport",             match: /\bpassport/i },
  { key: "education",  label: "degree or transcript", match: /\b(degree|diploma|transcript|certificat|educat|master|bachelor|phd|doctor)/i },
  { key: "employment", label: "employment letter",    match: /\b(employ|experien|job letter|work letter|service letter|reference letter|salary)/i },
];

// ---------- petition sections expected before filing ----------
const PETITION_PARTS = [
  { key: "endeavor",   label: "Proposed Endeavour Statement", names: ["proposed_endeavor_statement", "proposed_endeavour_statement", "endeavor_statement", "proposed_endeavor"] },
  { key: "cover",      label: "cover letter",                 names: ["cover_letter", "coverletter"] },
  { key: "exhibits",   label: "exhibit list",                 names: ["exhibit_list", "exhibits", "exhibit_index"] },
  { key: "cv",         label: "CV section",                   names: ["cv", "curriculum_vitae", "resume"] },
];

module.exports = function checkCaseDetail(full, listRow) {
  if (!full || typeof full !== "object") return [];
  const issues = [];
  const status = lower(pick(full, "status") || listRow?.status);
  const late = LATE_STAGES.includes(status) || status === "ready_to_file";

  // =====================================================================
  // 0. STAGE TIMING — using the API's own business-hour figure
  // The stage object gives stage_entered_at, clock_start_at and age_hours already
  // counted on the company calendar, and the clock restarts on the real waiting event
  // for Internal review and Forms. That is more accurate than anything derived here.
  // =====================================================================
  if (SETTINGS.CHECK_SLA && SETTINGS.PREFER_API_STAGE_HOURS) {
    const stage = pick(full, "stage");
    const ageHours = stage ? Number(pick(stage, "age_hours")) : NaN;
    const rule = STATUS_SLA[status];
    if (rule && rule.breachHours && Number.isFinite(ageHours)) {
      const label = rule.phase;
      if (ageHours >= rule.breachHours * 2)
        issues.push({ area: "sla", severity: "critical", owner: rule.owner,
          problem: `${label}: ${ageHours} business hours in stage, more than double the ${rule.breachHours}h limit`,
          action: "move this case forward today or escalate it" });
      else if (ageHours >= rule.breachHours)
        issues.push({ area: "sla", severity: "high", owner: rule.owner,
          problem: `${label}: ${ageHours} business hours in stage, over the ${rule.breachHours}h limit`,
          action: "move this case forward" });
      else if (rule.warnHours && ageHours >= rule.warnHours)
        issues.push({ area: "sla", severity: "medium", owner: rule.owner,
          problem: `${label}: ${ageHours} business hours in stage, approaching the ${rule.breachHours}h limit`,
          action: "keep this case moving before it goes over" });
    }
  }

  // =====================================================================
  // 1. CLIENT APPROVAL — now provable rather than inferred
  // =====================================================================
  const review = pick(full, "client_review", "clientReview") || {};
  const sentAt = pick(review, "sent_at", "sent", "sent_on", "shared_at");
  const approvedAt = pick(review, "approved_at", "approved", "approval_date", "approved_on");
  const approved = truthy(approvedAt) || (approvedAt && Date.parse(approvedAt));

  if (SETTINGS.CHECK_APPROVAL_BEFORE_FILING && status === "ready_to_file" && !approved)
    issues.push({ area: "control", severity: "critical", owner: "case_manager",
      problem: "Case is Ready to File and the client review record shows no approval",
      action: "capture the written client approval before this case is filed" });

  if (sentAt && !approved) {
    const d = daysSince(sentAt);
    if (d !== null && d >= 7)
      issues.push({ area: "chase", severity: d >= 14 ? "high" : "medium", owner: "case_manager",
        problem: `Petition was sent to the client ${Math.floor(d)} days ago and is still not approved`,
        action: "chase the client for their approval" });
  }

  // =====================================================================
  // 2. EB-2 ELIGIBILITY FLOOR — advanced degree, OR bachelor's + 5 years
  // =====================================================================
  if (SETTINGS.CHECK_ELIGIBILITY) {
    const profile = pick(full, "client_profile", "clientProfile", "intake", "profile");
    if (profile) {
      const blob = textOf(profile);
      const advanced = /\b(master|masters|m\.?sc|mba|ph\.?d|doctorate|doctoral|md\b|llm)\b/i.test(blob);
      const bachelor = /\b(bachelor|b\.?sc|b\.?a\b|b\.?tech|b\.?e\b|undergraduate|graduate)\b/i.test(blob);
      const years = [...blob.matchAll(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)/gi)].map((m) => parseInt(m[1], 10));
      const maxYears = years.length ? Math.max(...years) : 0;

      // only judge a profile with something in it, but do not set the bar so high that
      // a genuinely thin profile escapes the check
      if (!advanced && !(bachelor && maxYears >= 5) && blob.replace(/\s+/g, "").length >= 25)
        issues.push({ area: "quality", severity: late ? "high" : "medium", owner: "petition_writer",
          problem: `EB-2 floor is not evidenced in the intake profile${maxYears ? ` (highest experience found: ${maxYears} years)` : ""} — no advanced degree, and no bachelor's plus five years`,
          action: "confirm the EB-2 basis and record the supporting evidence" });
    }
  }

  // =====================================================================
  // 3. DOCUMENTS — presence by category
  // =====================================================================
  if (SETTINGS.CHECK_DOCUMENT_PRESENCE) {
    const docs = asArray(pick(full, "documents", "docs", "uploaded_documents"));
    if (docs.length === 0) {
      if (status !== "intake")
        issues.push({ area: "documents", severity: "high", owner: "processor",
          problem: `Case is at ${status} with no documents uploaded at all`,
          action: "collect the client documents before this case goes further" });
    } else {
      const names = docs.map((d) => `${pick(d, "label", "name", "title") || ""} ${pick(d, "file_name", "filename", "file") || ""}`).join(" | ");
      const missing = DOC_RULES.filter((r) => !r.match.test(names)).map((r) => r.label);
      if (missing.length && (late || status === "advanced_review" || status === "profile_review"))
        issues.push({ area: "documents", severity: late ? "high" : "medium", owner: "processor",
          problem: `Core documents are missing: ${missing.join(", ")}`,
          action: "collect the missing documents from the client" });

      const empty = docs.filter((d) => { const sz = pick(d, "size", "bytes", "file_size"); return sz !== undefined && Number(sz) === 0; });
      if (empty.length)
        issues.push({ area: "documents", severity: "medium", owner: "processor",
          problem: `${empty.length} uploaded file(s) are empty and cannot be read`,
          action: "ask the client to re-upload the empty files" });
    }
  }

  // =====================================================================
  // 4. PETITION COMPLETENESS — from internal review onwards
  // =====================================================================
  if (SETTINGS.CHECK_PETITION_PARTS && (status === "internal_review" || status === "ready_to_file")) {
    const pet = pick(full, "petition") || {};
    const missing = [];
    for (const part of PETITION_PARTS) {
      const val = pick(pet, ...part.names);
      const body = textOf(val).replace(/\s+/g, "");
      if (!val || body.length < 20) missing.push(part.label);
    }
    if (missing.length)
      issues.push({ area: "quality", severity: status === "ready_to_file" ? "critical" : "high", owner: "petition_writer",
        problem: `The petition is missing: ${missing.join(", ")}`,
        action: "complete the missing petition sections" });
  }

  // =====================================================================
  // 5. USCIS FORMS — prepared, signed, checked
  // =====================================================================
  if (SETTINGS.CHECK_FORMS) {
    const forms = pick(full, "forms_stage", "formsStage", "forms");
    const list = asArray(forms && (pick(forms, "forms", "items", "list") || forms)).filter((x) => x && typeof x === "object");
    if (list.length) {
      const bad = [];
      for (const fm of list) {
        const applies = pick(fm, "applies", "applicable", "required", "needed");
        if (applies !== undefined && !truthy(applies)) continue;
        const name = pick(fm, "name", "form", "form_name", "code") || "a form";
        const prepared = truthy(pick(fm, "prepared", "is_prepared", "prepared_at"));
        const signed = truthy(pick(fm, "signed", "is_signed", "signed_at"));
        const checked = truthy(pick(fm, "checked", "is_checked", "verified", "checked_at"));
        const gaps = [!prepared && "not prepared", !signed && "not signed", !checked && "not checked"].filter(Boolean);
        if (gaps.length) bad.push(`${name} (${gaps.join(", ")})`);
      }
      if (bad.length && status === "ready_to_file")
        issues.push({ area: "control", severity: "critical", owner: "forms_specialist",
          problem: `Case is Ready to File with incomplete forms: ${bad.slice(0, 4).join("; ")}`,
          action: "complete, sign and check the outstanding forms before filing" });
      else if (bad.length && status === "internal_review")
        issues.push({ area: "quality", severity: "medium", owner: "forms_specialist",
          problem: `Forms still outstanding: ${bad.slice(0, 4).join("; ")}`,
          action: "prepare and check the outstanding forms" });
    }
  }

  // =====================================================================
  // 6. RECOMMENDATION LETTERS AND BUSINESS PLAN
  // =====================================================================
  if (SETTINGS.CHECK_SUPPORTING && late) {
    for (const [field, label] of [["recommendation_letters", "recommendation letters"], ["business_plan", "business plan"]]) {
      const val = pick(full, field);
      if (!val) continue;
      const st = lower(pick(val, "status", "state") || "");
      const body = textOf(pick(val, "content", "text", "letters", "plan") || "");
      if (st && /pending|draft|in progress|requested|awaiting|not started/.test(st))
        issues.push({ area: "quality", severity: status === "ready_to_file" ? "high" : "medium", owner: "petition_writer",
          problem: `The ${label} are still "${st}" while the case is at ${status}`,
          action: `complete the ${label}` });
      else if (!st && body.replace(/\s+/g, "").length < 30 && status === "ready_to_file")
        issues.push({ area: "quality", severity: "medium", owner: "petition_writer",
          problem: `The ${label} appear to be empty on a case that is Ready to File`,
          action: `confirm whether the ${label} are needed, and complete them if so` });
    }
  }

  return issues;
};
module.exports.pick = pick;
module.exports.textOf = textOf;
module.exports.DOC_RULES = DOC_RULES;
module.exports.PETITION_PARTS = PETITION_PARTS;
