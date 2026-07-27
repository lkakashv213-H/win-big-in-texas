/**
 * LotChance Backend Server
 * Fetches real-time Texas Lottery scratch-off data
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for frontend
app.use(cors());

// Serve static files
app.use(express.static(path.join(__dirname)));

// Cache for lottery data (refresh every minute minimum)
let cachedData = null;
let lastFetchTime = null;
const CACHE_DURATION = 60000; // 1 minute cache

// Texas Lottery URLs
const LOTTERY_URLS = {
    allGames: 'https://www.texaslottery.com/export/sites/lottery/Games/Scratch_Offs/all.html',
    csv: 'https://www.texaslottery.com/export/sites/lottery/Games/Scratch_Offs/scratchoff.csv',
    closing: 'https://www.texaslottery.com/export/sites/lottery/Games/Scratch_Offs/closing.html',
    gameDetails: (gameId) => `https://www.texaslottery.com/export/sites/lottery/Games/Scratch_Offs/details.html_${gameId}.html`
};

/**
 * Parse a Texas Lottery date string ("MM/DD/YYYY" or "MM/DD/YY") to a Date.
 */
function parseLotteryDate(str) {
    if (!str) return null;
    const m = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (!m) return null;
    let year = parseInt(m[3]);
    if (year < 100) year += 2000;
    const d = new Date(year, parseInt(m[1]) - 1, parseInt(m[2]));
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Compute whether a game can actually be bought in stores right now.
 *
 * The CSV alone is NOT a list of games on sale: closed games keep prize rows
 * during the 180-day claim window, and games quietly drop off the current-games
 * list (all.html) when they stop being sold. On top of that, once the lottery
 * "calls" a game (closing.html), packs start being picked up from retailers on
 * the Call Date — roughly 6 weeks before the official End of Game Date — so
 * availability collapses well before the close date.
 *
 * Statuses:
 *   'ended'    — past end-of-game date, or missing from the current-games list
 *   'upcoming' — on the list but its start date is in the future
 *   'pulled'   — called; packs are being removed from stores right now
 *   'closing'  — close announced but packs not yet being pulled
 *   'active'   — fully on sale
 */
function computeSalesStatus(gameId, csvCloseDate, currentGames, closingMap, now = new Date()) {
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
        // Close date known but call date not published (closing.html fetch
        // failed). Packs are typically called ~45 days before end of game.
        const approxCall = new Date(endDate.getTime() - 45 * 24 * 3600 * 1000);
        return { status: approxCall <= now ? 'pulled' : 'closing', callDate: null, endDate };
    }
    return { status: 'active', callDate: null, endDate: null };
}

/**
 * Scrape the "Games Ending Soon" page → Map of gameId -> { callDate, endDate }.
 * Rows carry: Game Name | Game Number | Game Call Date | End of Game Date [| Last Day to Redeem]
 */
async function scrapeClosingDates() {
    console.log('[Scraper] Fetching closing-games list...');
    const response = await axios.get(LOTTERY_URLS.closing, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: 30000
    });

    const $ = cheerio.load(response.data);
    const map = new Map();
    $('table tr').each((i, row) => {
        const cells = $(row).find('td').map((j, td) => $(td).text().trim()).get();
        if (cells.length < 3) return;
        const idCell = cells.find(c => /^\d{3,5}$/.test(c));
        const dates = cells.filter(c => /^\d{2}\/\d{2}\/\d{4}$/.test(c));
        if (!idCell || dates.length < 2) return;
        map.set(parseInt(idCell), {
            callDate: parseLotteryDate(dates[0]),
            endDate: parseLotteryDate(dates[1]),
            callDateText: dates[0],
            endDateText: dates[1]
        });
    });
    console.log(`[Scraper] Closing list: ${map.size} games`);
    return map;
}

/**
 * Parse CSV text into rows (handles quoted fields with commas)
 */
function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            fields.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    fields.push(current.trim());
    return fields;
}

/**
 * Fetch all scratch-off games from the Texas Lottery CSV
 * CSV columns: Game Number, Game Name, Game Close Date, Ticket Price, Prize Level, Total Prizes in Level, Prizes Claimed
 */
