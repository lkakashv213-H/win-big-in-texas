# LotChance - Progress & Changes Log

## Date: 2026-06-10

---

### Round 4: English/Spanish Localization

**New file `i18n.js`** (identical in root, `dist/`, `android-app/www/`):
- 193-key English/Spanish dictionary covering every user-visible string (dashboard, top picks, insights, filters, game cards, modals, retailer search, Near Me, notifications, footer)
- Global `t(key, params)` helper with `{placeholder}` substitution; missing keys fall back to English, then to the key itself
- First launch (no saved language): bilingual picker overlay ("Choose your language / Elige tu idioma")
- Header globe button (`#langSwitcher`) reopens the picker any time; choice persists in `localStorage('lotchance.lang')`
- Static HTML translated via `data-i18n` / `data-i18n-placeholder` attributes; dynamic JS strings call `t()` at render time; switching language live re-renders all sections without a reload

**Patched in all three copies** (107 patterns per app.js, 84 per index.html, asserted by script):
- `app.js` — all dynamic strings routed through `t()`, including pluralized forms (e.g. `retailer.carriersOne`/`carriersMany`) and game-type labels
- `index.html` — `data-i18n` attributes, language button, `i18n.js` script tag (loads before app.js)
- `styles.css` — language switcher + picker overlay styles

**Verified:** en/es key sets identical (193 each); all 186 referenced keys defined; placeholder substitution incl. `${price}` cases unit-tested; syntax-checked; APK rebuilt with assets synced (`WinBigInTexas-debug.apk`, 2026-06-10).

---

### Round 3: Retailer Search ("Find Nearby") Overhaul + Backport

#### 10. CRITICAL: Texas Lottery Retailer Locator city search is case-sensitive
**Problem:** The official locator JSP matches city names exactly and stores them uppercase — `city=AUSTIN` returns 590 rows, `city=Austin` returns **0**. Reverse-geocoding (used by "Use My Location" and Near Me mode) produces title-case city names, so every city-based retailer search silently returned nothing. This was the main cause of "find nearby shops sometimes does nothing".

**Fix:** `city` is now uppercased before being sent to the locator, in all four scraper copies: root `scraper.js`, root `server.js` (`scrapeTexasLotteryRetailers`), `dist/scraper.js`, and `android-app/www/scraper.js` (synced to Android assets).

