# Petition Studio Compliance

Daily compliance for the NIW EB-2 petition process. Reads the Petition Studio **Case
History API** (read-only, GET only — nothing in Petition Studio can be changed), checks
every live case against the workflow SLAs and controls, and emails one HTML report.

---

## RUN THIS FIRST

**Actions → Petition Studio Compliance → Run workflow → mode: "Discover the API shape".**

The rules are written from the API guide, which cannot show what the data looks like in
practice. `discover.js` prints the real shape: the fields on a case, which statuses are
actually in use, assignment and notification coverage, the distinct **event actions and
titles** on the timeline, **every filter the API offers**, and **how many cases each
check would flag today**. Several checks key off that event vocabulary, so send the
output back and they get tuned to the real data instead of guesses.

Two things it will confirm straight away: any status not yet in `config.js`, and how
many cases have the **reviewer and writer set to the same person**.

---

## What it checks

The audit works in two passes.

### Pass 1 — filtered checks (the main audit)

Petition Studio already knows, authoritatively, where the brainstorm call stands, who is
waiting on a reviewer, how long a document audit has been open and whether the client has
approved. Each rule is a filtered query against the API, so the answer comes from the
system rather than from reading event text and guessing.

**Every query runs with `hold=hide`** — a case that is legitimately paused is never
flagged.

| Severity | Check | Filter |
|---|---|---|
| **critical** | Brainstorm slot passed, nothing captured | `brainstorm=overdue` |
| **critical** | Review loop hit its retry limit, needs a human | `drafting_health=escalated` |
| high | No reviewer assigned | `reviewer_queue=no_reviewer` |
| high | Writer asked for review, nobody responded | `reviewer_queue=awaiting_me` |
| high | Intake form submitted, nobody reviewed it | `intake_state=needs_review` |
| high | Document audit open over 5 days | `audit_age=over_5d` |
| high | Client never invited to the portal | `client_portal=never_invited` |
| high | No brainstorm slot picked | `brainstorm_followup=needs_booking` |
| high | Petition with the client over a week, no approval | `client_approval=waiting_over_week` |
| high | Same stage for over two weeks | `stage_age=stale` |
| high | Case analysis verdict is NO GO | `analysis_verdict=no_go` |
| medium | Document audit open over 2 days | `audit_age=over_2d` |
| medium | Petition with the client, not yet approved | `client_approval=waiting` |
| medium | Portal invited but never activated | `client_portal=invited_not_activated` |
| medium | Brainstorm time picked but never confirmed | `brainstorm=awaiting_confirmation` |
| medium | Reschedule requested on a confirmed slot | `brainstorm=reschedule_requested` |
| medium | Audit sent back to the client for changes | `audit_state=changes_requested` |
| medium | Still waiting on the intake form | `intake_state=awaiting` |
| medium | Case analysis verdict is WEAK | `analysis_verdict=weak` |

Two refinements: a **NO GO or WEAK verdict on a case already at drafting, internal review
or ready to file is raised a level**, because a weak case near filing is far more serious
than a weak case at analysis. And where a harder rule already fired, the softer version is
dropped — a case over 5 days in audit is not also reported as over 2 days.

### Pass 2 — the full case record (Case Search API v2)

For each flagged case, the Case Search API returns everything Petition Studio holds:
the intake profile, every uploaded document, the drafted petition sections, the USCIS
forms stage and the client review record. That turns several checks from inferred into
proven.

| Check | Severity | Source |
|---|---|---|
| **Ready to File and the client review shows no approval** | critical | `client_review` |
| **Ready to File with forms not prepared, signed or checked** | critical | `forms_stage` |
| **Petition missing the Proposed Endeavour Statement, cover letter, exhibit list or CV** at Ready to File | critical | `petition` |
| Petition sections missing at internal review | high | `petition` |
| Client sitting on the petition 7+ days (14+ = high) | medium–high | `client_review` |
| **EB-2 floor not evidenced** — no advanced degree, and no bachelor's plus five years | medium–high | `client_profile` |
| Core documents missing (CV, passport, degree, employment letter) | medium–high | `documents` |
| No documents uploaded at all past intake | high | `documents` |
| Empty or unreadable uploads | medium | `documents` |
| Recommendation letters or business plan still pending late in the process | medium–high | `recommendation_letters`, `business_plan` |
| Forms outstanding at internal review | medium | `forms_stage` |
| **Stage over its hour limit** — using the API's own business-hour figure | medium–critical | `stage.age_hours` |
| **Ready to File with amendments not verified** | critical | `amendments` |
| Amendments raised and not applied after 24h | medium–high | `amendments` |
| Amendments applied and not verified after 24h | medium–high | `amendments` |
| Writer asked for review and the reviewer never responded (24h) | medium–high | `review_status` |

Turn this pass off with `READ_FULL_CASE: false`.

### Pass 3 — timeline checks (what neither of the above answers)

For the cases a probe hit, the history is read for the things no filter covers:

| Check | Severity |
|---|---|
| **Reviewer is the same person as the writer** — the review is not independent | critical |
| **Ready to File with no written client approval recorded** | critical |
| Moved past internal review with no reviewer sign-off | high |
| Amendments raised but never verified | high |
| Drafting started with no completed brainstorm | high |
| A stage was skipped | high |
| Assigned to a role but never notified | medium |
| Working hours in the current stage against the stage timeline | varies |

