# Data profile — SE-004

**Status: profiling complete. No decisions made here.** D-002 (map provider) and D-004
(establishment types) are decided and logged in `docs/14-decision-log.md`, not in this
document — this document supplies the measurements those decisions rest on.

Generated 24 Aug 2026 against the current `safe-eats.db` (ingest_run ids 5–6, run at
2026-08-21T13:06:32Z–2026-08-21T13:06:33Z) and the raw extracts that ingest archived at
that run:

- `data/raw/active-licenses-2026-08-21T13-06-32-845Z.csv` (10,599 rows statewide, 35 columns)
- `data/raw/inspections-2026-08-21T13-06-33-122Z.csv` (3,421 rows statewide, 82 columns)

These are the exact bytes the current database was built from, so every number below is
reproducible against the committed archive without re-fetching. **Caveat:** this differs
slightly from the `docs/06-source-verification.md` record (10,599/4,305 for licenses
matches; 3,532 total / 1,338 county-60 for inspections does not — that verification row
was a separate fetch three hours later, at 02:45 UTC, and the upstream inspection extract
had already drifted by 111 rows in the interim, 3,421 vs 3,532. This is itself evidence
for how volatile the inspection extract is between two same-day pulls; it does not affect
anything below, which is all computed against the ingest's own archived bytes.)

All queries either run directly against `safe-eats.db` opened `{readonly:true}` with
`better-sqlite3`, or against the two archived CSVs parsed with the same `csv-parse/sync`
call `src/ingest.js` uses (`columns: header => header.map(h => h.trim())`, `bom:true`,
`trim:true`, `relax_column_count:true`). Every table states which. Full scripts are in
the appendix.

---

## 1. Null / blank rates

"Blank" means present but empty or whitespace-only after trim; "NULL" means the key was
absent from the parsed row (CSV) or the SQLite value is `NULL`. Missing = NULL + Blank.

### 1.1 Licence extract, `hrfood2.csv`, county-60 subset (n=4,305 of 35 columns)

The county-60 filter is exactly `src/ingest.js`'s `loadEstablishments` filter
(`Location County Code === '60'`) applied to the raw archive — i.e., this is precisely
the row set the ingest reads before its own per-field cleaning.

| Column | NULL | Blank | Missing | % |
|---|---|---|---|---|
| Modifier Code | 0 | 4305 | 4305 | 100.00% |
| Filler | 0 | 4305 | 4305 | 100.00% |
| Location Address Line 3 | 0 | 4305 | 4305 | 100.00% |
| Secondary Risk Level | 0 | 4268 | 4268 | 99.14% |
| Mailing Address Line 3 | 0 | 4239 | 4239 | 98.47% |
| Location Address Line 2 | 0 | 4223 | 4223 | 98.10% |
| Mailing Address Line 2 | 0 | 4000 | 4000 | 92.92% |
| Mailing Name | 0 | 2896 | 2896 | 67.27% |
| Primary Phone Number | 0 | 1032 | 1032 | 23.97% |
| Secondary Phone Number | 0 | 642 | 642 | 14.91% |
| **Base Risk Level** | 0 | 51 | 51 | **1.18%** |
| Last Inspection Date | 0 | 43 | 43 | 1.00% |
| Secondary Status Code | 0 | 35 | 35 | 0.81% |
| Mailing County Code | 0 | 32 | 32 | 0.74% |
| Mailing State Code | 0 | 1 | 1 | 0.02% |
| Business Name | 0 | 1 | 1 | 0.02% |
| Board Code | 0 | 0 | 0 | 0.00% |
| License Type Code | 0 | 0 | 0 | 0.00% |
| Licensee Name | 0 | 0 | 0 | 0.00% |
| Rank Code | 0 | 0 | 0 | 0.00% |
| Mailing Street Address | 0 | 0 | 0 | 0.00% |
| Mailing City | 0 | 0 | 0 | 0.00% |
| Mailing Zip Code | 0 | 0 | 0 | 0.00% |
| Location Street Address | 0 | 0 | 0 | 0.00% |
| Location City | 0 | 0 | 0 | 0.00% |
| Location State Code | 0 | 0 | 0 | 0.00% |
| Location Zip Code | 0 | 0 | 0 | 0.00% |
| Location County Code | 0 | 0 | 0 | 0.00% |
| Location County | 0 | 0 | 0 | 0.00% |
| District | 0 | 0 | 0 | 0.00% |
| Region | 0 | 0 | 0 | 0.00% |
| License Number | 0 | 0 | 0 | 0.00% |
| Primary Status Code | 0 | 0 | 0 | 0.00% |
| License Expiry Date | 0 | 0 | 0 | 0.00% |
| Number of Seats or Rental Units | 0 | 0 | 0 | 0.00% |

**MVP-plan-dependent columns above the 1% floor:** `Base Risk Level` (1.18%). `name`
(`Business Name`) is 0.02% — 1 row, `SEA6000392`, mailing name `ADAM LUSK`, which is why
`ingest.js`'s `row['Business Name'] || row['Mailing Name'] || 'UNKNOWN'` fallback exists;
it resolves to `ADAM LUSK` for that row, not `UNKNOWN`. `address`, `city`, `zip`,
`county_code`, `license_type_code`, `seats` are all 0.00% in the licence extract.
`Last Inspection Date` (used nowhere in the schema — `inspection_date` comes from the
inspection extract, not this field) is 1.00%, just over the floor; noted for completeness
since it names a date, but nothing in the plan reads this column.

### 1.2 Inspection extract, `2fdinspi.csv`, county-60 subset (n=1,305 of 82 columns)

| Column | NULL | Blank | Missing | % |
|---|---|---|---|---|
| **Number of Critical Violations** | 0 | 1305 | 1305 | **100.00%** |
| **Number of Noncritical Violations** | 0 | 1305 | 1305 | **100.00%** |
| All other 80 columns (District … Inspection Visit ID, including all 58 `Violation NN` columns, `Number of Total/High Priority/Intermediate/Basic Violations`, `Inspection Disposition`, `Inspection Date`) | 0 | 0 | 0 | 0.00% |

**This is the most consequential null-rate finding.** The schema comment in `src/db.js`
names "the six violation-count columns" (`critical_violations, noncritical_violations,
total_violations, high_violations, intermediate_violations, basic_violations`). Two of
those six — `Number of Critical Violations` and `Number of Noncritical Violations` — are
**empty in every single row of the source extract**, statewide and in county 60 alike
(verified against all 3,421 statewide rows, same result). The other four
(`Total`/`High Priority`/`Intermediate`/`Basic`) are populated in 100% of rows. This is
not an ingest bug: `src/ingest.js`'s `toInt('')` correctly returns `null`, and the DB
table confirms it (§1.3). The source appears to have replaced the old
critical/noncritical severity taxonomy with the high/intermediate/basic one and left the
two legacy columns in the schema but stopped populating them. Anything in the MVP plan
that would read `critical_violations` or `noncritical_violations` reads `NULL` for every
row currently in the database.

The 58 `Violation NN` columns are 0.00% blank because they hold literal `"0"` for
"not cited," not empty string — `src/ingest.js`'s unpivot step (`if (!count) continue`)
is what turns those into absent `violation` rows, not source blankness.

### 1.3 `establishment` table (n=4,305, SQLite, all 20 columns)

```sql
SELECT COUNT(*) FROM establishment WHERE <col> IS NULL;                         -- NULL
SELECT COUNT(*) FROM establishment WHERE <col> IS NOT NULL AND TRIM(<col>)='';  -- Blank (TEXT only)
```

| Column | Type | NULL | Blank | Missing | % |
|---|---|---|---|---|---|
| **risk_level** | TEXT | 0 | 51 | 51 | **1.18%** |
| lat | REAL | 49 | — | 49 | 1.14% |
| lng | REAL | 49 | — | 49 | 1.14% |
| geocode_source | TEXT | 49 | 0 | 49 | 1.14% |
| geocode_quality | TEXT | 49 | 0 | 49 | 1.14% |
| establishment_id / license_key / license_number / name / address / normalized_address / city / zip / county_code / county_name / district / license_type_code / seats / first_seen_at / last_seen_at | — | 0 | 0 | 0 | 0.00% |

`risk_level` missing is entirely the two license types that DBPR doesn't risk-score:
16 `2015/VEND` (vending machines) + 35 `2016/TEMP` (temporary events) = 51, confirmed
by cross-tab in §4. `lat`/`lng`/`geocode_source`/`geocode_quality` NULL = the 49
establishments with no geocode at all (§2, list given in full).

### 1.4 `inspection` table (n=1,305, SQLite, all 16 columns)

| Column | Type | NULL | Blank | Missing | % |
|---|---|---|---|---|---|
| **critical_violations** | INTEGER | 1305 | — | 1305 | **100.00%** |
| **noncritical_violations** | INTEGER | 1305 | — | 1305 | **100.00%** |
| all other 14 columns | — | 0 | 0 | 0 | 0.00% |

`inspection_date` is 0.00% missing and every value parses — see §4 for the actual date
range, which is a separate and more important finding than nullness.

---

## 2. Address pathology

All examples below are drawn from `establishment.address` (n=4,305), which is the raw
`Location Street Address` from the licence extract with only `.trim()` applied — no
other cleaning happens before it reaches the database. Counts are of establishments
matching a regex class; classes are not mutually exclusive. `geocode_quality` values in
this database are `Exact/L`, `Exact/R`, `Non_Exact/L`, `Non_Exact/R`,
`google:ROOFTOP`, `google:RANGE_INTERPOLATED`, `Non_Exact` (1 row), or `NULL` (no
coordinates at all) — "Exact" below means the value starts with `Exact`.

**Baseline for comparison:** 3,184 / 4,305 (74.0%) of all establishments are
`Exact/L` or `Exact/R`; 1,121 (26.0%) are not.

| Pathology class | Count | % | Exact-rate within class | Consequence |
|---|---|---|---|---|
| Fractional/lettered house number (e.g. `1111 N CONGRESS AVE` unit-style, or a letter suffix like `4A`) | 1,566 | 36.38% | 1,155/1,566 = 73.8% Exact | Close to baseline — mostly harmless when the geocoder handles the suffix; a minority still fail |
| Suite/unit/#/bldg/space fragment | 1,180 | 27.41% | 768/1,180 = 65.1% Exact | Below baseline — the plaza/mall unit ambiguity that `AC-E2-GATE`'s `plaza-ambiguity` cause code exists for |
| Double space (usually where a suite fragment was excised) | 210 | 4.88% | 153/210 = 72.9% Exact | Roughly baseline; a formatting artifact more than a geocoding hazard on its own |
| Plaza/mall/airport/stadium reference | 83 | 1.93% | 52/83 = 62.7% Exact | Below baseline — matches the `plaza-ambiguity` cause code directly |
| House-number range (e.g. `100-120`) | 22 | 0.51% | 0/22 = 0.0% Exact | Every single one fails to geocode exactly |
| Intersection (`&` / `AND` between two roads, or two unit numbers joined by `&`) | 19 | 0.44% | 0/19 = 0.0% Exact | Every single one fails to geocode exactly |
| No leading house number (starts with a word, not a digit) | 14 | 0.33% | 1/14 = 7.1% Exact | Near-total failure; 4 of the 14 have no coordinates at all |
| Embedded comma | 12 | 0.28% | 5/12 = 41.7% Exact | Well below baseline |
| Highway mile marker / "MM" | 6 | 0.14% | 0/6 = 0.0% Exact | Every single one fails; 2 of 6 have no coordinates at all |
| Contains lowercase letters (source is otherwise consistently upper-case) | 2 | 0.05% | 0/2 = 0.0% Exact | Both fail |
| PO Box | 0 | 0.00% | n/a | None found in this extract |
| "MOBILE" / food-truck / vendor / cart / trailer keyword in the address field | 0 | 0.00% | n/a | None found — mobile vendors (446 `2014/MFDV` + 25 `2014/HTDG`, §4) carry a real street address, typically a commissary, not a description |
| "VARIOUS"/description-not-location keyword (`VARIOUS`, `MULTIPLE`, `N/A`, `NONE`, `UNKNOWN`, `TBD`) | 0 | 0.00% | n/a | None found |
| Non-ASCII characters | 0 | 0.00% | n/a | None found in 4,305 addresses |
| Empty address | 0 | 0.00% | n/a | None — `address` is 0.00% missing (§1.1, §1.3) |

Every pathology class here correlates with a lower-than-baseline exact-geocode rate,
several of them (house-number ranges, intersections, mile markers, lowercase) at exactly
0%. This bears on the map-provider decision (D-002): the population these classes cover
is small in absolute terms (the largest, fractional/lettered numbers, is still only
36% of rows and close to baseline) but the worst classes fail geocoding *completely and
predictably*, which argues for either provider-side handling of these specific shapes or
manual/cached overrides rather than a blanket accuracy assumption.

Representative quoted examples (redacted nothing; full result set is larger, this is a
sample of the first several rows matched, address and its consequence):

- **Suite fragment, still geocodes exactly:** `"3101 PGA BLVD #L217"` — CHINATOWN, Palm
  Beach Gardens 33410-2816, `geocode_quality=Exact/R`.
- **Suite fragment, does not:** `"6864 FOREST HILL BLVD #A"` — DUFFY'S SPORTS GRILL,
  Greenacres 33413, `geocode_quality=Non_Exact/R`.
- **No geocode at all, no coordinates:** `"9910 ALT A1A STE 711"` — SWAMPGRASS WILLY`S
  BAR BQ, Palm Beach Gardens 33410, `geocode_quality=NULL`.
- **Double space plus suite, still exact:** `"3101 PGA BLVD  UNIT F142"` — PF CHANGS
  CHINA BISTRO, Palm Beach Gardens 33410-2820, `geocode_quality=Exact/R`.
- **Plaza reference, non-exact:** `"404 PLAZA REAL"` — MAX'S GRILL, Boca Raton
  33432-3939, `geocode_quality=Non_Exact/R`.
- **House-number range:** `"922-926 NORTH LAKE BLVD"` — LA FOGATA INC, Lake Park 33403,
  `geocode_quality=google:ROOFTOP`; `"6346 - 63 LANTANA RD"` — COLD STONE CREAMERY, Lake
  Worth 33463, `geocode_quality=Non_Exact/R`.
- **Intersection / joined units:** `"8177 W GLADES RD BAYS 1 & 2"` — BOCA BAGELWORKS,
  Boca Raton 33434, `geocode_quality=Non_Exact/R`; `"245A AND 245B WORTH AVE"` — LE
  BILBOQUET, Palm Beach 33480, `geocode_quality=Non_Exact/R`.
- **No leading house number, plaza-inside-airport style, no coordinates:**
  `"MM 94 FLORIDA TURNPIKE BLDG 9450"` — NATHAN'S C-STORE, Lake Worth 33467,
  `geocode_quality=google:ROOFTOP` (this one did resolve); `"WPB SERVICE PLAZA MM 93"` —
  WEST PALM BEACH PLAZA BURGER KING, Lake Worth 33467, `geocode_quality=NULL`.
- **Embedded comma:** `"1000 Palm BCH INTER ALRP, BLDG 1000 #124"` — BLU 20 BAR, West
  Palm Beach 33406, `geocode_quality=google:RANGE_INTERPOLATED` (also the one address
  with mixed-case: "Palm").
- **Highway mile marker:** `"MM 94 WEST PALM BEACH SERVICE PLAZA"` — ACUITY VENDING LLC,
  West Palm Beach 33413, `geocode_quality=NULL`.

### 2.1 The 49 establishments with no coordinates at all

`SELECT establishment_id, name, address, city, zip FROM establishment WHERE lat IS NULL`
— all 49, in full:

| establishment_id | name | address | city / zip |
|---|---|---|---|
| 6021178\|2010\|617 N A1A, JUPITER, 33477 | 3 SCOOPS | 617 N A1A | JUPITER 33477 |
| 6013532\|2015\|MM 94 WEST PALM BEACH SERVICE PLAZA, WEST PALM BEACH, 33413 | ACUITY VENDING LLC | MM 94 WEST PALM BEACH SERVICE PLAZA | WEST PALM BEACH 33413 |
| 6020993\|2010\|2345 SOUTH OCEAN BLVD, PALM BEACH, 33480 | AL FRESCO RESTAURANT AND BAR | 2345 SOUTH OCEAN BLVD | PALM BEACH 33480 |
| 6052848\|2014\|125 NW 31 TER, BOYNTON BEACH, 33436 | ANTHIS GREEK | 125 NW 31 TER | BOYNTON BEACH 33436 |
| 6019092\|2010\|400 AVENUE OF THE CHAMPIONS, PALM BEACH GARDENS, 33418 | BIRDIES | 400 AVENUE OF THE CHAMPIONS | PALM BEACH GARDENS 33418 |
| 6023084\|2010\|309 W AVE UNIT A, BELLE GLADE, 33430 | BLAZN DOUGH | 309 W AVE UNIT A | BELLE GLADE 33430 |
| 1651782\|2016\|101052 INDIANTOWN RD, JUPITER, 33478 | BOAT SHOW | 101052 INDIANTOWN  RD | JUPITER 33478 |
| 6022601\|2010\|9920 ALT ALT A1A STE 808, PALM BEACH GARDENS, 33410 | BOBA BABY | 9920 Alt ALT A1A STE 808 | PALM BEACH GARDENS 33410 |
| 6022137\|2010\|5320 DONALD ROSS ROAD, PALM BEACH GARDENS, 33418 | BOLAY | 5320 DONALD ROSS ROAD | PALM BEACH GARDENS 33418 |
| 6021082\|2010\|617 N A1A, JUPITER, 33477 | BURGER SHACK | 617 N A1A | JUPITER 33477 |
| 6005854\|2010\|400 AVENUE OF THE CHAMPIONS, PALM BEACH GARDENS, 33418 | BUTCHER'S CLUB | 400 AVENUE OF THE CHAMPIONS | PALM BEACH GARDENS 33418 |
| 6021628\|2010\|997 FLORIDA N A1A, JUPITER, 33477 | CORAL CONES | 997 FLORIDA N A1A | JUPITER 33477 |
| 6010759\|2010\|775 N ALT A1A, JUPITER, 33477 | DUNE DOG RESTAURANT | 775 N ALT A1A | JUPITER 33477 |
| 6023179\|2010\|131 N ALTERNATE A1A, JUPITER, 33477 | DUNKIN' | 131 N ALTERNATE A1A | JUPITER 33477 |
| 6000627\|2010\|17900 BEELINE HWY, JUPITER, 33478 | EUREST DINING SERVICES - EOB | 17900 BEELINE HWY | JUPITER 33478 |
| 6004779\|2010\|17900 BEELINE HWY, WEST PALM BEACH, 33410 | EUREST DINING SERVICES - TAB | 17900 BEELINE HWY | WEST PALM BEACH 33410 |
| 6004055\|2010\|17900 BEELINE HWY, WEST PALM BEACH, 33410 | EUREST DINING SERVICES-DFC | 17900 BEELINE HWY | WEST PALM BEACH 33410 |
| 6051909\|2014\|967 ALTERNATE A1A, JUPITER, 33477 | FOOD YACHT | 967 ALTERNATE A1A | JUPITER 33477 |
| 6013352\|2010\|11501 EL CLAIR RANCH RD, BOYNTON BEACH, 33437 | GREENHOUSE | 11501 EL CLAIR RANCH RD | BOYNTON BEACH 33437 |
| 6012480\|2010\|11501 EL CLAIR RANCH RD, BOYNTON BEACH, 33437 | GRILLE ROOM | 11501 EL CLAIR RANCH RD | BOYNTON BEACH 33437 |
| 6005681\|2010\|2400 HYPOLUXO RD, LANTANA, 33462 | HIGH RIDGE COUNTRY CLUB | 2400 HYPOLUXO RD | LANTANA 33462-3928 |
| 6011623\|2010\|1901 LAKERIDGE BLVD, BOCA RATON, 33496 | HUNAN CITY | 1901 LAKERIDGE BLVD | BOCA RATON 33496 |
| 6012479\|2010\|11501 EL CLAIR RANCH RD, BOYNTON BEACH, 33437 | INDIAN SPRING COUNTRY CLUB | 11501 EL CLAIR RANCH RD | BOYNTON BEACH 33437 |
| 6020826\|2010\|17370 ALT A1A STE 401, JUPITER, 33477 | KOON MANEE THAI AND SUSHI RESTAURANT | 17370 ALT A1A STE 401 | JUPITER 33477 |
| 6040835\|2016\|1325 PALM WILLAS WAY, PALM SPRINGS, 33461 | LA DOLCE ELEGANZA | 1325 PALM WILLAS WAY | PALM SPRINGS 33461 |
| 6022289\|2010\|5320 DONALD ROSS RD, PALM BEACH GARDENS, 33418 | LYNORAS | 5320 DONALD ROSS RD | PALM BEACH GARDENS 33418 |
| 6010192\|2010\|180 BUSINESS PKWY, WEST PALM BEACH, 33411 | MORGAN'S COUNTRY KITCHEN | 180 BUSINESS PKWY | WEST PALM BEACH 33411 |
| 6008072\|2010\|14125 NORTH RD, LOXAHATCHEE, 33470 | NATURALLY NUDE CAFE | 14125 NORTH RD | LOXAHATCHEE 33470 |
| 6022698\|2010\|9920 ALT A1A SPACE 709, PALM BEACH GARDENS, 33410 | NEVS BARBECUE | 9920 ALT A1A SPACE 709 | PALM BEACH GARDENS 33410 |
| 6011019\|2010\|2350 EXECUTIVE DR, BOCA RATON, 33431 | NEW YORK PRIME | 2350 EXECUTIVE DR | BOCA RATON 33431 |
| 6019198\|2010\|BLDG 1000 STE 124, WEST PALM BEACH, 33406 | NICKS TOMATOE PIE #2 | BLDG 1000  STE 124 | WEST PALM BEACH 33406 |
| 6005852\|2010\|400 AVENUE OF THE CHAMPIONS, PALM BEACH GARDENS, 33418 | PGA NATIONAL RESORT (BANQUETS) | 400 AVENUE OF THE CHAMPIONS | PALM BEACH GARDENS 33418 |
| 6005851\|2010\|400 AVENUE OF THE CHAMPIONS, PALM BEACH GARDENS, 33418 | PGA NATIONAL RESPORT AND SPA (EMPLOYEE CAFETARIA) | 400 AVENUE OF THE CHAMPIONS | PALM BEACH GARDENS 33418 |
| 6005855\|2010\|400 AVENUE OF THE CHAMPIONS, PALM BEACH GARDENS, 33418 | PGA NATIONAL RESPORT AND SPA (HONEYBELLE) | 400 AVENUE OF THE CHAMPIONS | PALM BEACH GARDENS 33418 |
| 6007788\|2010\|400 AVENUE OF THE CHAMPIONS, PALM BEACH GARDENS, 33418 | PGA NATIONAL RESPORT AND SPA (MEMBERS CLUBHOUSE) | 400 AVENUE OF THE CHAMPIONS | PALM BEACH GARDENS 33418 |
| 6012407\|2010\|400 AVENUE OF THE CHAMPIONS, PALM BEACH GARDENS, 33418 | PGA NATIONAL RESPORT AND SPA (WATERS OF THE WORLD) | 400 AVENUE OF THE CHAMPIONS | PALM BEACH GARDENS 33418 |
| 6013432\|2010\|560 N US HWY, TEQUESTA, 33469 | RIKO'S PIZZA | 560  N US HWY | TEQUESTA 33469 |
| 6021132\|2010\|113800 JOG RD 111, DELRAY BEACH, 33446 | RUVENS RESTAURANT AND DELICATESSEN | 113800 JOG RD #111 | DELRAY BEACH 33446 |
| 6022931\|2010\|1000 GATEWAY BLVD STES 101 AND 102, BOYNTON BEACH, 33426 | SUSHI BANG BANG | 1000 GATEWAY BLVD STES 101 AND 102 | BOYNTON BEACH 33426 |
| 6022914\|2010\|400 AVE OF THE CHAMPIONS, PALM BEACH GARDENS, 33418 | SUSHI BY BOU | 400 AVE OF THE CHAMPIONS | PALM BEACH GARDENS 33418 |
| 6011471\|2010\|9910 ALT A1A STE 711, PALM BEACH GARDENS, 33410 | SWAMPGRASS WILLY`S BAR BQ | 9910 ALT A1A STE 711 | PALM BEACH GARDENS 33410 |
| 6022512\|2010\|9920 ALTERNATE A1A STE 803, PALM BEACH GARDENS, 33410 | TACO DIVE | 9920 ALTERNATE A1A STE 803 | PALM BEACH GARDENS 33410 |
| 6052524\|2014\|13500 S SHORE BLVD, WELLINGTON, 33414 | TOASTIES | 13500 S SHORE BLVD | WELLINGTON 33414 |
| 6040851\|2016\|ATLANTIC AVE, DELRAY BEACH, 33444 | TOMMY CONCESSIONS MGMT | ATLANTIC AVE | DELRAY BEACH 33444 |
| 6052823\|2014\|13500 S SHORE BLVD, WELLINGTON, 33414 | TONY'S MEXICAN AND AMERICAN FOOD #1 | 13500 S SHORE BLVD | WELLINGTON 33414 |
| 6021522\|2010\|2803 N SR 7 200, WELLINGTON, 33414 | TROPICAL SMOOTHIE CAFE | 2803 N SR 7 200 | WELLINGTON 33414 |
| 6023203\|2010\|2792 DONNELLY DR, LANTANA, 33462 | VI AT LAKESIDE VILLAGE CAFE | 2792 DONNELLY DR | LANTANA 33462 |
| 6023194\|2010\|2792 DONNELLY DR, LANTANA, 33462 | VI AT LAKESIDE VILLAGE RESTAURANT | 2792 DONNELLY DR | LANTANA 33462 |
| 6021071\|2010\|WPB SERVICE PLAZA MM 93, LAKE WORTH, 33467 | WEST PALM BEACH PLAZA BURGER KING | WPB SERVICE PLAZA MM 93 | LAKE WORTH 33467 |

Reading this list: 8 of the 49 are the country-club/resort/airport-service-plaza
pattern (`400 AVENUE OF THE CHAMPIONS` x6, `WPB`/`W PALM BEACH SERVICE PLAZA` x2,
`EL CLAIR RANCH RD` x3) where several establishments legitimately share one campus
address but the geocoder found none of them. 2 are `ATLANTIC AVE`/`TOMMY CONCESSIONS
MGMT` and `13500 S SHORE BLVD` — street-only or stadium-style addresses. The rest are
ordinary-looking street addresses (e.g. `2345 SOUTH OCEAN BLVD`, `5320 DONALD ROSS
ROAD`) that simply did not resolve; nothing in the address text alone predicts all 49
(e.g. `617 N A1A` looks unremarkable and appears twice in this list, suggesting a
provider-side gap for that specific parcel rather than an address-formatting problem).

### 2.2 ZIP format

```sql
-- classified in JS against establishment.zip
```

4,113 rows are ZIP5-only (95.5%), 192 are ZIP+4 (4.5%), 0 are neither. No malformed ZIP
values exist in the establishment table.

### 2.3 City values

68 distinct `city` strings across 4,305 rows. The top 7 (West Palm Beach 927, Boca Raton
748, Delray Beach 393, Boynton Beach 371, Lake Worth 286, Palm Beach Gardens 273, Jupiter
251) account for 3,249 of 4,305 (75.5%) and are all real municipalities. Anomalies found
in the tail:

- `ROYAL PLM BEACH` — 15 rows, a typo for `ROYAL PALM BEACH` (118 rows, correctly
  spelled). Same ZIP prefix pattern (33411) as the correctly-spelled version.
- `GREEN ACRES` — 12 rows, vs. `GREENACRES` (86 rows) — the incorporated city's legal
  name is one word; this is an inconsistent-spacing variant, not a different place.
- `BOYTON BEACH` — 4 rows, a typo for `BOYNTON BEACH` (371 rows).
- `PALM SPRING` — 2 rows, missing the terminal S on `PALM SPRINGS` (66 rows).
- `VILLAGE OF WELLINGTO` — 7 rows, truncated (source field width cut off `WELLINGTON`);
  distinct from the 141 rows spelled `WELLINGTON`.
- `LAKE WORTH` (286) vs. `LAKE WORTH BEACH` (19) — **not** an anomaly: Lake Worth
  officially renamed itself Lake Worth Beach in 2019; both are real, current or former,
  incorporated names and the source extract has not normalized them to one.

### 2.4 ZIP-vs-city consistency

Methodology: for each ZIP5, take the most common `city` value in the data as "dominant"
and count rows carrying any other city for that same ZIP. 33 of 64 distinct ZIP5 values
in the data have more than one city string attached; 504 rows carry a non-dominant city
for their ZIP. The overwhelming majority of this is **not** a data error — Florida ZIP
codes routinely span municipal boundaries (e.g. ZIP 33411 is legitimately split between
Royal Palm Beach, 130 rows, and West Palm Beach, 103 rows) — except where the "other"
city is one of the typos in §2.3 (`ROYAL PLM BEACH` under 33411 is 15 of that ZIP's 103
"minority" rows). This measurement bears on any plan to validate or auto-correct `city`
from `zip` — a naive one-ZIP-one-city rule would be wrong for a third of the ZIPs
present.

---

## 3. Duplicate analysis

### 3.1 `License Number` collisions in the licence extract (county-60, n=4,305)

4,304 distinct `License Number` values across 4,305 rows. **Exactly one** collision:

```
License Number SEA6021991 x2:
  - DUNKIN DONUTS   | 4065 N HAVERHILL RD        | WEST PALM BEACH 33417 | type=2010
  - OFF THA BONE BBQ | 4065 N HAVERHILL RD STE B1 | WEST PALM BEACH 33417 | type=2010
```

Same building, two different suites, one licence number covering two distinct
businesses — this is the exact case `src/db.js`'s schema comment cites as the reason
`establishment_id` includes the normalized address rather than being license-number-only.
Confirmed against the current data: it is real, and it is the *only* one of its kind in
this extract.

### 3.2 `establishment_id` collisions

Recomputing `establishment_id = license_key|normalized_address` from the raw county-60
rows (before the DB's primary-key dedup) yields **4,305 distinct values for 4,305 rows —
zero collisions**. The `SEA6021991` pair above lands at two different addresses
(`...4065 N HAVERHILL RD` vs. `...4065 N HAVERHILL RD STE B1`, both normalized, differ
by the STE B1 token) so the composite key does keep both rows distinct, as designed. In
the live DB, `SELECT establishment_id, COUNT(*) FROM establishment GROUP BY
establishment_id HAVING COUNT(*)>1` also returns zero rows (expected — it's the primary
key).

### 3.3 `license_key` collisions

`license_key` (`digits(License Number)|digits(License Type Code)`) has exactly the same
one collision — `6021991|2010`, the same Dunkin Donuts / Off Tha Bone BBQ pair — because
both are `SEA6021991` with the alpha prefix stripped and the same license type. 4,304
distinct `license_key` values for 4,305 establishment rows. This is the one case in the
current data where `license_key` alone is *not* a valid establishment identifier and the
address component of `establishment_id` is load-bearing — evidence directly relevant to
the identity-key question in D-004/schema design.

### 3.4 Establishments sharing a normalized address

220 normalized addresses host more than one establishment (of 4,305 total, so ~10% of
rows share an address with at least one other). Split:

- **Same name repeated at the same address:** 20 address-groups, 41 rows total (e.g. a
  chain location licensed twice, or a renewal artifact — not investigated further here,
  flagged for whoever owns identity-key design).
- **Different names at the same address:** 200 address-groups, 644 rows total — this is
  the dominant pattern, not the exception, and it is what a shared-kitchen / food-hall /
  country-club/resort / plaza model looks like in this data.

Top addresses by establishment count:

| Address | Establishments | Distinct names | Sample |
|---|---|---|---|
| 411 S FEDERAL HWY, BOYNTON BEACH, 33435 | 23 | 23 | HOUR CUCINA LLC, BDS CATERING & PRODUCTIONS LLC, A TASTE OF AFRICA, PICNIC TRENDY FOOD, PCS PRIVATE CHEF SERVICES, PIQUANT CUISINE, … |
| 1025 N FLORIDA MANGO RD, WEST PALM BEACH, 33409 | 19 | 18 | BEST PIZZA HEAVEN, GERALD SWEETING, FAMILY BRICK OVEN PIZZA TRUCK, PIZZA MIKE LLC, HOT DOGS & MORE, FRESAS CON CREMA FOOD & GRILL, … |
| 8100 BELVEDERE RD STE 12, WEST PALM BEACH, 33411 | 18 | 17 | CLARK'S BBQ & MORE, BOCA SMASH, BAKERS CLUB, 4K PRIME MEALS LLC, CHEF TORI PERSONAL CHEF LLC, … |
| 501 E CAMINO REAL, BOCA RATON, 33432 | 15 | 15 | YACHT CLUB FOOD PREP, FLAMINGO GRILL, MIZNER CENTER, FLYBRIDGE/PALM COURT/PALMERA CAFE/MAISON ROSE, MULLIGANS, JAPANESE BOCCE CLUB, … |
| 4751 MAIN ST, JUPITER, 33458 | 13 | 13 | MARLIN'S FANFARE, ROGER DEAN STADIUM-CARDINAL FANFARE, ROGER DEAN STADIUM-COMMISSARY, ROGER DEAN STADIUM-FLORIDA GRILL, ST LOUIS GRILL, … |
| 150 NW 16 ST, BOCA RATON, 33432 | 11 | 11 | DRUNKEN TOAD, BILLYS CURBSIDE GRILL, CALAVERA COFFEE, 21 CONCESSIONS, MIMISKYS, PLATINUM TOUR TASTE LLC, … |
| 1 S COUNTY RD, PALM BEACH, 33480 | 9 | 9 | NEWS & GOURMET, CIRCLE AND HMF, BEACH CLUB RESTAURANT, BREAKERS PALM BEACH BANQUET SERVICES, ITALIAN RESTAURANT, SEAFOOD BAR, … |
| 4576 CRESTHAVEN BLVD, WEST PALM BEACH, 33415 | 9 | 9 | MI PATRIA TACOS CALLEJEROS, HALLELUJAHS KITCHEN, SENOR LECHON Y MAS LLC, GOOD TACO, LAS CHIAPANECAS CORP, TU DEBILIDAD TAQUERIA, … |
| 100 S OCEAN BOULEVARD, MANALAPAN, 33462 | 8 | 8 | ANGLE, BREEZE OCEAN KITCHEN / TRANQUILITY POOL BAR, EMPLOYEE CAFETERIA, LA COQUILLE CLUB, MEETING ROOMS, NOBU MANALAPAN, … |
| 8100 BELVEDERE RD, WEST PALM BEACH, 33411 | 8 | 8 | PLATTERS & CO, SERVICIOS CRIOLLA CUBANA LLC, DE PAILA ICE CREAM SHOP LLC, TOMA BOBA LLC, EBFOODS LLC, INDULGENCE CO., … |

`411 S FEDERAL HWY` and `1025 N FLORIDA MANGO RD` read as commissary/shared-kitchen
addresses used by many mobile-vendor licensees; `4751 MAIN ST` is Roger Dean Stadium
(one venue, many named food stands); `501 E CAMINO REAL` and `100 S OCEAN BOULEVARD` are
resort/club properties with many named outlets. This directly informs any map-pin
clustering or de-duplication design: a single physical pin can legitimately represent
20+ distinct licensed establishments.

### 3.5 Chains — same name, many addresses (top 20)

| Count | Name | Distinct addresses |
|---|---|---|
| 43 | DUNKIN DONUTS | 43 |
| 22 | SUBWAY | 22 |
| 13 | TROPICAL SMOOTHIE CAFE | 13 |
| 12 | DOMINO'S PIZZA | 12 |
| 10 | KFC | 10 |
| 9 | JERSEY MIKE'S SUBS | 9 |
| 8 | FIELD OF GREENS | 8 |
| 8 | PIZZA HUT | 8 |
| 8 | WENDY'S | 8 |
| 7 | BOLAY | 7 |
| 7 | BURGERFI | 7 |
| 7 | EM SQUARED RESTAURANTS LLC | 7 |
| 7 | JIMMY JOHNS | 7 |
| 7 | LITTLE CAESARS PIZZA | 7 |
| 6 | CARMELA COFFEE | 6 |
| 6 | DUFFY'S SPORTS GRILL | 6 |
| 6 | FIREHOUSE SUBS | 6 |
| 6 | HABIT BURGER GRILL | 6 |
| 6 | JERSEY MIKES SUBS | 6 |
| 6 | PURA VIDA MIAMI | 6 |

Note `JERSEY MIKE'S SUBS` (9, apostrophe) and `JERSEY MIKES SUBS` (6, no apostrophe) are
almost certainly the same chain split by punctuation inconsistency in the source — a
name-based chain rollup would need to normalize apostrophes, or it undercounts this
chain's true footprint at 15 rather than 9.

### 3.6 `Inspection Number` → `Inspection Visit ID` cardinality

Raw county-60 inspection extract, n=1,305 visit rows:

```
distinct Inspection Number (case) values: 1037
visits-per-case distribution: {"1 visit": 786 cases, "2 visits": 234 cases, "3 visits": 17 cases}
check: 786×1 + 234×2 + 17×3 = 786 + 468 + 51 = 1305 ✓
check: 786 + 234 + 17 = 1037 ✓
```

**`src/db.js`'s claim — "keying on Inspection Number collapses 1,305 visits to
1,037" — is confirmed exactly** against the currently ingested data: 1,305 visit rows
resolve to exactly 1,037 distinct case IDs, of which 251 cases (24.2% of all cases)
carry more than one visit, accounting for 519 of the 1,305 visit rows (39.8%).

Example 3-visit case (`3692876`), showing why keying on the case ID would destroy the
callback-outcome signal the schema comment describes:

```
case 3692876:
  visit 1  visitId=13642761  2026-07-14  "Administrative determination recommended"
  visit 2  visitId=13845026  2026-07-15  "Emergency Order Callback Not Complied"
  visit 3  visitId=13845907  2026-07-16  "Emergency Order Callback Complied"
```

Keying on `3692876` alone (the v1-style approach) leaves only one row surviving an
`INSERT OR REPLACE`/last-write-wins load, silently discarding whichever of "recommended
→ not complied → complied" isn't the last one parsed.

### 3.7 Join loss between `inspection` and `establishment`

```sql
SELECT COUNT(*) FROM inspection i
 WHERE NOT EXISTS (SELECT 1 FROM establishment e WHERE e.license_key = i.license_key);
```

- **Inspections with no matching establishment:** 15 of 1,305 (1.15%). All 15 examples
  captured; three are two visits of the same case (`3766150`, both a `Warning Issued`
  and its `Call Back - Complied`, `license_key=6023385|2010`). These are inspections of
  licences that have since lapsed, closed, or changed type between the two extracts —
  consistent with `src/ingest.js`'s comment ("orphans are inspections of licences that
  have since lapsed") though the counts in that comment (1,017 total / 14 orphans /
  98.6%) are from an earlier pull; against the currently ingested 1,305/15, the match
  rate is 98.85%, the same order of magnitude.
- **Establishments with no matching inspection:** 3,302 of 4,305 (76.70%) have *zero*
  inspections in this extract; only 1,003 of 4,305 (23.30%) have at least one. See §4 for
  why this is very likely a date-window artifact rather than a true coverage gap.

---

## 4. Coverage denominator

### 4.1 By licence type and rank

`License Type Code` alone is not self-describing; the extract also carries a `Rank Code`
that DBPR's own HR-7030/HR-7007 application forms document (`SEAT`/`NOST`/`CATR`/`MFDV`/
`HTDG`/`VEND`/`TEMP` — verified against `www2.myfloridalicense.com` form documentation,
external to this repository; not present in `docs/source-layouts.json` or the extract
itself). Every `License Type Code`/`Rank Code` pair present in this data, human-readable
meaning, count, and geocoded/inspected coverage:

