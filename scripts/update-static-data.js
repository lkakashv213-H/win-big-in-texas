/**
 * Regenerates the TEXAS_SCRATCH_OFFS array in data.js from live Texas Lottery
 * data, so the offline/static fallback never drifts months out of date again
 * (a stale fallback is how the long-closed "$3 Million Ca$h" kept showing up
 * as a top pick).
 *
 * Usage:  node scripts/update-static-data.js
 *
 * Sources:
 *   - scratchoff.csv  — prize levels / remaining counts
 *   - all.html        — current-games list (what is actually on sale) + detail URLs
 *   - closing.html    — call dates / end-of-game dates
 *   - detail pages    — overall odds (fetched in batches of 5)
 *
 * Rewrites the block between the `const TEXAS_SCRATCH_OFFS = [` line and its
 * closing `];` in data.js, dist/data.js and android-app/www/data.js, leaving
 * PRIZE_BREAKDOWNS and everything else untouched.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BASE = 'https://www.texaslottery.com';
const URLS = {
    csv: `${BASE}/export/sites/lottery/Games/Scratch_Offs/scratchoff.csv`,
    all: `${BASE}/export/sites/lottery/Games/Scratch_Offs/all.html`,
    closing: `${BASE}/export/sites/lottery/Games/Scratch_Offs/closing.html`
};

const TARGETS = [
    path.join(__dirname, '..', 'data.js'),
    path.join(__dirname, '..', 'dist', 'data.js'),
    path.join(__dirname, '..', 'android-app', 'www', 'data.js')
];

function get(url) {
    return axios.get(url, { headers: { 'User-Agent': UA }, timeout: 30000, responseType: 'text', transformResponse: [(d) => d] });
}

function parseCSVLine(line) {
    const fields = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ;
        } else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = ''; }
        else cur += ch;
    }
    fields.push(cur.trim());
    return fields;
}

function parseLotteryDate(str) {
    if (!str) return null;
    const m = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (!m) return null;
    let year = parseInt(m[3]);
    if (year < 100) year += 2000;
    const d = new Date(year, parseInt(m[1]) - 1, parseInt(m[2]));
    return isNaN(d.getTime()) ? null : d;
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

async function fetchCSVGames() {
    const res = await get(URLS.csv);
    const lines = res.data.split('\n').filter((l) => l.trim()).slice(2);
    const map = new Map();
    for (const line of lines) {
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
        if (!isNaN(amount) && amount > 0) map.get(id).prizes.push({ amount, total, remaining: total - claimed });
    }
    for (const g of map.values()) g.prizes.sort((a, b) => b.amount - a.amount);
    return map;
}

async function fetchCurrentGames() {
    const res = await get(URLS.all);
    const $ = cheerio.load(res.data);
    const map = new Map();
    $('a[title*="View details for Game Number"]').each((i, el) => {
        const idMatch = $(el).text().trim().match(/^(\d+)$/);
        const href = $(el).attr('href');
        if (!idMatch || !href) return;
        const startText = $(el).closest('td').next('td').text().trim();
        map.set(parseInt(idMatch[1]), { detailUrl: BASE + href, startDate: parseLotteryDate(startText) });
    });
    return map;
}

async function fetchClosingMap() {
    const res = await get(URLS.closing);
    const $ = cheerio.load(res.data);
    const map = new Map();
    $('table tr').each((i, row) => {
        const cells = $(row).find('td').map((j, td) => $(td).text().trim()).get();
        if (cells.length < 3) return;
        const idCell = cells.find((c) => /^\d{3,5}$/.test(c));
        const dates = cells.filter((c) => /^\d{2}\/\d{2}\/\d{4}$/.test(c));
        if (!idCell || dates.length < 2) return;
        map.set(parseInt(idCell), { callDate: parseLotteryDate(dates[0]), endDate: parseLotteryDate(dates[1]), endDateText: dates[1] });
    });
    return map;
}

async function fetchOdds(detailUrl) {
    try {
        const res = await get(detailUrl);
        const m = res.data.match(/[Oo]verall odds.*?(?:are|:)\s*1\s+in\s+([\d.]+)/);
        return m ? parseFloat(m[1]) : null;
    } catch {
        return null;
    }
}

function fmtEntry(g) {
    const extras = g.salesStatus !== 'active'
        ? `, salesStatus: "${g.salesStatus}"${g.endDateIso ? `, endDate: "${g.endDateIso}"` : ''}`
        : '';
    return `    { id: ${g.id}, name: ${JSON.stringify(g.name)}, price: ${g.price}, topPrize: ${g.topPrize}, overallOdds: ${g.overallOdds != null ? g.overallOdds : null}, topPrizesTotal: ${g.topPrizesTotal}, topPrizesRemaining: ${g.topPrizesRemaining}, type: "${g.type}"${extras} },`;
}

async function main() {
    const now = new Date();
    console.log('Fetching CSV, current-games list and closing list...');
    const [csvMap, currentMap, closingMap] = await Promise.all([fetchCSVGames(), fetchCurrentGames(), fetchClosingMap()]);
    console.log(`CSV: ${csvMap.size} games, current list: ${currentMap.size}, closing: ${closingMap.size}`);

    // On-sale set: in CSV AND on the current list AND already started AND not past end date.
    const games = [];
    for (const [id, g] of csvMap) {
        const current = currentMap.get(id);
        if (!current) continue; // dropped off the list — no longer sold
        if (current.startDate && current.startDate > now) continue; // upcoming
        const closing = closingMap.get(id);
        const endDate = (closing && closing.endDate) || parseLotteryDate(g.closeDate);
        if (endDate && endDate <= now) continue; // officially over
        let salesStatus = 'active';
        if (closing && closing.callDate) salesStatus = closing.callDate <= now ? 'pulled' : 'closing';
        else if (endDate) salesStatus = 'closing';
        const top = g.prizes[0];
        games.push({
            id,
            name: g.name,
            price: g.price,
            topPrize: top ? top.amount : 0,
            topPrizesTotal: top ? top.total : 0,
            topPrizesRemaining: top ? top.remaining : 0,
            type: categorize(g.name),
            salesStatus,
            endDateIso: endDate ? endDate.toISOString() : null,
            detailUrl: current.detailUrl,
            overallOdds: null
        });
    }
    console.log(`${games.length} games on sale — fetching overall odds (batches of 5)...`);

    for (let i = 0; i < games.length; i += 5) {
        const batch = games.slice(i, i + 5);
        await Promise.all(batch.map(async (g) => { g.overallOdds = await fetchOdds(g.detailUrl); }));
        process.stdout.write(`  odds ${Math.min(i + 5, games.length)}/${games.length}\r`);
    }
    const withOdds = games.filter((g) => g.overallOdds != null).length;
    console.log(`\nOdds found for ${withOdds}/${games.length} games`);

    // Build the array block, grouped by price like the hand-written original.
    games.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
    const lines = [];
    let lastPrice = null;
    for (const g of games) {
        if (g.price !== lastPrice) {
            if (lastPrice !== null) lines.push('');
            lines.push(`    // $${g.price} Games`);
            lastPrice = g.price;
        }
        lines.push(fmtEntry(g));
    }
    // Trailing comma on the last entry is invalid inside `];` — strip it.
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].endsWith(',')) { lines[i] = lines[i].slice(0, -1); break; }
    }
    const block = `const TEXAS_SCRATCH_OFFS = [\n${lines.join('\n')}\n];`;
    const stamp = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    for (const file of TARGETS) {
        let src = fs.readFileSync(file, 'utf8');
        src = src.replace(/const TEXAS_SCRATCH_OFFS = \[[\s\S]*?\n\];/, block);
        src = src.replace(/\/\/ Last Updated:.*$/m, `// Last Updated: ${stamp} (generated by scripts/update-static-data.js)`);
        fs.writeFileSync(file, src, 'utf8');
        console.log(`Updated ${path.relative(process.cwd(), file)}`);
    }
    console.log('Done.');
}

main().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
