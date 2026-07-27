#!/usr/bin/env node
/**
 * Builds the static data bundle the app downloads instead of scraping.
 *
 * Runs in CI (see .github/workflows/update-data.yml) twice a day. Everything it
 * writes goes to ./public-data and is committed, so the app fetches plain JSON
 * from GitHub and no user ever hits texaslottery.com or data.texas.gov.
 *
 * Sources
 *   scratchoff.csv      remaining prize counts   (no API exists for this)
 *   all.html            current games + detail-page slugs
 *   closing.html        call / end-of-game dates
 *   details.html_*      overall odds (cached forever — odds never change)
 *   data.texas.gov      retailer directory + which retailers sell which game
 *   Census geocoder     lat/lng for retailer addresses (free, no key)
 *
 * Output (./public-data)
 *   manifest.json          versions + hashes; the only file the app always fetches
 *   games.json             every on-sale game with prizes remaining and odds
 *   retailers/<zip3>.json  retailer directory sharded by 3-digit ZIP
 *   carriers/<gameId>.json retailer numbers known to sell that game
 *   .cache/odds.json       persistent odds cache (committed)
 *   .cache/geocode.json    persistent lat/lng cache (committed)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUT = path.join(__dirname, '..', 'public-data');
const CACHE = path.join(OUT, '.cache');

const TL = 'https://www.texaslottery.com/export/sites/lottery/Games/Scratch_Offs';
const SODA = 'https://data.texas.gov/resource/beka-uwfq.json';
const CENSUS = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch';

// Only retailers with sales this recent are considered to still carry a game.
const SALES_WINDOW_MONTHS = 3;
// Census accepts 10k addresses per batch; stay under it.
const GEOCODE_BATCH = 5000;
// Cap geocoding per run so a cold start spreads over a few runs instead of
// timing out the job.
const GEOCODE_PER_RUN = 20000;

const APP_TOKEN = process.env.SOCRATA_APP_TOKEN || '';
const UA = 'LotChance-data-builder/1.0 (+https://github.com/)';

const log = (...a) => console.log('[build]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every request is bounded. Without a timeout a single stalled connection
// hangs the whole CI job until the runner kills it, with no output.
const HTTP_TIMEOUT_MS = 90000;
// Socrata aggregates over 51M rows; the retailer roll-up alone takes ~40s and
// is slower under load, so it gets a much longer leash than the flat files.
const SODA_TIMEOUT_MS = 300000;

async function get(url, { json = false, tries = 3, timeout = HTTP_TIMEOUT_MS } = {}) {
    for (let i = 1; i <= tries; i++) {
        try {
            const headers = { 'User-Agent': UA };
            if (APP_TOKEN && url.startsWith('https://data.texas.gov')) headers['X-App-Token'] = APP_TOKEN;
            const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return json ? res.json() : res.text();
        } catch (e) {
            if (i === tries) throw new Error(`${url} failed after ${tries}: ${e.message}`);
            log(`  retry ${i}/${tries} ${url.slice(0, 80)} — ${e.message}`);
            await sleep(1500 * i);
        }
    }
}

const soda = (params) => {
    const q = new URLSearchParams(params).toString();
    return get(`${SODA}?${q}`, { json: true, timeout: SODA_TIMEOUT_MS });
};

function readCache(name, fallback) {
    try { return JSON.parse(fs.readFileSync(path.join(CACHE, name), 'utf8')); }
    catch { return fallback; }
}
function writeJson(rel, obj) {
    const p = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const text = JSON.stringify(obj);
    fs.writeFileSync(p, text);
    return { bytes: Buffer.byteLength(text), hash: crypto.createHash('sha1').update(text).digest('hex').slice(0, 12) };
}

// ---------------------------------------------------------------- games

function parseLotteryDate(s) {
    const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (!m) return null;
    let y = +m[3]; if (y < 100) y += 2000;
    const d = new Date(Date.UTC(y, +m[1] - 1, +m[2]));
    return isNaN(d) ? null : d;
}

function parseCsv(text) {
    // The feed is one row per prize tier: game, name, price, close date, prize
    // amount, total, claimed.
    const rows = text.split(/\r?\n/).slice(1).filter(Boolean);
    const games = new Map();
    for (const line of rows) {
        const f = line.split(',').map((x) => x.replace(/^"|"$/g, '').trim());
        const id = parseInt(f[0]);
        if (!id || !f[1]) continue;
        if (!games.has(id)) {
            games.set(id, {
                id, name: f[1], price: parseFloat(f[2]) || 0,
                closeDate: f[3] || null, prizes: []
            });
        }
        const amount = parseFloat(String(f[4]).replace(/[$,]/g, ''));
        const total = parseInt(String(f[5]).replace(/,/g, ''));
        const claimed = parseInt(String(f[6]).replace(/,/g, ''));
        if (!isNaN(amount) && !isNaN(total)) {
            games.get(id).prizes.push({ amount, total, claimed: claimed || 0, remaining: total - (claimed || 0) });
        }
    }
    return [...games.values()];
}

function stripTags(html) {
    return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ');
}

async function buildGames() {
    log('fetching CSV + all.html + closing.html');
    const [csv, allHtml, closingHtml] = await Promise.all([
        get(`${TL}/scratchoff.csv`), get(`${TL}/all.html`), get(`${TL}/closing.html`)
    ]);

    const games = parseCsv(csv);

    // all.html: which games are actually on the current list, plus detail slugs
    const current = new Map();
    const linkRe = /<a[^>]*title="[^"]*View details for Game Number[^"]*"[^>]*href="([^"]+)"[^>]*>\s*(\d+)\s*<\/a>/gi;
    for (const m of allHtml.matchAll(linkRe)) {
        const slug = (m[1].match(/([^/]+\.html)$/) || [])[1] || null;
        current.set(parseInt(m[2]), { slug });
    }
    // Fallback for the reversed attribute order some pages use.
    if (!current.size) {
        const alt = /<a[^>]*href="([^"]+)"[^>]*title="[^"]*View details for Game Number[^"]*"[^>]*>\s*(\d+)\s*<\/a>/gi;
        for (const m of allHtml.matchAll(alt)) {
            const slug = (m[1].match(/([^/]+\.html)$/) || [])[1] || null;
            current.set(parseInt(m[2]), { slug });
        }
    }
    log(`current games list: ${current.size}`);

    // closing.html: call date + end date
    const closing = new Map();
    for (const row of closingHtml.split(/<tr[^>]*>/i).slice(1)) {
        const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripTags(c[1]).trim());
        if (cells.length < 3) continue;
        const id = cells.find((c) => /^\d{3,5}$/.test(c));
        const dates = cells.filter((c) => /^\d{2}\/\d{2}\/\d{4}$/.test(c));
        if (id && dates.length >= 2) {
            closing.set(parseInt(id), { callDate: parseLotteryDate(dates[0]), endDate: parseLotteryDate(dates[1]) });
        }
    }
    log(`closing list: ${closing.size}`);

    const now = new Date();
    const onSale = [];
    for (const g of games) {
        const c = closing.get(g.id);
        const endDate = (c && c.endDate) || parseLotteryDate(g.closeDate);
        const callDate = c ? c.callDate : null;
        if (endDate && endDate <= now) continue;         // finished
        if (!current.has(g.id)) continue;                 // dropped off the current list
        let status = 'active';
        if (callDate) status = callDate <= now ? 'pulled' : 'closing';
        onSale.push({
            ...g,
            salesStatus: status,
            callDate: callDate ? callDate.toISOString() : null,
            endDate: endDate ? endDate.toISOString() : null,
            detailSlug: current.get(g.id).slug
        });
    }
    log(`on sale: ${onSale.length} of ${games.length} in CSV`);

    // Overall odds, cached permanently — they never change for a given game.
    const odds = readCache('odds.json', {});
    let fetched = 0;
    for (const g of onSale) {
        if (odds[g.id] != null || !g.detailSlug) continue;
        try {
            const text = stripTags(await get(`${TL}/${g.detailSlug}`));
            const m = text.match(/overall odds[\s\S]{0,200}?\b1\s*(?:in|:)\s*(\d+(?:\.\d+)?)/i);
            if (m) { odds[g.id] = parseFloat(m[1]); fetched++; }
            await sleep(300);
        } catch (e) { log(`  odds ${g.id}: ${e.message}`); }
    }
    if (fetched) log(`fetched odds for ${fetched} new game(s)`);
    for (const g of onSale) g.overallOdds = odds[g.id] ?? null;

    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(path.join(CACHE, 'odds.json'), JSON.stringify(odds, null, 0));
    return onSale;
}

// ------------------------------------------------------------ retailers

function windowStart() {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - SALES_WINDOW_MONTHS);
    return d.toISOString().slice(0, 10);
}

async function buildRetailers() {
    const since = windowStart();
    log(`retailer directory from data.texas.gov (sales since ${since})`);

    const rows = [];
    const PAGE = 50000;
    for (let offset = 0; ; offset += PAGE) {
        const page = await soda({
            $select: 'retailer_number,location_name,location_address,location_city,location_zip,location_county_desc',
            $where: `game_category='Scratch Tickets' AND month_end_date > '${since}'`,
            $group: 'retailer_number,location_name,location_address,location_city,location_zip,location_county_desc',
            $limit: PAGE, $offset: offset
        });
        rows.push(...page);
        log(`  +${page.length} (total ${rows.length})`);
        if (page.length < PAGE) break;
    }

    // One entry per retailer number; the same store can appear under slightly
    // different spellings across months, so keep the first and move on.
    const byNumber = new Map();
    for (const r of rows) {
        if (!r.retailer_number || byNumber.has(r.retailer_number)) continue;
        byNumber.set(r.retailer_number, {
            r: r.retailer_number,
            n: (r.location_name || '').trim(),
            a: (r.location_address || '').trim(),
            c: (r.location_city || '').trim(),
            z: (r.location_zip || '').trim(),
            k: (r.location_county_desc || '').trim()
        });
    }
    log(`distinct retailers: ${byNumber.size}`);
    return [...byNumber.values()];
}

async function geocode(retailers) {
    const cache = readCache('geocode.json', {});
    const todo = retailers.filter((r) => !cache[r.r] && r.a && r.c && /^\d{5}$/.test(r.z));
    log(`geocode: ${retailers.length - todo.length} cached, ${todo.length} to look up`);

    const batchList = todo.slice(0, GEOCODE_PER_RUN);
    for (let i = 0; i < batchList.length; i += GEOCODE_BATCH) {
        const batch = batchList.slice(i, i + GEOCODE_BATCH);
        const csv = batch.map((r) =>
            `${r.r},"${r.a.replace(/"/g, '')}","${r.c.replace(/"/g, '')}",TX,${r.z}`).join('\n');

        const form = new FormData();
        form.append('addressFile', new Blob([csv], { type: 'text/csv' }), 'addr.csv');
        form.append('benchmark', 'Public_AR_Current');

        try {
            const res = await fetch(CENSUS, {
                method: 'POST', body: form, headers: { 'User-Agent': UA },
                signal: AbortSignal.timeout(300000)   // large batches are legitimately slow
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            let hits = 0;
            for (const line of text.split(/\r?\n/)) {
                if (!line.trim()) continue;
                const cols = line.match(/"([^"]*)"/g);
                if (!cols || cols.length < 6) continue;
                const strip = (s) => s.replace(/^"|"$/g, '');
                if (strip(cols[2]) !== 'Match') continue;
                const [lng, lat] = strip(cols[5]).split(',').map(Number);
                if (isFinite(lat) && isFinite(lng)) { cache[strip(cols[0])] = [+lat.toFixed(5), +lng.toFixed(5)]; hits++; }
            }
            log(`  batch ${i / GEOCODE_BATCH + 1}: ${hits}/${batch.length} matched`);
        } catch (e) {
            log(`  batch failed (${e.message}) — will retry next run`);
        }
        await sleep(1000);
    }

    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(path.join(CACHE, 'geocode.json'), JSON.stringify(cache));

    let placed = 0;
    for (const r of retailers) {
        const c = cache[r.r];
        if (c) { r.lat = c[0]; r.lng = c[1]; placed++; }
    }
    log(`retailers with coordinates: ${placed}/${retailers.length}`);
    return retailers;
}

// ------------------------------------------------------------- carriers

async function buildCarriers(games) {
    const since = windowStart();
    log(`carrier lists for ${games.length} games`);
    const out = new Map();
    for (const g of games) {
        try {
            const rows = await soda({
                $select: 'retailer_number',
                $where: `instant_game_number='${g.id}' AND month_end_date > '${since}'`,
                $group: 'retailer_number', $limit: 50000
            });
            out.set(g.id, rows.map((r) => r.retailer_number).filter(Boolean).sort());
        } catch (e) {
            log(`  game ${g.id}: ${e.message}`);
            out.set(g.id, []);
        }
    }
    return out;
}

// ----------------------------------------------------------------- main

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const startedAt = new Date().toISOString();

    const games = await buildGames();
    const retailers = await geocode(await buildRetailers());
    const carriers = await buildCarriers(games);

    const files = {};
    files['games.json'] = writeJson('games.json', {
        generatedAt: startedAt,
        games: games.map(({ detailSlug, ...g }) => g)
    });

    // Shard the directory by 3-digit ZIP so a phone downloads only its area.
    const shards = new Map();
    for (const r of retailers) {
        const z3 = /^\d{5}$/.test(r.z) ? r.z.slice(0, 3) : '000';
        if (!shards.has(z3)) shards.set(z3, []);
        shards.get(z3).push(r);
    }
    const shardIndex = {};
    for (const [z3, list] of [...shards].sort()) {
        shardIndex[z3] = writeJson(`retailers/${z3}.json`, list);
    }
    log(`retailer shards: ${shards.size}`);

    const carrierIndex = {};
    for (const [gameId, list] of carriers) {
        carrierIndex[gameId] = writeJson(`carriers/${gameId}.json`, list);
    }

    const manifest = {
        version: startedAt,
        generatedAt: startedAt,
        salesWindowMonths: SALES_WINDOW_MONTHS,
        counts: {
            games: games.length,
            retailers: retailers.length,
            retailersGeocoded: retailers.filter((r) => r.lat).length
        },
        files, retailers: shardIndex, carriers: carrierIndex
    };
    writeJson('manifest.json', manifest);

    const total = [files['games.json'], ...Object.values(shardIndex), ...Object.values(carrierIndex)]
        .reduce((a, f) => a + f.bytes, 0);
    log(`done — ${(total / 1048576).toFixed(2)} MB across ${1 + shards.size + carriers.size} files`);
})().catch((e) => { console.error('[build] FAILED:', e); process.exit(1); });