async function scrapeFromCSV() {
    console.log('[Scraper] Fetching CSV from Texas Lottery...');

    const response = await axios.get(LOTTERY_URLS.csv, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: 30000
    });

    const lines = response.data.split('\n').filter(l => l.trim());
    // Skip header line (first line is title, second is column headers)
    const dataLines = lines.slice(2);

    // Group prize rows by game number
    const gameMap = new Map();

    for (const line of dataLines) {
        const fields = parseCSVLine(line);
        if (fields.length < 7) continue;

        const gameNumber = parseInt(fields[0]);
        const gameName = fields[1];
        const closeDate = fields[2] || null;
        const ticketPrice = parseInt(fields[3]);
        const prizeLevel = fields[4];
        const totalPrizes = parseInt(fields[5]) || 0;
        const prizesClaimed = parseInt(fields[6]) || 0;

        if (!gameNumber || !gameName) continue;

        // Skip TOTAL rows
        if (prizeLevel === 'TOTAL') continue;

        if (!gameMap.has(gameNumber)) {
            gameMap.set(gameNumber, {
                id: gameNumber,
                name: gameName,
                price: ticketPrice,
                closeDate: closeDate,
                prizes: [],
                scrapedAt: new Date().toISOString()
            });
        }

        const prizeAmount = parseInt(prizeLevel.replace(/[,$]/g, ''));
        if (!isNaN(prizeAmount) && prizeAmount > 0) {
            gameMap.get(gameNumber).prizes.push({
                amount: prizeAmount,
                total: totalPrizes,
                claimed: prizesClaimed,
                remaining: totalPrizes - prizesClaimed
            });
        }
    }

    // Convert to game objects with top prize info
    const games = [];
    for (const [, game] of gameMap) {
        // Sort prizes descending to find top prize
        game.prizes.sort((a, b) => b.amount - a.amount);
        const topPrize = game.prizes[0];

        games.push({
            id: game.id,
            name: game.name,
            price: game.price,
            closeDate: game.closeDate,
            topPrize: topPrize ? topPrize.amount : 0,
            topPrizesTotal: topPrize ? topPrize.total : 0,
            topPrizesRemaining: topPrize ? topPrize.remaining : 0,
            prizes: game.prizes,
            scrapedAt: game.scrapedAt
        });
    }

    console.log(`[Scraper] CSV: Found ${games.length} games`);
    return games;
}

/**
 * Scrape the current-games list (all.html).
 * Returns a Map of gameId -> { detailUrl, startDate }.
 *
 * This list is the authority on what is on sale: games missing from it are no
 * longer sold (even if they still appear in the prize CSV), and rows with a
 * future start date are upcoming launches that can't be bought yet.
 */
async function scrapeCurrentGames() {
    console.log('[Scraper] Fetching current-games list (all.html)...');

    const response = await axios.get(LOTTERY_URLS.allGames, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: 30000
    });

    const $ = cheerio.load(response.data);
    const currentGames = new Map();

    // Each game row: <a title="View details for Game Number NNNN">NNNN</a>,
    // followed by a start-date cell (MM/DD/YY).
    $('a[title*="View details for Game Number"]').each((i, el) => {
        const href = $(el).attr('href');
        const gameIdMatch = $(el).text().trim().match(/^(\d+)$/);
        if (gameIdMatch && href) {
            const gameId = parseInt(gameIdMatch[1]);
            const startText = $(el).closest('td').next('td').text().trim();
            currentGames.set(gameId, {
                detailUrl: 'https://www.texaslottery.com' + href,
                startDate: parseLotteryDate(startText)
            });
        }
    });

    console.log(`[Scraper] Current-games list: ${currentGames.size} games`);
    return currentGames;
}

/**
 * Fetch overall odds from a game detail page
 */
async function fetchOverallOdds(detailUrl) {
    const response = await axios.get(detailUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: 10000
    });

    const text = response.data;
    const oddsMatch = text.match(/[Oo]verall odds.*?(?:are|:)\s*1\s+in\s+([\d.]+)/);
    if (oddsMatch) {
        return parseFloat(oddsMatch[1]);
    }
    return null;
}

/**
 * Fetch overall odds for all games in batches
 */