| Code/Rank | Meaning | n | Geocoded | Inspected |
|---|---|---|---|---|
| 2010/SEAT | Fixed food service establishment, with seating | 3,263 | 3,224 (98.8%) | 857 (26.3%) |
| 2014/MFDV | Mobile Food Dispensing Vehicle (food truck) | 446 | 442 (99.1%) | 46 (10.3%) |
| 2010/NOST | Fixed food service establishment, no seating (takeout-only) | 396 | 394 (99.5%) | 86 (21.7%) |
| 2013/CATR | Caterer | 124 | 124 (100.0%) | 12 (9.7%) |
| 2016/TEMP | Temporary food service event | 35 | 32 (91.4%) | 0 (0.0%) |
| 2014/HTDG | Hot dog cart | 25 | 25 (100.0%) | 1 (4.0%) |
| 2015/VEND | Vending machine | 16 | 15 (93.8%) | 1 (6.3%) |
| **Total** | | **4,305** | **4,256 (98.86%)** | **1,003 (23.30%)** |

**What a diner would recognise as "a restaurant":** `2010/SEAT` + `2010/NOST` = 3,659 of
4,305 (85.0%). The remaining 646 (15.0%) are mobile/hot-dog vendors (471), caterers
(124), temporary events (35), and vending machines (16) — establishment types a diner
would generally not expect to find as a map pin next to a sit-down restaurant. This
measurement bears directly on D-004 (which establishment types to include); it does not
recommend an inclusion rule.