Turn this pass off with `READ_TIMELINES: false` if you want a faster run.

## How much gets reported

A report of two thousand findings is not a report. Only what needs somebody to **act
today** is listed case by case; everything else is counted.

| | |
|---|---|
| **Listed, one line per case** | severity **high and critical** only, and each case contributes its **worst issue only** |
| **Counted, not listed** | normal states — waiting on an intake form, a client yet to approve, an audit two days old, a weak verdict. Real, but not failures |
| **Hard cap** | 60 lines, so the report is always readable |

On a realistic load this turns roughly 1,900 raw findings into **60 listed items** and a
short count table. Tighten further with `ITEMISE_FROM: "critical"`, or loosen with
`MAX_PER_CASE` and `MAX_ITEMISED`.

Every listed line carries the case's own detail — hours in the stage, who holds it — so
no two lines read the same and each can be judged on its own.

## Reviewer sign-off is deliberately not checked

Petition Studio has **no "reviewer approved" action**, so no field carries that meaning.
The closest one, `reviewer_last_sent_back_at`, means the reviewer sent the case **back**
for fixes, which is the opposite of approval.

Inventing a sign-off check from these fields would flag people for something the app
cannot record. What is checked instead is whether the reviewer **responded at all** after
being asked, and whether the **amendments were verified** — which is the real evidence
that a review happened.

Adding a sign-off action to Petition Studio is the only way to audit this properly.

## Two things to know about the data

1. **The brainstorm and client-approval stages are now covered by real filters**
   (`brainstorm`, `brainstorm_followup`, `client_approval`), so they no longer depend on
   reading event text. The `EVENT_MARKERS` patterns remain only as a fallback for the
   timeline pass.
2. **Stage timing comes from the API.** `stage.age_hours` is already counted in business
   hours on the company calendar, and `stage.clock_start_at` restarts the clock on the
   real waiting event for Internal review and Forms. That figure is used whenever it is
   present, because it matches the SLA policy exactly. The local business-hours settings
   only apply as a fallback.

---

## Running it

| Input | Choices |
|---|---|
| Mode | Compliance check · **Discover the API shape (run this first)** |
| Dry run | `true` = log + downloadable report, no email · `false` = send |
| How many cases | all / 25 / 50 / 100 / 250 |
| Report to | typed email address |

Scheduled daily at **11:30 AM PKT**. The HTML report is saved as a run artifact every
time, so a dry run still shows exactly what would be sent.

## Secrets

| Secret | What |
|---|---|
| `PETITION_API_KEY` | the `x-api-key` value from the API guide |
| `RESEND_KEY` | Resend API key for the report email |

**Keep the repo private** — the API key grants read access to every case.

## The team

The roster lives in `STAFF` in `config.js` — 14 people, matched by **name**, because
Petition Studio returns each assignee's name in the case record and not every writer
exists as a HubSpot user. Nothing needs typing beyond the name and the role.

| Role | People |
|---|---|
| Petition Writer | Aleena Najeeb · Umme Aimon · Tahir Khalil · Kushra Leigh Price · Faryal Khalid · Fatima Khalid · Aliza Ejaz · Samra Goraya · Samina Naseer |

| Brainstorm Specialist | Kysha d'Abdon |
| Petition Writer, **in training** | Stella · Sashalene Vas Vas · Yvette · Neline Van Zyl |

Spellings were verified against HubSpot and several differed from the original list:
**Aleena Najeeb** (not Najeed), **Kysha d'Abdon**, **Kushra Leigh Price**,
**Sashalene Vas Vas**, **Neline Van Zyl**.

**Writers in training** have their quality, control and document findings **raised one
level**, because their work is meant to be watched more closely while they train. The
finding says so explicitly, e.g. *"(writer in training: Stella)"*. Turn off with
`ESCALATE_FOR_TRAINEES: false`.

## Narrowing the audit

`STAFF_IN_SCOPE` is **empty**, so every case is audited. Add **names or emails** to
narrow it — `["Fatima", "Stella"]` works.

## Changing the rules

Every rule is a scenario in `selftest.js`. Run `node selftest.js` after any edit — it
reports `90 passed, 0 failed`. The workflow runs it before anything else, so a broken
rule stops the run.

## Still open

- Confirm the timeline for `ai_reading` and `advanced_review` (provisional — the
  workflow document does not name them).
- Reviewer sign-off cannot be audited until Petition Studio has a sign-off action (see
  above). The amendment loop covers most of what a sign-off would prove.
- Two filters are not yet used by any rule: `stage_age` buckets other than `stale`, and
  `drafting_health=in_internal_review`. Say the word if either should raise a flag.
- Confirm the working day: currently Sat–Sun as weekend, 9 hours per business day.
- The document-quality checks from the Basic Petition Documents Framework (EB-2
  eligibility floor, cross-document consistency, the §10 Case Analysis checklist) need
  document text, which this API does not expose. Ask Toheed whether document content or
  the Case Analysis text can be exposed, and they can be added.