async function fetchAllOverallOdds(gameDetailUrls) {
    const oddsMap = new Map();
    const entries = Array.from(gameDetailUrls.entries());
    const BATCH_SIZE = 5;

    console.log(`[Scraper] Fetching overall odds for ${entries.length} games...`);

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
            batch.map(async ([gameId, url]) => {
                try {
                    const odds = await fetchOverallOdds(url);
                    return [gameId, odds];
                } catch (err) {
                    return [gameId, null];
                }
            })
        );

        for (const [gameId, odds] of results) {
            if (odds !== null) {
                oddsMap.set(gameId, odds);
            }
        }
    }

    console.log(`[Scraper] Got overall odds for ${oddsMap.size}/${entries.length} games`);
    return oddsMap;
}

/**
 * Scrape all scratch-off games from Texas Lottery HTML (fallback)
 * Table columns: Game Number, Start Date, Ticket Price, Close?, Game Name, Prize Amount, Total, Remaining
 */
async function scrapeAllGames() {
    try {
        console.log('[Scraper] Fetching all games from Texas Lottery HTML...');

        const response = await axios.get(LOTTERY_URLS.allGames, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            },
            timeout: 30000
        });

        const $ = cheerio.load(response.data);
        const gameMap = new Map();
        let currentGameId = null;

        $('table tbody tr, table tr').each((index, element) => {
            try {
                const $row = $(element);
                if ($row.find('th').length > 0) return;

                const cells = $row.find('td');
                if (cells.length < 8) return;

                const gameIdText = $(cells[0]).text().trim();
                const priceText = $(cells[2]).text().trim();
                const gameName = $(cells[4]).text().trim();
                const prizeText = $(cells[5]).text().trim();
                const totalText = $(cells[6]).text().trim();
                const remainingText = $(cells[7]).text().trim();

                // Check if this is a main game row (has a game ID) or a sub-prize row
                const gameIdMatch = gameIdText.match(/(\d+)/);
                if (gameIdMatch) {
                    currentGameId = parseInt(gameIdMatch[1]);
                    const priceMatch = priceText.match(/\$?(\d+)/);
                    const price = priceMatch ? parseInt(priceMatch[1]) : 5;

                    if (!gameMap.has(currentGameId)) {
                        gameMap.set(currentGameId, {
                            id: currentGameId,
                            name: gameName || `Game ${currentGameId}`,
                            price: price,
                            prizes: [],
                            scrapedAt: new Date().toISOString()
                        });
                    }
                }

                // Parse prize data from this row (both main and sub-rows)
                if (currentGameId && prizeText) {
                    const prizeMatch = prizeText.match(/\$?([\d,]+)/);
                    const totalMatch = totalText.match(/(\d+)/);
                    const remainingMatch = remainingText.match(/(\d+)/);

                    if (prizeMatch) {
                        const amount = parseInt(prizeMatch[1].replace(/,/g, ''));
                        const total = totalMatch ? parseInt(totalMatch[1]) : 0;
                        const remaining = remainingMatch ? parseInt(remainingMatch[1]) : 0;

                        if (amount > 0) {
                            gameMap.get(currentGameId).prizes.push({ amount, total, remaining });
                        }
                    }
                }
            } catch (err) {
                // Skip problematic rows
            }
        });

        // Convert to game objects
        const games = [];
        for (const [, game] of gameMap) {
            game.prizes.sort((a, b) => b.amount - a.amount);
            const topPrize = game.prizes[0];

            games.push({
                id: game.id,
                name: game.name,
                price: game.price,
                topPrize: topPrize ? topPrize.amount : 0,
                topPrizesTotal: topPrize ? topPrize.total : 0,
                topPrizesRemaining: topPrize ? topPrize.remaining : 0,
                prizes: game.prizes,
                scrapedAt: game.scrapedAt
            });
        }

        console.log(`[Scraper] HTML: Found ${games.length} games`);
        return games;
    } catch (error) {
        console.error('[Scraper] Error fetching games list:', error.message);
        throw error;
    }
}

/**
 * Scrape detailed info for a specific game (prizes remaining, odds, etc.)
 */
