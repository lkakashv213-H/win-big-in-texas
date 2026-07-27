/**
 * LotChance — Capacitor-aware Texas Lottery scraper.
 *
 * Runs inside the Android WebView. Uses CapacitorHttp (native HTTP, no CORS)
 * to hit texaslottery.com and nominatim.openstreetmap.org directly. Falls
 * back to plain fetch() when running in a regular browser, which is useful
 * for testing the same www/ folder in a desktop dev environment.
 *
 * Exposes a single global: window.LotteryScraper
 */
(function () {
    const URLS = {
        csv:        'https://www.texaslottery.com/export/sites/lottery/Games/Scratch_Offs/scratchoff.csv',
        all:        'https://www.texaslottery.com/export/sites/lottery/Games/Scratch_Offs/all.html',
        closing:    'https://www.texaslottery.com/export/sites/lottery/Games/Scratch_Offs/closing.html',
        details:    (slug) => `https://www.texaslottery.com/export/sites/lottery/Games/Scratch_Offs/${slug}`,
        retailers:  'https://www.texaslottery.com/opencms/Games/Scratch_Offs/Retailer_Locator.jsp',
        nominatim:  'https://nominatim.openstreetmap.org'
    };

    const cap = window.Capacitor;
    const http = cap?.isNativePlatform?.() && cap.Plugins?.CapacitorHttp ? cap.Plugins.CapacitorHttp : null;
    if (http) console.log('[Scraper] Using CapacitorHttp (native, no CORS)');
    else console.log('[Scraper] Using browser fetch()');

    // Tiny adapter: returns response text. Native path bypasses CORS.
    async function getText(url, params = null) {
        const finalUrl = params ? `${url}?${new URLSearchParams(params).toString()}` : url;
        if (http) {
            const res = await http.request({
                url: finalUrl,
                method: 'GET',
                responseType: 'text',
                headers: { 'Accept': 'text/html, text/plain, */*' }
            });
            if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
            return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        }
        const res = await fetch(finalUrl, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    }

    async function getJson(url, params = null) {
        const finalUrl = params ? `${url}?${new URLSearchParams(params).toString()}` : url;
        if (http) {
            const res = await http.request({
                url: finalUrl,
                method: 'GET',
                responseType: 'json',
                headers: { 'Accept': 'application/json', 'User-Agent': 'LotChance-Android/1.0' }
            });
            if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
            return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        }
        const res = await fetch(finalUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    }

    // ---------- CSV parsing ----------

    function parseCSVLine(line) {
        const fields = [];
        let cur = '';
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
                else inQ = !inQ;
            } else if (ch === ',' && !inQ) {
                fields.push(cur.trim()); cur = '';
            } else {
                cur += ch;
            }
        }
        fields.push(cur.trim());
        return fields;
    }

    function categorize(name) {
        const n = (name || '').toLowerCase();
        if (n.includes('loteria')) return 'loteria';
        if (n.includes('bingo')) return 'bingo';
        if (n.includes('crossword') || n.includes('word')) return 'crossword';
        if (n.includes('multiplier') || /\d+x/i.test(name)) return 'multiplier';
        if (n.includes('cowboy') || n.includes('texan') || n.includes('jurassic') || n.includes('casino')) return 'themed';
        return 'standard';
    }

    async function fetchCSV() {
        const text = await getText(URLS.csv);
        const lines = text.split('\n').filter((l) => l.trim());
        const data = lines.slice(2);
        const map = new Map();

        for (const line of data) {
            const f = parseCSVLine(line);
            if (f.length < 7) continue;
            const id = parseInt(f[0]);
            const name = f[1];
            const closeDate = f[2] || null;
            const price = parseInt(f[3]);
            const level = f[4];
            const total = parseInt(f[5]) || 0;
            const claimed = parseInt(f[6]) || 0;
            if (!id || !name || level === 'TOTAL') continue;

            if (!map.has(id)) map.set(id, { id, name, price, closeDate, prizes: [] });
            const amount = parseInt(String(level).replace(/[,$]/g, ''));
            if (!isNaN(amount) && amount > 0) {
                map.get(id).prizes.push({ amount, total, claimed, remaining: total - claimed });
            }
        }

        const games = [];
        for (const g of map.values()) {
            g.prizes.sort((a, b) => b.amount - a.amount);
            const top = g.prizes[0];
            games.push({
                id: g.id,
                name: g.name,
                price: g.price,
                closeDate: g.closeDate,
                topPrize: top ? top.amount : 0,
                topPrizesTotal: top ? top.total : 0,
                topPrizesRemaining: top ? top.remaining : 0,
                prizes: g.prizes,
                type: categorize(g.name),
                lastUpdated: new Date().toISOString()
            });
        }
        return games;
    }

    // Parse a Texas Lottery date string ("MM/DD/YYYY" or "MM/DD/YY") to a Date.
    function parseLotteryDate(str) {
        if (!str) return null;
        const m = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
        if (!m) return null;
        let year = parseInt(m[3]);
        if (year < 100) year += 2000;
        const d = new Date(year, parseInt(m[1]) - 1, parseInt(m[2]));
        return isNaN(d.getTime()) ? null : d;
    }

    // Compute whether a game can actually be bought in stores right now.
    //
    // The CSV alone is NOT a list of games on sale: closed games keep prize
    // rows during the 180-day claim window, and games quietly drop off the
    // current-games list (all.html) when they stop being sold. Once a game is
    // "called" (closing.html), packs are picked up from retailers starting on
    // the Call Date — ~6 weeks before the official End of Game Date — so
    // availability collapses well before the close date.
    //
    //   'ended'    — past end-of-game date, or missing from the current list
    //   'upcoming' — listed but its start date is in the future
    //   'pulled'   — called; packs are being removed from stores right now
    //   'closing'  — close announced but packs not yet being pulled
    //   'active'   — fully on sale
    function computeSalesStatus(gameId, csvCloseDate, currentGames, closingMap, now) {
        const closing = closingMap ? closingMap.get(gameId) : null;
        const endDate = (closing && closing.endDate) || parseLotteryDate(csvCloseDate);
        const callDate = closing ? closing.callDate : null;

        if (endDate && endDate <= now) return { status: 'ended', callDate, endDate };

        if (currentGames && currentGames.size > 0) {
            const current = currentGames.get(gameId);
            if (!current) return { status: 'ended', callDate, endDate };
            if (current.startDate && current.startDate > now) return { status: 'upcoming', callDate, endDate };
        }

        if (callDate) {
            return { status: callDate <= now ? 'pulled' : 'closing', callDate, endDate };
        }
        if (endDate) {
            // Close date known but the closing list wasn't available. Packs
            // are typically called ~45 days before end of game.
            const approxCall = new Date(endDate.getTime() - 45 * 24 * 3600 * 1000);
            return { status: approxCall <= now ? 'pulled' : 'closing', callDate: null, endDate };
        }
        return { status: 'active', callDate: null, endDate: null };
    }

    // Current-games list (all.html) → Map of gameId -> { startDate }.
    // Games missing from this list are no longer sold; future start dates are
    // upcoming launches.
    async function fetchCurrentGames() {
        const html = await getText(URLS.all);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const map = new Map();
        doc.querySelectorAll('a[title*="View details for Game Number"]').forEach((a) => {
            const idMatch = a.textContent.trim().match(/^(\d+)$/);
            if (!idMatch) return;
            const td = a.closest('td');
            const startText = td && td.nextElementSibling ? td.nextElementSibling.textContent.trim() : '';
            // Keep the detail-page slug: it is the only way to look up a game's
            // overall odds, and it lets a brand-new game get real odds instead
            // of waiting for someone to regenerate data.js.
            const href = a.getAttribute('href') || '';
            const slug = (href.match(/([^/]+\.html)$/) || [])[1] || null;
            map.set(parseInt(idMatch[1]), { startDate: parseLotteryDate(startText), slug });
        });
        return map;
    }

    // "Games Ending Soon" (closing.html) → Map of gameId -> { callDate, endDate }.
    // Rows: Game Name | Game Number | Game Call Date | End of Game Date [| Last Day to Redeem]
    async function fetchClosingInfo() {
        const html = await getText(URLS.closing);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const map = new Map();
        doc.querySelectorAll('table tr').forEach((row) => {
            const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent.trim());
            if (cells.length < 3) return;
            const idCell = cells.find((c) => /^\d{3,5}$/.test(c));
            const dates = cells.filter((c) => /^\d{2}\/\d{2}\/\d{4}$/.test(c));
            if (!idCell || dates.length < 2) return;
            map.set(parseInt(idCell), {
                callDate: parseLotteryDate(dates[0]),
                endDate: parseLotteryDate(dates[1])
            });
        });
        return map;
    }

    async function fetchGames() {
        // The CSV is required; the availability lists fail open (a transient
        // fetch error must not blank the app, it just skips that check).
        const [csvRes, currentRes, closingRes] = await Promise.allSettled([
            fetchCSV(),
            fetchCurrentGames(),
            fetchClosingInfo()
        ]);
        if (csvRes.status === 'rejected') throw csvRes.reason;

        const currentGames = currentRes.status === 'fulfilled' ? currentRes.value : null;
        const closingMap = closingRes.status === 'fulfilled' ? closingRes.value : new Map();
        if (currentRes.status === 'rejected') console.warn('[Scraper] current-games list failed:', currentRes.reason?.message);
        if (closingRes.status === 'rejected') console.warn('[Scraper] closing list failed:', closingRes.reason?.message);

        const now = new Date();
        const all = csvRes.value.map((g) => {
            const sales = computeSalesStatus(g.id, g.closeDate, currentGames, closingMap, now);
            const current = currentGames ? currentGames.get(g.id) : null;
            return {
                ...g,
                salesStatus: sales.status,
                callDate: sales.callDate ? sales.callDate.toISOString() : null,
                endDate: sales.endDate ? sales.endDate.toISOString() : null,
                detailSlug: current && current.slug ? current.slug : null
            };
        });

        // Games that can no longer be bought anywhere (or aren't on sale yet)
        // must never reach the app.
        const games = all.filter((g) => g.salesStatus !== 'ended' && g.salesStatus !== 'upcoming');
        console.log(`[Scraper] ${csvRes.value.length} games in CSV → ${games.length} on sale (${all.length - games.length} closed/upcoming filtered)`);

        // Overall odds live on each game's detail page. We still don't scrape
        // all ~75 of them on a phone (slow on cellular, and it rate-limits) —
        // fetchOverallOdds() below pulls them only for games we have no odds
        // for, which in practice means newly launched ones.
return {
            games,
            fetchedAt: new Date().toISOString(),
            source: 'Texas Lottery CSV (Android native HTTP)'
        };
    }

    // ---------- Retailer locator ----------

    // The locator matches the city EXACTLY against its uppercase city list.
    // Any state suffix ("Houston, TX", "Houston Texas") returns 0 rows, so
    // strip it. Guarded so "TEXAS CITY" (a real city) survives untouched.
    function normalizeCity(city) {
        const up = (city || '').toUpperCase().trim();
        const stripped = up.replace(/[\s,.]+(TX|TEXAS)[\s.]*$/, '').trim();
        return stripped || up;
    }

    // The locator only understands bare 5-digit ZIPs ("78701-1234" -> "78701").
    function normalizeZip(zip) {
        const m = String(zip || '').match(/\d{5}/);
        return m ? m[0] : '';
    }

    // Parsed locator results, keyed by query. A "near me" search now sweeps a
    // ring of neighbouring ZIPs (~16 requests), and panning the map re-runs it,
    // so without this the site rate-limits us into 403s. Retailer stock lists
    // change on the order of days, not minutes.
    const retailerCache = new Map();
    const RETAILER_TTL_MS = 10 * 60 * 1000;

    async function fetchRetailers({ zip = '', city = '', gameNumber = '', limit = 50 } = {}) {
        if (!zip && !city) throw new Error('Provide zip or city');

        const params = {
            submitted: 'true',
            // The locator matches city case-sensitively and stores them uppercase —
            // "Austin" returns 0 rows, "AUSTIN" returns them all.
            city: normalizeCity(city),
            zip: normalizeZip(zip),
            gameNumber: gameNumber ? String(gameNumber) : '',
            smoking: '',
            Submit: 'Search >>'
        };
        console.log(`[Scraper] retailers: zip="${zip}" city="${city}" game="${gameNumber}"`);
        const query = JSON.stringify(params);

        const hit = retailerCache.get(query);
        if (hit && (Date.now() - hit.at) < RETAILER_TTL_MS) {
            return hit.data.slice(0, limit);
        }

        const html = await getText(URLS.retailers, params);

        const doc = new DOMParser().parseFromString(html, 'text/html');
        const rows = doc.querySelectorAll('tbody tr');
        const out = [];
        rows.forEach((row) => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 4) return;
            const name = cells[0].textContent.trim();
            const address = cells[1].textContent.trim();
            const cityName = cells[2].textContent.trim();
            const phone = cells[3].textContent.trim();
            const smoking = cells.length > 4 ? cells[4].textContent.trim() : '';
            const selfCheck = cells.length > 5 ? cells[5].textContent.trim() : '';
            const mapHref = cells[cells.length - 1].querySelector('a')?.getAttribute('href') || '';
            const zipMatch = mapHref.match(/,\s*(\d{5})/);
            if (name && address) {
                out.push({
                    name,
                    address,
                    city: cityName,
                    state: 'TX',
                    zip: zipMatch ? zipMatch[1] : zip,
                    phone,
                    smoking,
                    selfCheck: selfCheck || null,
                    lat: null,
                    lng: null
                });
            }
        });

        const seen = new Set();
        const unique = [];
        for (const r of out) {
            const k = `${r.name}-${r.address}`.toLowerCase();
            if (!seen.has(k)) { seen.add(k); unique.push(r); }
        }
        console.log(`[Scraper] parsed ${unique.length} retailers`);
        // Cache the full parsed set, not the sliced view — the same query is
        // reused with different limits.
        retailerCache.set(query, { at: Date.now(), data: unique });
        return unique.slice(0, limit);
    }

    // ---------- Geocoding (used by app.js too) ----------

    async function geocode(query) {
        const data = await getJson(`${URLS.nominatim}/search`, { format: 'json', q: query, limit: 1 });
        if (!data || data.length === 0) return null;
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), displayName: data[0].display_name };
    }

    async function reverseGeocode(lat, lng) {
        const data = await getJson(`${URLS.nominatim}/reverse`, { format: 'json', lat, lon: lng });
        return {
            zip: data?.address?.postcode || '',
            city: data?.address?.city || data?.address?.town || data?.address?.village || ''
        };
    }

    // ---------- Overall odds ----------

    // Odds never change for a given game, so once we've read one it is cached
    // permanently. This is what stops a newly launched game from showing no
    // odds until data.js is regenerated by hand.
    const ODDS_CACHE_KEY = 'lotchance.overallOdds';
    let oddsCache = null;

    function loadOddsCache() {
        if (oddsCache) return oddsCache;
        try { oddsCache = JSON.parse(localStorage.getItem(ODDS_CACHE_KEY)) || {}; }
        catch { oddsCache = {}; }
        return oddsCache;
    }

    function saveOddsCache() {
        try { localStorage.setItem(ODDS_CACHE_KEY, JSON.stringify(oddsCache || {})); }
        catch { /* storage unavailable — we just refetch next session */ }
    }

    /**
     * Overall odds ("1 in N") for one game, from its detail page.
     * Returns null if the slug is unknown or the page doesn't state them.
     */
    async function fetchOverallOdds(gameId, slug) {
        if (!slug) return null;
        const cache = loadOddsCache();
        if (cache[gameId] != null) return cache[gameId];

        const text = (await getText(URLS.details(slug), null)).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

        // Reads "Overall odds of winning any prize in <NAME> are 1 in 3.99".
        // The game name sits in between and contains digits and punctuation,
        // so the gap has to be permissive but bounded.
        const m = text.match(/overall odds[\s\S]{0,200}?\b1\s*(?:in|:)\s*(\d+(?:\.\d+)?)/i);
        const odds = m ? parseFloat(m[1]) : null;
        if (odds) { cache[gameId] = odds; saveOddsCache(); }
        return odds;
    }

    // ---------- City list ----------

    // The locator page carries its own <select name="city"> of every city it
    // will match. Reading it beats shipping a hand-maintained list: the app
    // never goes stale when the lottery adds or renames a city, and the values
    // are exactly the strings the locator expects.
    const CITY_CACHE_KEY = 'lotchance.cityList';
    const CITY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

    async function fetchCityList() {
        try {
            const raw = localStorage.getItem(CITY_CACHE_KEY);
            if (raw) {
                const c = JSON.parse(raw);
                if (c && Array.isArray(c.cities) && c.cities.length && (Date.now() - c.at) < CITY_TTL_MS) {
                    return c.cities;
                }
            }
        } catch { /* unreadable cache — refetch */ }

        const html = await getText(URLS.retailers, { submitted: '', city: '', zip: '', gameNumber: '', smoking: '' });
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const cities = [];
        doc.querySelectorAll('select[name="city"] option').forEach((o) => {
            const v = (o.getAttribute('value') || '').trim();
            if (v) cities.push(v);
        });
        if (!cities.length) throw new Error('city list empty — locator markup changed?');

        try {
            localStorage.setItem(CITY_CACHE_KEY, JSON.stringify({ at: Date.now(), cities }));
        } catch { /* storage full or blocked — fine, just refetch next time */ }
        console.log(`[Scraper] city list: ${cities.length} cities`);
        return cities;
    }

    window.LotteryScraper = {
        fetchGames,
        fetchRetailers,
        fetchCityList,
        fetchOverallOdds,
        geocode,
        reverseGeocode,
        isNative: !!http
    };
})();
