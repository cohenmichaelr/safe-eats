# v1 Audit Findings — Safe Eats USA

| Field | Value |
|---|---|
| Document ID | AUD-SE-001 |
| Version | 1.0 |
| Date | 21 August 2026 |
| Auditor | Developer (self-audit) |
| Subject | `Projects/safe-eats-usa` @ `ecb233a` |
| Referenced by | PRD-SE-100 (E1, E2, E3, E6) |
| Status | Complete — evidence verified against live sources |

---

## 1. Purpose

The PRD cites finding IDs from this document as justification for its requirements. It was written after the fact, from direct measurement of the v1 codebase and live upstream sources on 21 August 2026. Every finding below is evidence-backed, not recalled.

Findings are rated by whether they *caused* the two symptoms that motivated the rebuild: **"not very fast"** and **"not very accurate."**

---

## 2. Finding summary

| ID | Severity | Finding | Symptom caused |
|---|---|---|---|
| F1 | **Critical** | Ingest targets a dead host; HTML error pages stored as `.csv` | Inaccurate — 3.5-year-old data |
| F2 | **Critical** | Failed downloads warn but do not abort | Inaccurate — silent staleness |
| F3 | **High** | 1.6% of records geocoded | Slow + inaccurate — forces runtime matching |
| F4 | **High** | `INSERT OR REPLACE` destroys accumulated coordinates | Inaccurate — geocoding never accumulates |
| F5 | **High** | Runtime fuzzy matching on first word of name | Inaccurate — false pin matches |
| F6 | **High** | N+1 queries per search result | Slow |
| F7 | **Medium** | Scrapes a news site instead of the state source | Fragile + legally exposed |
| F8 | **Medium** | `food_entities` empty; every grocery lookup hits live Puppeteer | Slow — headless browser in request path |
| F9 | **Medium** | No inspection history table despite advertising 12-month history | Feature does not exist as documented |
| F10 | **Low** | 28 MB database and error pages tracked in git | Repo hygiene |
| F11 | **Low** | No tests, no lint, no CI | No regression safety |

---

## 3. Findings in detail

### F1 — Ingest targets a dead host `Critical`

`scripts/download-fl-data.js` requests:

```
https://www.myfloridalicense.com/dbpr/hr/inspections/StatewideFoodServiceInspectionsFY2324.csv
https://www.myfloridalicense.com/dbpr/hr/inspections/StatewideFoodServiceInspectionsFY2425.csv
```

That host now serves a WordPress marketing site. The request follows redirects (`maxRedirects: 5`) and saves the homepage HTML under a `.csv` extension.

**Evidence.** Three files in the repository are byte-identical error pages, each ~194 KB, each beginning `<!DOCTYPE html>` and containing `<title>MyFloridaLicense.com – License efficiently. Regulate fairly.</title>`:

- `data/florida_inspections_2023_2024.csv`
- `data/florida_inspections_2024_2025.csv`
- `data/statewide_licenses.csv`
- `inspect.csv` (committed at repository root)

**Consequence.** The only real data ever loaded is `data/fdinspi_2223.csv` — fiscal year 2022–23. The production database holds 64,110 rows with inspection dates spanning **1 July 2022 to 10 January 2023**. As of this audit that data is three and a half years old, and the site presents it without qualification.

**Correct sources.** Verified live on 21 August 2026, both returning HTTP 200 with `Content-Type: text/csv`:

| Dataset | URL pattern | Breakdown |
|---|---|---|
| Current-FY inspections | `https://www2.myfloridalicense.com/sto/file_download/extracts/{1-7}fdinspi.csv` | 7 districts |
| Active licenses | `https://www2.myfloridalicense.com/sto/file_download/extracts/hrfood{1-7}.csv` | 7 districts |
| Emergency closures | Weekly XLSX | Statewide |
| Disciplinary actions | Monthly CSV | Statewide |
| Historical inspections | XLSX/CSV | FY2122–FY2526 |

The host moved from `www.` to `www2.` and the path from `/dbpr/hr/inspections/` to `/sto/file_download/extracts/`. Filenames changed from descriptive (`StatewideFoodServiceInspectionsFY2425.csv`) to district-numbered (`2fdinspi.csv`).

> **Remediated by:** FR-101, FR-102, FR-103

---

### F2 — Failure is logged, not enforced `Critical`

`download-fl-data.js` detects both failure modes and proceeds anyway:

```js
if (contentType.includes('text/html')) {
    console.warn(`Warning: Received HTML instead of CSV for ${dataset.name}...`);
}
// ...
if (stats.size < 5000) {
    console.warn(`Warning: ${dataset.file} is very small...`);
}
```

Neither branch throws, exits non-zero, or prevents the write. The file is saved regardless.

`import-to-db.js` does skip HTML files:

```js
if (contentSample.trim().startsWith('<!DOCTYPE')) {
    console.log(`Skipping ${file} (HTML error page detected)`);
    continue;
}
```

This is the more dangerous of the two behaviours. The import "succeeds," exits zero, and leaves the previous stale rows in place — so the pipeline reports success while serving 2022 data. A hard failure would have surfaced the problem in 2024.

**This finding is the single reason the product is inaccurate.** Everything else on this list degrades quality; F1 and F2 together froze the dataset for three years without a single error.

> **Remediated by:** FR-106, FR-107, FR-109, FR-110

---

### F3 — 1.6% geocoding coverage `High`

| Metric | Count |
|---|---|
| Rows in `restaurants` | 64,110 |
| Rows with a non-null, non-zero latitude | **1,009** |
| Coverage | **1.57%** |

Because 98.4% of records have no coordinates, the map cannot be drawn from the database. Instead `/map` queries Google Places for pins and then attempts to attach a health status to each result by string-matching it against the database at request time — which is the direct cause of F5 and F6.

**Correctly sized.** The Palm Beach establishment universe, measured from the live `hrfood2.csv` active-license extract: **4,305 licensed establishments, 3,898 distinct location addresses**, every one carrying a ZIP+4. This is a one-time batch geocode of under 4,000 well-formed US addresses — free via the Census Bureau batch geocoder, or roughly $20 at Google's rate.

The v1 approach solved a hard problem (match arbitrary Google results to inspection records) to avoid an easy one (geocode 3,898 known addresses once).

> **Remediated by:** FR-201 through FR-209

---

### F4 — Idempotency destroys coordinates `High`

`import-to-db.js` writes:

