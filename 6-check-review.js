// 6-check-review.js — the reviewer loop and the amendments, using the v2 fields.
//
// AMENDMENTS are now fully tracked: each issue moves raised -> applied -> verified with
// names and timestamps, so the loop can be audited properly for the first time.
//
// REVIEWER SIGN-OFF: deliberately NOT checked. Petition Studio has no "reviewer
// approved" action, so no field means it. reviewer_last_sent_back_at means the reviewer
// sent work BACK, which is the opposite. Inventing a sign-off check from these fields
// would flag people for something the app cannot record. What IS checked is whether the
// reviewer responded at all after being asked.
const { SETTINGS } = require("./config");
const { pick } = require("./5-check-case-detail");

const asArray = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);
const hoursSince = (v) => { const t = Date.parse(v || 0); return t ? (Date.now() - t) / 3600000 : null; };
const lower = (v) => String(v ?? "").toLowerCase();

module.exports = function checkReview(full, listRow) {
  if (!full || typeof full !== "object") return [];
  const issues = [];
  const status = lower(pick(full, "status") || listRow?.status);
  const atFiling = status === "ready_to_file";

  // ---------------------------------------------------------------- amendments
  if (SETTINGS.CHECK_AMENDMENTS) {
    const list = asArray(pick(full, "amendments")).filter((a) => a && typeof a === "object");
    if (list.length) {
      const open = [];      // raised, writer has not applied
      const unverified = []; // applied, reviewer has not verified

      for (const a of list) {
        const st = lower(pick(a, "status"));
        const raisedAt = pick(a, "raised_at");
        const appliedAt = pick(a, "applied_at");
        const verifiedAt = pick(a, "verified_at");

        if (st === "verified" || verifiedAt) continue;
        if (st === "applied" || appliedAt) unverified.push({ a, since: hoursSince(appliedAt) });
        else open.push({ a, since: hoursSince(raisedAt) });
      }

      // a case cannot be filed with the review loop still open
      if (atFiling && (open.length || unverified.length))
        issues.push({ area: "control", severity: "critical", owner: "reviewer",
          problem: `Case is Ready to File with ${open.length + unverified.length} amendment(s) not verified (${open.length} not applied, ${unverified.length} awaiting verification)`,
          action: "close out the amendments before this case is filed",
          risk: "Never file with the review loop still open. An amendment nobody verified is an unfixed problem that leaves with the petition." });
      else {
        const slowOpen = open.filter((o) => o.since !== null && o.since >= SETTINGS.AMENDMENT_APPLY_HOURS);
        if (slowOpen.length) {
          const worst = Math.max(...slowOpen.map((o) => o.since));
          issues.push({ area: "quality", severity: worst >= SETTINGS.AMENDMENT_APPLY_HOURS * 2 ? "high" : "medium", owner: "petition_writer",
            problem: `${slowOpen.length} amendment(s) raised by the reviewer and still not applied, the oldest ${Math.floor(worst)} hours ago`,
            action: "apply the outstanding amendments",
            risk: "Avoid letting reviewer feedback sit. It has to be applied eventually, and doing it later means re-reading the whole case." });
        }
        const slowVerify = unverified.filter((o) => o.since !== null && o.since >= SETTINGS.AMENDMENT_VERIFY_HOURS);
        if (slowVerify.length) {
          const worst = Math.max(...slowVerify.map((o) => o.since));
          issues.push({ area: "quality", severity: worst >= SETTINGS.AMENDMENT_VERIFY_HOURS * 2 ? "high" : "medium", owner: "reviewer",
            problem: `${slowVerify.length} amendment(s) applied by the writer and still not verified, the oldest ${Math.floor(worst)} hours ago`,
            action: "verify the applied amendments and close them",
            risk: "Avoid an amendment that is fixed but never confirmed. On paper the case still fails its own review." });
        }
      }
    }
  }

  // ------------------------------------------------------ reviewer never responded
  if (SETTINGS.CHECK_REVIEW_RESPONSE) {
    const rs = pick(full, "review_status", "reviewStatus") || {};
    const requestedAt = pick(rs, "writer_requested_review_at");
    if (requestedAt) {
      const noteAt = Date.parse(pick(rs, "reviewer_note_updated_at") || 0) || 0;
      const sentBackAt = Date.parse(pick(rs, "reviewer_last_sent_back_at") || 0) || 0;
      const asked = Date.parse(requestedAt) || 0;
      const responded = Math.max(noteAt, sentBackAt) >= asked;
      const h = hoursSince(requestedAt);
      if (!responded && h !== null && h >= SETTINGS.REVIEW_RESPONSE_HOURS)
        issues.push({ area: "control", severity: h >= SETTINGS.REVIEW_RESPONSE_HOURS * 2 ? "high" : "medium", owner: "reviewer",
          problem: `The writer asked for review ${Math.floor(h)} hours ago and the reviewer has not responded at all`,
          action: "review the case, or send it back with your notes",
          risk: "Avoid leaving the writer waiting. They cannot progress, and the delay counts against the case, not the reviewer." });
    }
  }

  return issues;
};