async function scrapeGameDetails(gameId) {
    try {
        console.log(`[Scraper] Fetching details for game ${gameId}...`);

        const response = await axios.get(LOTTERY_URLS.gameDetails(gameId), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);

        const details = {
            id: gameId,
            topPrize: null,
            overallOdds: null,
            topPrizesTotal: null,
            topPrizesRemaining: null,
            prizes: []
        };

        // Extract overall odds. The page reads "Overall odds of winning any
        // prize in <GAME NAME> are 1 in 3.99" — the old pattern expected
        // "overall odds ... 1 in" with nothing between, so it never matched and
        // every game silently fell back to the static value.
        const oddsText = $('body').text().replace(/\s+/g, ' ');
        const oddsMatch = oddsText.match(/overall odds[\s\S]{0,200}?\b1\s*(?:in|:)\s*(\d+(?:\.\d+)?)/i);
        if (oddsMatch) {
            details.overallOdds = parseFloat(oddsMatch[1]);
        }

        // Extract prize table
        $('table').each((tableIndex, table) => {
            const $table = $(table);
            const tableText = $table.text().toLowerCase();

            // Look for prize tables
            if (tableText.includes('prize') && (tableText.includes('remaining') || tableText.includes('odds'))) {
                $table.find('tr').each((rowIndex, row) => {
                    const cells = $(row).find('td');
                    if (cells.length >= 2) {
                        const prizeText = $(cells[0]).text().trim();
                        const remainingText = $(cells[1]).text().trim();

                        // Parse prize amount
                        const prizeMatch = prizeText.match(/\$?([\d,]+)/);
                        if (prizeMatch) {
                            const prizeAmount = parseInt(prizeMatch[1].replace(/,/g, ''));
                            const remainingMatch = remainingText.match(/(\d+)/);
                            const remaining = remainingMatch ? parseInt(remainingMatch[1]) : 0;

                            details.prizes.push({
                                amount: prizeAmount,
                                remaining: remaining
                            });

                            // Track top prize
                            if (!details.topPrize || prizeAmount > details.topPrize) {
                                details.topPrize = prizeAmount;
                                details.topPrizesRemaining = remaining;
                            }
                        }
                    }
                });
            }
        });

        // Alternative: look for specific text patterns
        if (!details.topPrize) {
            const topPrizeMatch = oddsText.match(/top prize[:\s]*\$?([\d,]+)/i);
            if (topPrizeMatch) {
                details.topPrize = parseInt(topPrizeMatch[1].replace(/,/g, ''));
            }
        }

        if (!details.topPrizesRemaining) {
            const remainingMatch = oddsText.match(/(\d+)\s*(?:of\s*\d+)?\s*(?:top prizes?|jackpots?)\s*remaining/i);
            if (remainingMatch) {
                details.topPrizesRemaining = parseInt(remainingMatch[1]);
            }
        }

        return details;
    } catch (error) {
        console.error(`[Scraper] Error fetching details for game ${gameId}:`, error.message);
        return null;
    }
}

/**
 * Scrape from lottery.net (more structured data)
 */
async function scrapeLotteryNet() {
    try {
        console.log('[Scraper] Fetching from lottery.net...');

        const response = await axios.get('https://www.lottery.net/texas/scratch-offs', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            timeout: 30000
        });

        const $ = cheerio.load(response.data);
        const games = [];

        // Parse the scratch-off table
        $('table tr, .game-item, .scratch-game').each((index, element) => {
            try {
                const $el = $(element);
                const text = $el.text();

                // Look for game patterns
                const nameMatch = text.match(/([A-Za-z0-9\$\s,!]+?)(?:\s*\$(\d+)|\s+\d+\s+(?:of|remaining))/);
                const priceMatch = text.match(/\$(\d+)(?:\s*ticket)?/i);
                const oddsMatch = text.match(/1\s*(?:in|:)\s*([\d.]+)/);
                const remainingMatch = text.match(/(\d+)\s*(?:of\s*(\d+))?\s*(?:remaining|left)/i);
                const topPrizeMatch = text.match(/\$([\d,]+)(?:,000)?/);

                if (nameMatch || priceMatch) {
                    const game = {
                        name: nameMatch ? nameMatch[1].trim() : 'Unknown',
                        price: priceMatch ? parseInt(priceMatch[1]) : 5,
                        overallOdds: oddsMatch ? parseFloat(oddsMatch[1]) : 4.0,
                        topPrizesRemaining: remainingMatch ? parseInt(remainingMatch[1]) : null,
                        topPrizesTotal: remainingMatch && remainingMatch[2] ? parseInt(remainingMatch[2]) : null,
                        topPrize: topPrizeMatch ? parseInt(topPrizeMatch[1].replace(/,/g, '')) : null
                    };

                    if (game.name !== 'Unknown' && !games.find(g => g.name === game.name)) {
                        games.push(game);
                    }
                }
            } catch (err) {
                // Skip
            }
        });

        return games;
    } catch (error) {
        console.error('[Scraper] Error fetching from lottery.net:', error.message);
        return [];
    }
}