#### 11. CRITICAL: April retailer-search rework was never backported to the locally-served files
**Problem:** The `dist/` Netlify build (April 30) contained a full rework of the retailer search — but `npm start` serves the **root** files, which were still the old March 23 code with these bugs:
- `bindEvents` bound a click handler to `this.searchRetailers()`, a method that didn't exist → TypeError on every Search click
- Failed searches fell back to `generateNearbyRetailers()` which fabricated **random fake stores** with fake addresses/phones ("wrong/weird results")
- The browser called nominatim.openstreetmap.org directly at ~5 req/s (policy limit is 1 req/s, and browsers can't send the required identifying User-Agent) → geocoding randomly failed → empty maps
- No race protection: overlapping searches interleaved their results

**Fix:** Backported `dist/app.js` to root, adapted for Express:
- Games still come from `GET /api/games` (server-side scrape with live overall odds — better data than the dist client-side scrape)
- Retailer search now uses the reworked `runRetailerSearch` pipeline: search-token race protection, expanding ZIP-ring search, "carries this game" tagging (green markers/badges via the locator's `gameNumber` filter), auto re-search on map pan/zoom
- `searchRetailers()` alias added (fixes the dead button binding)
- `generateNearbyRetailers()` fake-data generator deleted entirely
- Location persists in localStorage between sessions
- Copied `scraper.js` to root and added `<script src="scraper.js">` to `index.html`
- `styles.css` updated from dist (carrier badges, readable map popups, mobile stat-card fixes)

#### 12. New same-origin proxy routes in server.js
Mirrors `dist/netlify.toml` so the same frontend code runs locally and on Netlify:
- `/proxy/csv`, `/proxy/all`, `/proxy/details/:slug`, `/proxy/retailers` → texaslottery.com (browser User-Agent, one automatic retry on transient network errors like the `ENOTFOUND` DNS hiccups seen during testing)
- `/proxy/nominatim/search|reverse` → adds the identifying User-Agent the Nominatim policy requires and caches responses for 1 hour (repeat geocodes are instant and don't burn rate limit)

#### Verified (live, 2026-06-09)
| Test | Result |
|------|--------|
| `GET /api/games` | 77 games, 73 with real odds |
| `/proxy/retailers` zip=78701 | 11 retailers parsed (real: 2ND STREET MARKET, 7-Elevens…) |
| `/proxy/retailers` zip=78701 + gameNumber | carrier filtering works (5 rows for game 2744) |
| `/proxy/retailers` city=Round Rock | 80 retailers (was 0 before uppercase fix) |
| `/proxy/nominatim/search` (retailer address) | geocodes to 30.264, -97.742 |
| `/proxy/nominatim/reverse` (30.2672,-97.7431) | 78701 / Austin |
| Nominatim cache | 2nd identical request served in 2 ms |
| Legacy `/api/retailers?zip=78701` | still works (5 retailers) |

---

## Date: 2026-03-23

---

### Round 2: Overall Odds Fix

#### 9. CRITICAL: Overall Odds Were Fake For All Games
**Problem:** The CSV data source (added in Round 1) does not include overall odds. All 89 games had `overallOdds: null` from the server. The frontend then defaulted every game to `4.0` and displayed "1:4.00" as if it were real data. This meant:
- "Best Overall Odds" top 5 list was meaningless (all showed 1:4.00)
- "Adjusted Jackpot Odds" on every card was wrong
- Value scores and budget rankings were inaccurate
- "Best $5/$10/$20 game" insights were wrong

**Fix (server):**
- Added `scrapeDetailUrlsAndOdds()` — extracts detail page URLs from the HTML all-games page (URLs use content hashes like `details.html_252699574.html`, not game IDs)
- Added `fetchOverallOdds()` — scrapes overall odds text from each detail page
- Added `fetchAllOverallOdds()` — batch-fetches odds for all games (5 concurrent)
- Fixed regex: `[^1]*` couldn't match past `1` in dollar amounts like `$1,000,000`. Changed to `.*?(?:are|:)\s*1\s+in\s+([\d.]+)`
- Result: 85/89 games now have real odds from official TX Lottery detail pages. The 4 missing are old games (1878, 2124, 2424, 2673) not listed on the current games HTML page.

**Fix (frontend — app.js):**
- Added `hasRealOdds` flag to each game in `getEnrichedGameData()`
- Game cards show "N/A" instead of fake "1:4.00" when odds are unavailable
- Adjusted Jackpot Odds shows "N/A" when overall odds are missing
- Value rating shows "N/A" instead of a misleading score
- Top 5 lists filter out games without real odds (won't rank games with fake data)
- Dashboard "Best Overall Odds" shows "N/A" if no games have real odds
- Sort by odds/value pushes games without odds to the bottom
- "Best by price point" insights only use games with real odds
- `calculateAdjustedOddsWithValues()` returns `null` instead of `NaN` when odds missing
- `calculateValueScore()` returns `0` when odds missing

**Verified:** `$1,000,000 CROSSWORD` odds = 1:3.41 (matches official), `Loteria Supreme` = 1:3.23 (matches official).

---

### Round 1: Initial Audit

### Issues Found & Fixed

#### 1. CRITICAL: Scraper Parsing Completely Broken
**Problem:** The `scrapeAllGames()` function parsed the wrong columns from the Texas Lottery HTML table. Column 1 (Start Date) was being used as the game name, producing entries like `"06/16/25"` instead of actual game names like `"20X"`. All games had identical default values (`topPrize: 100000`, `overallOdds: 4`, `topPrizesTotal: 20`) because the real data was never extracted.

**Root cause:** The HTML table has 8 columns (Game Number, Start Date, Ticket Price, Close Indicator, Game Name, Prize Amount, Total, Remaining), but the scraper only read the first 3 and assigned them incorrectly.

**Fix:** Added a new `scrapeFromCSV()` function that fetches structured CSV data from `https://www.texaslottery.com/export/sites/lottery/Games/Scratch_Offs/scratchoff.csv`. This is far more reliable than HTML scraping. The CSV is now the primary data source, with the HTML scraper rewritten as a fallback (now correctly parsing all 8 columns including sub-prize rows).

**Result:** 89 games now load with accurate names, prices, and full prize breakdowns (total/claimed/remaining for every prize level).

---

#### 2. CRITICAL: `/api/games/:id` Always Returned "Game not found"
**Problem:** The endpoint called `scrapeGameDetails(gameId)` which tried to fetch a detail page at `details.html_${gameId}.html`. This URL pattern is wrong (the real site uses hash-based URLs like `details.html_252699574.html`), so every request returned a 404.

**Fix:** Changed the endpoint to look up the game from cached data (already fetched by `fetchLotteryData()`) instead of trying to scrape individual detail pages.

**Result:** `/api/games/1878` now returns full game data including prize breakdowns.

---

#### 3. CRITICAL: Random Data Generation Masking Real Data
**Problem:** Line 328 in the old server.js: `topPrizesRemaining: game.topPrizesRemaining || Math.floor(Math.random() * 15) + 5`. When scraping failed to get remaining prize counts, random numbers were used as placeholders. This made the app display fabricated data to users.

**Fix:** Removed all random data generation. Missing values default to `0` or `null` instead of fake numbers. The CSV data source provides accurate remaining counts for all games, making this unnecessary.

---

#### 4. Frontend `getEnrichedGameData()` Silently Dropped Valid Games
**Problem:** The function required every game to exist in the hardcoded `TEXAS_SCRATCH_OFFS` array in `data.js`. Games that existed in the live API but not in the static list (5+ games) were filtered out and invisible to users.

**Fix:** Rewrote `getEnrichedGameData()` to accept games from any source. API data is preferred, static data is used as supplementary info (for `overallOdds` and `type`). Games are only filtered out if they lack essential data (no top prize or no total count).

---

#### 5. Frontend Fallback Values Masking Zero/Null Data
**Problem:** In `fetchFromAPI()`, the mapping used `||` operators that treated valid `0` and `null` values as missing:
- `topPrize: game.topPrize || 100000` — a $500 top prize would show correctly, but `0` would become `$100,000`
- `topPrizesRemaining: game.topPrizesRemaining || 10` — games with 0 remaining would show as 10
- `overallOdds: game.overallOdds || 4.0` — masked when odds were genuinely unavailable

**Fix:** Changed to explicit `!= null` checks. Zero is now treated as a valid value. The `prizes` array from the API is also passed through to the frontend.

---

#### 6. Game Detail Modal Missing Prize Breakdowns for API-Only Games
**Problem:** The modal only showed prize breakdowns from the hardcoded `PRIZE_BREAKDOWNS` object in `data.js`. Games loaded from the API had full prize data but it wasn't displayed.

**Fix:** Added fallback logic: if `PRIZE_BREAKDOWNS[gameId]` doesn't exist but `game.prizes` has data (from the CSV), it generates the breakdown table from the API data.

---

#### 7. BUG: Undefined `selectFields` Variable in Retailer Geocode Fallback
**Problem:** In the `/api/retailers` endpoint, the lat/lng geocode fallback path (line ~703) referenced `selectFields` which was never defined in that scope, causing a `ReferenceError` when triggered.

**Fix:** Simplified the query to remove the `$select` and `$group` parameters that required `selectFields`.

---

#### 8. npm Security Vulnerabilities
**Problem:** `npm audit` reported 3 vulnerabilities in axios, qs, and undici packages.

**Fix:** Ran `npm audit fix` which updated 3 packages. Now at 0 vulnerabilities.

---

### Test Results

| Test | Status | Details |
|------|--------|---------|
| `npm install` | PASS | All dependencies install cleanly |
| `npm audit` | PASS | 0 vulnerabilities (was 3) |
| Server startup | PASS | Starts on port 3000, fetches 89 games + odds |
| `GET /api/status` | PASS | Returns `{"success":true,"status":"running","cached":true}` |
| `GET /api/games` | PASS | Returns 89 games with real names, prices, prize breakdowns, and odds |
| `GET /api/games/1878` | PASS | Returns full game data for "Cash On The Spot" |
| `GET /api/games/99999` | PASS | Returns 404 `{"success":false,"error":"Game not found"}` |
| `GET /api/refresh` | PASS | Re-scrapes CSV + odds and returns fresh data |
| `GET /api/retailers?zip=75001` | PASS | Returns retailers from Texas Open Data |
| Static file serving | PASS | All static files return HTTP 200 |
| Overall odds accuracy | PASS | 85/89 games have real odds; verified 2658=3.41, 2587=3.23 match official |
| Games without odds | PASS | 4 old games show "N/A" instead of fake values |
| Adjusted odds calculation | PASS | Returns null for games without odds, correct values otherwise |
| Value score calculations | PASS | Only uses games with real odds; no NaN/Infinity errors |
| Sort by odds | PASS | Games without odds sorted to bottom |
| Top 5 lists | PASS | Only include games with real odds data |
| Games with 0 remaining prizes | PASS | 4 games correctly show "---" for adjusted odds |

### Data Quality Verification

- **89 total games** loaded from Texas Lottery CSV
- **89/89** have prize breakdowns with total/claimed/remaining
- **89/89** have valid top prize amounts
- **85/89** have real overall odds scraped from official detail pages
- **85/89** have top prizes still remaining (4 games fully claimed)
- **4/89** old games without odds display "N/A" (not fake data)
- **Odds range:** 1:3.21 (Loteria Supreme) to 1:9.49

---

### Files Modified

| File | Changes |
|------|---------|
| `server.js` | Added CSV scraper as primary data source; rewrote HTML scraper as fallback with correct column mapping; fixed `/api/games/:id` to use cached data; removed random data generation; fixed undefined `selectFields` bug |
| `app.js` | Fixed `getEnrichedGameData()` to accept API-only games; fixed `||` fallback values to handle 0/null correctly; added `prizes` pass-through; added API prize data fallback in game detail modal |
| `package-lock.json` | Updated axios, qs, undici to fix security vulnerabilities |
| `CLAUDE.md` | Created project documentation for Claude Code |
| `progress.md` | This file |