```sql
INSERT OR REPLACE INTO restaurants
(id, name, address, city, zip, county, type, status, last_inspection_date, violation_count, url)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

In SQLite, `INSERT OR REPLACE` on a primary-key conflict **deletes the existing row and inserts a new one**. `latitude` and `longitude` are absent from the column list, so every conflicting row loses its coordinates to `NULL` on each import.

`scripts/bulk-geocode.js` and `POST /api/database/update-location` accumulate coordinates; the next `npm run import-db` silently discards them. F3's 1.6% coverage is not merely incomplete — it is actively reset on every ingest.

> **Remediated by:** FR-108, FR-205

---

### F5 — Runtime matching on the first word of the name `High`

Both `server.js` and `adapters/florida-dbpr.js` fall back to:

```js
const firstWord = name.split(' ')[0] + '%';
const streetNum = (fullAddress || '').split(' ')[0] + '%';
// SELECT * FROM restaurants WHERE name LIKE ? AND address LIKE ?
```

A search for a Boca Raton "Village Tavern" matches any establishment in the county whose name starts with "Village" at a street number starting with the same digits. In `florida-dbpr.js` the second-tier fallback drops the address constraint entirely and returns up to 100 name-prefix matches to Fuse.js at `threshold: 0.4`, then takes `results[0]` with no minimum-score floor — so a poor match is returned as confidently as a good one.

Chains compound this. `MCDONALDS 7749` and `MCDONALDS REST OF FLORIDA INC` are distinct licenses; first-word matching cannot separate them, and no confidence value is surfaced to the user.

> **Remediated by:** FR-202, FR-204, FR-207, FR-208

---

### F6 — N+1 queries per search `High`

`/map` opens one SQLite connection, then for each of up to 15 Google results issues one query, and on miss a second:

```js
await Promise.all(results.results.map(async (resItem) => { /* db.get, then db.get again */ }));
```

Up to 30 queries per search, against a 28 MB database whose only indexes are `name`, `county`, and `city` — none of which serve the `address LIKE '123%'` predicate. Combined with a Google Places round-trip on the critical path, this is the source of the perceived slowness.

The rebuilt design has no runtime matching at all: pins come from the local geocoded table via a bounding-box query.

> **Remediated by:** FR-401, NFR set

---

### F7 — Scrapes a news site rather than the state `Medium`

`scripts/build-pbp-database.js` drives Puppeteer across `data.palmbeachpost.com/restaurant-inspections/{county}/` for all 67 counties, and `adapters/florida-dbpr.js` regex-parses the same site's HTML as a live fallback.

Three problems: the Palm Beach Post is a secondary republisher, so its data is a lagged copy of DBPR's; the parser breaks on any markup change, and the crawler already carries `if (currentPage > 10) keepGoing = false;` — a hard cap that silently truncates every county to ten pages; and scraping a commercial news site for republication carries terms-of-service exposure that the authoritative state extract does not.

The state extracts made this entire subsystem unnecessary. Both files are deleted in the rebuild.

> **Remediated by:** FR-101 (authoritative source), charter §4.2

---

### F8 — Empty fallback table forces a browser into the request path `Medium`

`food_entities` contains **0 rows**. `adapters/florida-fdacs.js` is therefore local-first in name only: every grocery or convenience-store lookup misses and launches Puppeteer against the FDACS ASP.NET portal, inside the user's request. A headless Chrome launch is seconds of latency at best and a timeout at worst.

FDACS retail food data is already out of scope for v1.0 (charter §4.2). The adapter is deleted rather than fixed.

---

### F9 — Advertised feature has no schema `Medium`

The README promises "a 12-month log of past inspections for every restaurant." The `restaurants` table holds one `status` and one `last_inspection_date` per row — a single point in time, with no history table anywhere in the schema. History is fetched live by scraping a Palm Beach Post profile page (F7), so it exists only when that scrape succeeds.

The source data supports this properly: the inspection extract is one row per inspection, keyed by `Inspection Number` with a `License ID` foreign key, carrying 58 wide violation columns to unpivot.

> **Remediated by:** FR-105 (unpivot), E5

---

### F10 — Data artifacts tracked in git `Low`

`git ls-files` returns `pbp_restaurants.db` (28 MB), `scripts/pbp_restaurants.db`, and `inspect.csv` (an HTML error page). `.gitignore` covers `data/` but not the database or root-level CSVs, and the database shows as modified on every run.

---

### F11 — No tests, no lint, no CI `Low`

`npm test` is the default `exit 1` placeholder. No lint configuration. No CI workflow. Twelve of the twenty files in `scripts/` are one-off `check-*` / `debug-*` / `test-*` helpers that duplicate each other — the residue of debugging without a test harness.

---

## 4. What this audit changes about the rebuild

Three conclusions, each of which shrinks the project:

1. **The authoritative extracts remove the entire scraping subsystem.** Puppeteer, the Palm Beach Post crawler, the FDACS adapter, and the live-fallback paths all disappear — replaced by two HTTP GETs against files the state publishes continuously.

2. **Geocoding the known universe removes the matching problem.** 3,898 addresses geocoded once is strictly easier than matching arbitrary Google Places results at request time, and it eliminates F3, F5, and F6 together.

3. **Google Places is not required for core discovery.** Once the authoritative establishments carry coordinates, pins are served from local data. Places becomes optional enrichment (photos, ratings) rather than a dependency on the critical path — which removes its cost, its latency, and its matching burden.

---

## 5. Verification method

| Finding | How verified |
|---|---|
| F1 | `head -c` on each `.csv`; `grep` for `<title>`; live `curl` of old and new URL patterns |
| F2 | Source reading of `download-fl-data.js`, `import-to-db.js` |
| F3 | `SELECT COUNT(*) FROM restaurants WHERE latitude IS NOT NULL AND latitude != 0` |
| F4 | Schema inspection vs. `INSERT OR REPLACE` column list |
| F5, F6 | Source reading of `server.js` `/map`, `adapters/florida-dbpr.js` |
| F7 | Source reading of `build-pbp-database.js` |
| F8 | `SELECT COUNT(*) FROM food_entities` → 0 |
| F9 | `sqlite_master` schema dump vs. README claims |
| F10 | `git ls-files` |
| F11 | `package.json`, directory listing |

Upstream verification on 21 August 2026 additionally confirmed: District 2 contains exactly Broward, Martin, and Palm Beach; Palm Beach is county code `60`; the current-FY extract carries 82 columns and inspection dates through 20 August 2026; and District 2 holds 1,305 Palm Beach inspection rows across 1,017 distinct establishments for FY2627 to date.