/**
 * Main function to get all lottery data
 */
async function fetchLotteryData() {
    // Check cache
    if (cachedData && lastFetchTime && (Date.now() - lastFetchTime) < CACHE_DURATION) {
        console.log('[Cache] Returning cached data');
        return cachedData;
    }

    console.log('[Scraper] Fetching fresh lottery data...');

    try {
        let games = [];

        // Source 1: Texas Lottery CSV (most reliable - structured data)
        try {
            games = await scrapeFromCSV();
        } catch (e) {
            console.log('[Scraper] CSV fetch failed:', e.message);
        }

        // Source 2: Texas Lottery HTML (fallback)
        if (games.length === 0) {
            try {
                games = await scrapeAllGames();
            } catch (e) {
                console.log('[Scraper] HTML scrape failed:', e.message);
            }
        }

        // Source 3: lottery.net (last resort)
        if (games.length === 0) {
            games = await scrapeLotteryNet();
        }

        // Fetch the current-games list and the closing-games list. Both are
        // required to know what is actually buyable — the prize CSV keeps
        // closed games around for months (claim window). Fail open: if either
        // fetch fails we skip that specific check rather than serving nothing.
        let currentGames = null;
        try {
            currentGames = await scrapeCurrentGames();
        } catch (e) {
            console.log('[Scraper] Current-games list fetch failed:', e.message);
        }

        let closingMap = new Map();
        try {
            closingMap = await scrapeClosingDates();
        } catch (e) {
            console.log('[Scraper] Closing-games list fetch failed:', e.message);
        }

        // Fetch overall odds from detail pages
        let oddsMap = new Map();
        try {
            if (currentGames && currentGames.size > 0) {
                const detailUrls = new Map();
                for (const [id, info] of currentGames) detailUrls.set(id, info.detailUrl);
                oddsMap = await fetchAllOverallOdds(detailUrls);
            }
        } catch (e) {
            console.log('[Scraper] Overall odds fetch failed:', e.message);
        }

        // Finalize game data — merge odds and sales status
        const now = new Date();
        games = games.map((game, index) => {
            const sales = computeSalesStatus(game.id, game.closeDate, currentGames, closingMap, now);
            return {
                id: game.id || 2600 + index,
                name: game.name || `Game ${index}`,
                price: game.price || 5,
                topPrize: game.topPrize || 0,
                overallOdds: game.overallOdds || oddsMap.get(game.id) || null,
                topPrizesTotal: game.topPrizesTotal || 0,
                topPrizesRemaining: game.topPrizesRemaining || 0,
                prizes: game.prizes || [],
                type: categorizeGame(game.name || ''),
                closeDate: game.closeDate || null,
                salesStatus: sales.status,
                callDate: sales.callDate ? sales.callDate.toISOString() : null,
                endDate: sales.endDate ? sales.endDate.toISOString() : null,
                lastUpdated: new Date().toISOString()
            };
        });

        // Games that can no longer be bought anywhere (or aren't on sale yet)
        // must never reach the app.
        const before = games.length;
        games = games.filter(g => g.salesStatus !== 'ended' && g.salesStatus !== 'upcoming');
        if (before !== games.length) {
            console.log(`[Scraper] Filtered out ${before - games.length} closed/upcoming games (${games.length} remain on sale)`);
        }

        cachedData = {
            games: games,
            fetchedAt: new Date().toISOString(),
            source: 'Texas Lottery / lottery.net',
            gameCount: games.length
        };

        lastFetchTime = Date.now();

        console.log(`[Scraper] Successfully fetched ${games.length} games`);
        return cachedData;

    } catch (error) {
        console.error('[Scraper] All sources failed:', error.message);

        // Return cached data if available, even if stale
        if (cachedData) {
            console.log('[Cache] Returning stale cached data');
            return cachedData;
        }

        throw error;
    }
}

/**
 * Categorize game by name
 */
function categorizeGame(name) {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('loteria')) return 'loteria';
    if (lowerName.includes('bingo')) return 'bingo';
    if (lowerName.includes('crossword') || lowerName.includes('word')) return 'crossword';
    if (lowerName.includes('x ') || lowerName.includes('multiplier') || /\d+x/i.test(name)) return 'multiplier';
    if (lowerName.includes('cowboy') || lowerName.includes('texan') || lowerName.includes('jaws') ||
        lowerName.includes('jurassic') || lowerName.includes('casino')) return 'themed';
    return 'standard';
}

