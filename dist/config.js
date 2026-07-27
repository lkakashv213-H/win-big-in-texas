/**
 * LotChance Configuration
 * Edit these settings to customize the app behavior
 */

const CONFIG = {
    // ===========================================
    // REFRESH SETTINGS
    // ===========================================

    // Default refresh interval in seconds (can also be changed in UI)
    DEFAULT_REFRESH_INTERVAL: 10,

    // Minimum refresh interval allowed (seconds) - prevents server overload
    MIN_REFRESH_INTERVAL: 5,

    // Maximum refresh interval allowed (seconds)
    MAX_REFRESH_INTERVAL: 600,

    // Auto-start refresh when page loads
    AUTO_START_REFRESH: false,

    // ===========================================
    // API SETTINGS
    // ===========================================

    // Backend server URL (change if running on different port/host)
    API_URL: 'http://localhost:3000',

    // API request timeout in milliseconds
    API_TIMEOUT: 30000,

    // Retry failed requests this many times
    API_RETRY_COUNT: 3,

    // ===========================================
    // DATA CACHE SETTINGS (Server-side)
    // ===========================================

    // How long to cache scraped data on server (milliseconds)
    // Note: Texas Lottery updates data periodically, not real-time
    SERVER_CACHE_DURATION: 60000, // 1 minute

    // ===========================================
    // DISPLAY SETTINGS
    // ===========================================

    // Number of games to show in Top 5 lists
    TOP_PICKS_COUNT: 5,

    // Default sort order for games list
    DEFAULT_SORT: 'adjustedOdds', // Options: adjustedOdds, overallOdds, jackpot, price, value

    // Show games with no jackpots remaining
    SHOW_EMPTY_JACKPOTS: true,

    // ===========================================
    // LOCATION SETTINGS
    // ===========================================

    // Default Texas cities for autocomplete
    TEXAS_CITIES: [
        "Houston", "San Antonio", "Dallas", "Austin", "Fort Worth",
        "El Paso", "Arlington", "Corpus Christi", "Plano", "Laredo",
        "Lubbock", "Garland", "Irving", "Amarillo", "Grand Prairie"
    ],

    // ===========================================
    // SCRAPER SETTINGS (Server-side)
    // ===========================================

    // Data sources to try (in order of priority)
    DATA_SOURCES: [
        'https://www.texaslottery.com/export/sites/lottery/Games/Scratch_Offs/all.html',
        'https://www.lottery.net/texas/scratch-offs'
    ],

    // User agent for web scraping
    SCRAPER_USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',

    // ===========================================
    // PUBLISHED DATA BUNDLE
    // ===========================================
    // Where the pre-built JSON lives (see .github/workflows/update-data.yml).
    // Serving it from a static host keeps every user off texaslottery.com and
    // data.texas.gov — nobody gets rate-limited and retailers arrive already
    // geocoded, so the app never has to call a geocoder.
    //
    // Set this to your published copy, e.g.
    //   https://raw.githubusercontent.com/<user>/<repo>/main/public-data
    // Leave it empty to disable the bundle and scrape live instead.
    DATA_BUNDLE_URL: 'https://raw.githubusercontent.com/lkakashv213-H/win-big-in-texas/main/public-data'
};

// Export for use in browser and Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