### 4.2 By `risk_level`

```sql
SELECT risk_level, COUNT(*) FROM establishment GROUP BY risk_level ORDER BY COUNT(*) DESC;
```

| risk_level | n |
|---|---|
| Risk Level 2 | 3,066 |
| Risk Level 1 | 1,185 |
| *(blank)* | 51 |
| Risk Level 3 - HSP | 2 |
| Risk Level Undecided | 1 |

The 51 blanks are exactly the 16 `2015/VEND` + 35 `2016/TEMP` rows (16+35=51, confirmed
by cross-tab) — DBPR does not risk-score vending machines or one-off temporary events, so
this is a structural non-applicability, not missing data, for those two types.

### 4.3 Overall inspection coverage and date range

```sql
SELECT COUNT(*) FROM establishment e
 WHERE EXISTS (SELECT 1 FROM inspection i WHERE i.license_key = e.license_key);
-- 1,003 of 4,305 = 23.30%

SELECT MIN(inspection_date), MAX(inspection_date) FROM inspection;
-- 2026-07-01 .. 2026-08-20
```

**23.30% of establishments have any inspection at all in this extract, and every
inspection in the database falls between 2026-07-01 and 2026-08-20 — a 51-day window.**
This is very likely why 76.70% of establishments show no inspection (§3.7): the
`2fdinspi.csv` extract is not a rolling multi-year history, it is a recent-activity feed
covering roughly seven weeks. This is the single most important number for the
history-depth decision: whatever "24 months" of lookback the §5 signal table in
`docs/40-mvp-plan.md` describes cannot be built from this extract alone as currently
observed — the extract itself carries at most ~7 weeks of visits at any one fetch, not
24 months. Whether that is because the source is a rolling recent-activity window (and a
longer history exists elsewhere or accumulates extract-over-extract) or because this
count is simply what's active right now is not something this profiling pass can
determine from a single extract snapshot; it needs either a documented statement from
DBPR about the extract's window, or repeated fetches over time to observe whether the
window slides.