// ============================================
// API ENDPOINTS
// ============================================

/**
 * GET /api/games - Get all scratch-off games
 */
app.get('/api/games', async (req, res) => {
    try {
        const data = await fetchLotteryData();
        res.json({
            success: true,
            data: data.games,
            meta: {
                fetchedAt: data.fetchedAt,
                source: data.source,
                count: data.gameCount
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to fetch lottery data',
            message: error.message
        });
    }
});

/**
 * GET /api/games/:id - Get specific game details
 */
app.get('/api/games/:id', async (req, res) => {
    try {
        const gameId = parseInt(req.params.id);
        const data = await fetchLotteryData();
        const game = data.games.find(g => g.id === gameId);

        if (game) {
            res.json({
                success: true,
                data: game
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Game not found'
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to fetch game details',
            message: error.message
        });
    }
});

/**
 * GET /api/refresh - Force refresh data
 */
app.get('/api/refresh', async (req, res) => {
    try {
        // Clear cache to force refresh
        cachedData = null;
        lastFetchTime = null;

        const data = await fetchLotteryData();
        res.json({
            success: true,
            message: 'Data refreshed successfully',
            data: data.games,
            meta: {
                fetchedAt: data.fetchedAt,
                source: data.source,
                count: data.gameCount
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to refresh data',
            message: error.message
        });
    }
});

/**
 * GET /api/status - Check server status
 */
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        status: 'running',
        cached: cachedData ? true : false,
        lastFetch: lastFetchTime ? new Date(lastFetchTime).toISOString() : null,
        cacheAge: lastFetchTime ? Math.floor((Date.now() - lastFetchTime) / 1000) + 's' : null
    });
});

// ============================================
// RETAILER LOCATION API (Texas Open Data)
// ============================================

// Cache for retailer data
const retailerCache = new Map();
const RETAILER_CACHE_DURATION = 3600000; // 1 hour cache

/**
 * Scrape retailers from the official Texas Lottery Retailer Locator
 * https://www.texaslottery.com/opencms/Games/Scratch_Offs/Retailer_Locator.jsp
 *
 * The form POSTs with: submitted=true, city, zip, gameNumber, smoking, selfCheck
 * Returns an HTML table with columns: Retailer Name, Street Address, City, Phone, Smoking, Self Check, Map
 */
async function scrapeTexasLotteryRetailers(zip, city, gameNumber) {
    const url = 'https://www.texaslottery.com/opencms/Games/Scratch_Offs/Retailer_Locator.jsp';

    const formData = new URLSearchParams();
    formData.append('submitted', 'true');
    // The locator matches city case-sensitively and stores them uppercase
    formData.append('city', (city || '').toUpperCase());
    formData.append('zip', zip || '');
    // Empty = every lottery retailer. A game number restricts the results to
    // the retailers that have reported stocking that specific game — without
    // it the response is NOT an answer to "who has this ticket".
    formData.append('gameNumber', gameNumber ? String(gameNumber) : '');
    formData.append('smoking', '');
    formData.append('Submit', 'Search >>');

    console.log(`[Retailers] Scraping TX Lottery Locator: zip=${zip || '(none)'}, city=${city || '(none)'}, game=${gameNumber || '(all)'}`);

    const response = await axios.post(url, formData.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html',
            'Referer': url
        },
        timeout: 20000
    });

    const $ = cheerio.load(response.data);
    const retailers = [];

    // Parse the results table
    $('tbody tr').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 4) {
            const name = $(cells[0]).text().trim();
            const address = $(cells[1]).text().trim();
            const cityName = $(cells[2]).text().trim();
            const phone = $(cells[3]).text().trim();
            const smoking = cells.length > 4 ? $(cells[4]).text().trim() : '';
            const selfCheck = cells.length > 5 ? $(cells[5]).text().trim() : '';

            // Extract ZIP from the Google Maps link if available
            const mapLink = $(cells[cells.length - 1]).find('a').attr('href') || '';
            // Map links look like: http://maps.google.com/?q=ADDRESS, CITY, Texas, ZIP
            const zipMatch = mapLink.match(/,\s*(\d{5})/);
            const retailerZip = zipMatch ? zipMatch[1] : (zip || '');

            if (name && address) {
                retailers.push({
                    name: name,
                    address: address,
                    city: cityName,
                    state: 'TX',
                    zip: retailerZip,
                    phone: phone,
                    smoking: smoking,
                    selfCheck: selfCheck.trim() || null,
                    lat: null,
                    lng: null
                });
            }
        }
    });

    console.log(`[Retailers] Scraped ${retailers.length} retailers from TX Lottery`);
    return retailers;
}

