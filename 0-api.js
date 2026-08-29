// 0-api.js — Petition Studio Case History API client (read-only, GET only).
const { SETTINGS } = require("./config");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path) {
  const key = process.env.PETITION_API_KEY;
  if (!key) throw new Error("Missing PETITION_API_KEY secret");
  const url = path.startsWith("http") ? path : `${SETTINGS.API_BASE}${path}`;
  for (let a = 0; a < 5; a++) {
    let res;
    try { res = await fetch(url, { headers: { "x-api-key": key, Accept: "application/json" } }); }
    catch (e) { if (a === 4) throw new Error(`Cannot reach ${url}: ${e.message}`); await sleep(1500 * (a + 1)); continue; }
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * (a + 1)); continue; }
    if (res.status === 401) throw new Error("401 — the API key was rejected");
    if (!res.ok) throw new Error(`${url} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
  throw new Error(`Petition Studio kept failing: ${url}`);
}

// Turns { brainstorm: "overdue,not_scheduled", hold: "hide" } into a query string.
// Different filters mean AND; comma-joined options inside one filter mean "any of".
function qs(filters = {}) {
  const parts = Object.entries(filters)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v.join(",") : v)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

const asList = (r) => (Array.isArray(r) ? r : (r?.cases || r?.data || r?.results || []));

// Every audit query hides cases that are on hold, unless told otherwise. A paused case
// is not a late case, and flagging it is the fastest way to lose the team's trust.
async function listCases(filters = {}, { includeOnHold = false } = {}) {
  const f = { ...filters };
  if (!includeOnHold && f.hold === undefined) f.hold = "hide";
  return asList(await api(`/external/case-history${qs(f)}`));
}

const caseHistory = (caseId) => api(`/external/case-history/${encodeURIComponent(caseId)}`);

// FULL case detail: intake profile, documents, the drafted petition, forms, client
// review and the whole history, in one call. This is what makes document and content
// compliance possible at all.
const getCase = (caseId) => api(`/external/cases/${encodeURIComponent(caseId)}`);

// Search by name or email. Capped at 15 results, so it is for looking up a client,
// not for enumerating the caseload — use the filtered case-history list for that.
const searchCases = (q, minAgeDays) =>
  api(`/external/cases/search?q=${encodeURIComponent(q)}${minAgeDays ? `&min_age_days=${minAgeDays}` : ""}`);
const listFilters = () => api("/external/case-history/filters");

async function mapPool(items, limit, fn) {
  const out = []; let i = 0;
  await Promise.all(Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx]); } catch (e) { out[idx] = { error: e.message }; } }
  }));
  return out;
}

module.exports = { api, listCases, caseHistory, getCase, searchCases, listFilters, mapPool, qs };