---

## Appendix — reproduction

All scripts below were run from the repository root with `node`, against
`safe-eats.db` opened read-only and the two archived CSVs named at the top of this
document. They are not committed to the repository; reproduce by pasting into a
scratch `.js` file and running with `node <file>.js`.

**Null rates, raw extracts and county-60 subsets (§1.1, §1.2):**

```js
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const parseCsv = (buf) => parse(buf, {
  columns: (h) => h.map((c) => c.trim()), skip_empty_lines: true,
  relax_column_count: true, bom: true, trim: true,
});
const lic = parseCsv(fs.readFileSync('data/raw/active-licenses-2026-08-21T13-06-32-845Z.csv'));
const ins = parseCsv(fs.readFileSync('data/raw/inspections-2026-08-21T13-06-33-122Z.csv'));
const licCounty = lic.filter(r => (r['Location County Code']||'').trim() === '60');
const insCounty = ins.filter(r => (r['County Number']||'').trim() === '60');
function profile(rows) {
  const cols = Object.keys(rows[0]); const total = rows.length; const out = [];
  for (const col of cols) {
    let nullCount = 0, blankCount = 0;
    for (const r of rows) {
      const v = r[col];
      if (v === undefined || v === null) { nullCount++; continue; }
      if (v.toString().trim() === '') blankCount++;
    }
    out.push({ col, nullCount, blankCount, missing: nullCount + blankCount, pct: (nullCount + blankCount) / total * 100 });
  }
  return out.sort((a, b) => b.pct - a.pct);
}
console.log(profile(licCounty)); console.log(profile(insCounty));
```