/**
 * GET /api/retailers - Get lottery retailers near a location
 * Scrapes the official Texas Lottery Retailer Locator
 * Query params:
 *   - zip: ZIP code to search
 *   - city: City name to search
 *   - lat/lng: Coordinates (will reverse-geocode to ZIP)
 *   - limit: Max results (default 50)
 */
app.get('/api/retailers', async (req, res) => {
    try {
        const { zip, city, lat, lng, gameNumber = '', limit = 50 } = req.query;

        if (!zip && !city && (!lat || !lng)) {
            return res.status(400).json({
                success: false,
                error: 'Please provide zip, city, or lat/lng coordinates'
            });
        }

        // If we have lat/lng but no zip/city, reverse geocode first
        let searchZip = zip || '';
        let searchCity = city || '';

        if (!searchZip && !searchCity && lat && lng) {
            try {
                const geoResponse = await axios.get(
                    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
                    { headers: { 'User-Agent': 'LotChance/1.0' }, timeout: 10000 }
                );
                searchZip = geoResponse.data?.address?.postcode || '';
                searchCity = geoResponse.data?.address?.city
                    || geoResponse.data?.address?.town
                    || geoResponse.data?.address?.village || '';
                console.log(`[Retailers] Reverse geocoded ${lat},${lng} → ZIP: ${searchZip}, City: ${searchCity}`);
            } catch (geoErr) {
                console.error('[Retailers] Reverse geocode failed:', geoErr.message);
            }
        }

        if (!searchZip && !searchCity) {
            return res.status(400).json({
                success: false,
                error: 'Could not determine location to search'
            });
        }

        // Create cache key — the game filter changes the result set, so it has
        // to be part of the key
        const cacheKey = `txlottery-${searchZip}-${searchCity}-${gameNumber}`.toLowerCase();

        // Check cache
        const cached = retailerCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < RETAILER_CACHE_DURATION) {
            console.log(`[Retailers] Returning ${cached.data.length} cached retailers`);
            return res.json({
                success: true,
                data: cached.data.slice(0, parseInt(limit)),
                meta: { source: 'cache (Texas Lottery)', count: cached.data.length }
            });
        }

        // Scrape from official Texas Lottery Retailer Locator
        const retailers = await scrapeTexasLotteryRetailers(searchZip, searchCity, gameNumber);

        // Deduplicate by name+address
        const unique = [];
        const seen = new Set();
        for (const r of retailers) {
            const key = `${r.name}-${r.address}`.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(r);
            }
        }

        // Cache results
        retailerCache.set(cacheKey, {
            data: unique,
            timestamp: Date.now()
        });

        console.log(`[Retailers] Returning ${unique.length} unique retailers`);

        res.json({
            success: true,
            data: unique.slice(0, parseInt(limit)),
            meta: {
                source: 'Texas Lottery Retailer Locator',
                total: unique.length,
                query: searchZip || searchCity,
                gameNumber: gameNumber || null,
                // Without a gameNumber these are all lottery retailers, not
                // retailers known to stock a particular game.
                carriersOnly: Boolean(gameNumber)
            }
        });

    } catch (error) {
        console.error('[Retailers] Error fetching retailers:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch retailer data',
            message: error.message
        });
    }
});

/**
 * GET /api/retailers/geocode - Geocode retailer addresses to get coordinates
 */
app.get('/api/retailers/geocode', async (req, res) => {
    try {
        const { address, city, state = 'TX', zip } = req.query;

        if (!address && !city) {
            return res.status(400).json({
                success: false,
                error: 'Please provide address or city'
            });
        }

        // Build address string
        const fullAddress = [address, city, state, zip].filter(Boolean).join(', ');

        console.log(`[Geocode] Geocoding: ${fullAddress}`);

        const response = await axios.get(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullAddress)}&limit=1`,
            {
                headers: { 'User-Agent': 'LotChance/1.0' },
                timeout: 10000
            }
        );

        if (response.data && response.data.length > 0) {
            res.json({
                success: true,
                data: {
                    lat: parseFloat(response.data[0].lat),
                    lng: parseFloat(response.data[0].lon),
                    displayName: response.data[0].display_name
                }
            });
        } else {
            res.json({
                success: false,
                error: 'Address not found'
            });
        }

    } catch (error) {
        console.error('[Geocode] Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Geocoding failed',
            message: error.message
        });
    }
});

// ============================================
// SAME-ORIGIN PROXY ROUTES
// Mirror the Netlify redirects in dist/netlify.toml so the frontend
// (scraper.js + map geocoding) works identically when served locally.
// ============================================

const PROXY_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function pipeProxy(res, url, options = {}) {
    const attempt = () => axios.get(url, {
        headers: { 'User-Agent': PROXY_UA, ...(options.headers || {}) },
        params: options.params,
        timeout: 20000,
        responseType: 'text',
        transformResponse: [(d) => d]
    });

    try {
        let upstream;
        try {
            upstream = await attempt();
        } catch (err) {
            // Retry once on transient network errors (DNS hiccups, resets) —
            // but not on HTTP error responses, which would just repeat.
            if (err.response) throw err;
            console.warn(`[Proxy] ${url} network error (${err.message}), retrying...`);
            upstream = await attempt();
        }
        if (upstream.headers['content-type']) {
            res.set('Content-Type', upstream.headers['content-type']);
        }
        res.send(upstream.data);
    } catch (err) {
        console.error(`[Proxy] ${url} failed:`, err.message);
        res.status(err.response?.status || 502).send(`Proxy error: ${err.message}`);
    }
}

app.get('/proxy/csv', (req, res) => pipeProxy(res, LOTTERY_URLS.csv));
app.get('/proxy/all', (req, res) => pipeProxy(res, LOTTERY_URLS.allGames));
app.get('/proxy/details/:slug', (req, res) =>
    pipeProxy(res, `https://www.texaslottery.com/export/sites/lottery/Games/Scratch_Offs/${encodeURIComponent(req.params.slug)}`));
app.get('/proxy/retailers', (req, res) =>
    pipeProxy(res, 'https://www.texaslottery.com/opencms/Games/Scratch_Offs/Retailer_Locator.jsp', { params: req.query }));

// Nominatim geocoder proxy — adds the identifying User-Agent their usage
// policy requires (browsers can't set one) and caches responses for an hour
// so repeated geocodes of the same address don't hit their rate limit.
const nominatimCache = new Map();
const NOMINATIM_CACHE_DURATION = 3600000;

app.get('/proxy/nominatim/:endpoint', async (req, res) => {
    const { endpoint } = req.params;
    if (endpoint !== 'search' && endpoint !== 'reverse') {
        return res.status(400).json({ error: 'Unsupported nominatim endpoint' });
    }

    const url = `https://nominatim.openstreetmap.org/${endpoint}?${new URLSearchParams(req.query)}`;
    const cached = nominatimCache.get(url);
    if (cached && (Date.now() - cached.timestamp) < NOMINATIM_CACHE_DURATION) {
        return res.type('application/json').send(cached.data);
    }

    try {
        const upstream = await axios.get(url, {
            headers: { 'User-Agent': 'LotChance/1.0 (Texas lottery retailer locator)' },
            timeout: 15000,
            responseType: 'text',
            transformResponse: [(d) => d]
        });
        nominatimCache.set(url, { timestamp: Date.now(), data: upstream.data });
        res.type('application/json').send(upstream.data);
    } catch (err) {
        console.error(`[Proxy] nominatim/${endpoint} failed:`, err.message);
        res.status(err.response?.status || 502).json({ error: `Geocoding failed: ${err.message}` });
    }
});

// Serve index.html for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════╗
║           LotChance Server Started                 ║
╠════════════════════════════════════════════════════╣
║  Local:   http://localhost:${PORT}                    ║
║  API:     http://localhost:${PORT}/api/games          ║
║  Status:  http://localhost:${PORT}/api/status         ║
╚════════════════════════════════════════════════════╝
    `);

    // Pre-fetch data on startup
    fetchLotteryData().then(() => {
        console.log('[Startup] Initial data fetch complete');
    }).catch(err => {
        console.log('[Startup] Initial fetch failed:', err.message);
    });
});