**Null rates, DB tables (§1.3, §1.4):**

```js
const Database = require('better-sqlite3');
const db = new Database('safe-eats.db', { readonly: true });
function profileTable(table) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const total = db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  return cols.map(c => {
    const nullCount = db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${c.name} IS NULL`).get().n;
    const blankCount = c.type === 'TEXT'
      ? db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${c.name} IS NOT NULL AND TRIM(${c.name})=''`).get().n : 0;
    return { col: c.name, type: c.type, nullCount, blankCount, missing: nullCount + blankCount, pct: (nullCount + blankCount) / total * 100 };
  }).sort((a, b) => b.pct - a.pct);
}
console.log(profileTable('establishment')); console.log(profileTable('inspection'));
```

**Address pathology and geocode cross-reference (§2):**

```js
const Database = require('better-sqlite3');
const db = new Database('safe-eats.db', { readonly: true });
const rows = db.prepare(`SELECT establishment_id, name, address, city, zip, geocode_quality FROM establishment`).all();
const classes = {
  'suite/unit/#/bldg/space fragment': /\b(STE|SUITE|UNIT|BLDG|BUILDING|SPACE|SPC|APT|RM|ROOM|FL|FLOOR|LOT)\b|#/i,
  'PO Box': /\bP\.?\s*O\.?\s*BOX\b/i,
  'MOBILE/vendor keyword': /\bMOBILE\b|\bFOOD\s*TRUCK\b|\bVENDOR\b|\bCART\b|\bTRAILER\b/i,
  'VARIOUS/description': /\bVARIOUS\b|\bDIFFERENT\b|\bMULTIPLE\b|\bN\/?A\b|\bNONE\b|\bUNKNOWN\b|\bTBD\b/i,
  'house-number range': /^\d+\s*-\s*\d+\s/,
  'fractional/lettered house number': /^\d+\s*(1\/2|[A-Z])\b/,
  'intersection': /\s(&|AND)\s/i,
  'highway mile marker': /\bM\.?M\.?\s*\d|\bMILE\s*MARKER\b/i,
  'plaza/mall/airport/stadium': /\b(PLAZA|MALL|AIRPORT|STADIUM|ARENA|CTR|CENTER|CENTRE)\b/i,
  'embedded comma': null, // s.includes(',')
  'double space': /  +/,
  'non-ASCII': /[^\x00-\x7F]/,
  'lowercase letters': /[a-z]/,
};
const isExact = (q) => typeof q === 'string' && q.startsWith('Exact');
// count matches, cross-tab against isExact(r.geocode_quality); see full script for 'no leading house number' and 'empty address', which use string tests rather than regex.
```

**Duplicate analysis (§3):** license/establishment_id/license_key collisions, address
grouping, chain rollup, Inspection Number → Visit ID cardinality, and join-loss queries
all run directly against `safe-eats.db` with plain `GROUP BY … HAVING COUNT(*) > 1` and
`NOT EXISTS` correlated subqueries on `license_key`, plus one pass over the raw
county-60 inspection JSON grouping by `Inspection Number`. See §3.1–§3.7 for the exact
predicates; each number quoted there is a direct `COUNT(*)` from one such query.

**Coverage denominator (§4):** `GROUP BY license_type_code`, a left-hand map of
`License Number → Rank Code` built from the raw county-60 licence rows (the DB doesn't
store `Rank Code`), and `EXISTS`/`NOT EXISTS` against `inspection.license_key` for the
geocoded/inspected columns. Rank-code meanings (`SEAT`/`NOST`/`CATR`/`MFDV`/`HTDG`/
`VEND`/`TEMP`) are sourced from DBPR's public HR-7030/HR-7007 licence application forms,
not from any file in this repository — flagged as external knowledge, not a DBPR extract
field.
