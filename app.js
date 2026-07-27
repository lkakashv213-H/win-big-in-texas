// Texas Lottery Scratch-Off Analyzer App
// Main Application Logic with Real-Time Data from Backend API

class LotChanceApp {
    // Upper bound on neighbouring-ZIP locator requests per search. Each one is
    // a ~100 KB page, so this trades coverage against load time on mobile.
    static MAX_NEIGHBOUR_ZIP_QUERIES = 12;

    // How many retailers get an exact address geocode. Nominatim allows one
    // request per second, so this is roughly how many seconds the background
    // refinement pass takes.
    static MAX_EXACT_GEOCODES = 20;

    // How many retailers the map and list show at once.
    static MAX_RENDERED_RETAILERS = 50;

    // Data older than this is called out in the UI. The scratch-off CSV moves
    // daily, so a day-old copy is the point where 'prizes remaining' can be
    // meaningfully wrong.
    static STALE_DATA_MS = 24 * 60 * 60 * 1000;

    // Detail pages fetched per load to fill in missing overall odds. Normally
    // only newly launched games need this, so the cap is rarely reached.
    static MAX_ODDS_BACKFILL = 8;

    constructor() {
        // Will be populated from API
        this.games = [];
        this.filteredGames = [];
        this.currentLocation = null;
        this.selectedGame = null;

        // API Configuration - use config if available
        this.API_BASE = (typeof CONFIG !== 'undefined' && CONFIG.API_URL)
            ? CONFIG.API_URL
            : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
                ? `http://localhost:3000`
                : '');

        // Auto-refresh config - use config if available
        this.refreshInterval = (typeof CONFIG !== 'undefined' && CONFIG.DEFAULT_REFRESH_INTERVAL)
            ? CONFIG.DEFAULT_REFRESH_INTERVAL
            : 10; // seconds
        this.refreshTimer = null;
        this.countdownTimer = null;
        this.countdown = 0;
        this.isRefreshing = false;
        this.lastRefreshTime = new Date();
        this.isLoading = false;
        this.lastError = null;

        // Insight filter state
        this.activeInsightIndex = null;
        this.insightFilterGameIds = null;
        this.currentInsights = [];

        // Near Me mode state
        this.nearMeEnabled = false;
        this.nearMeLocation = null; // { lat, lng }
        this.nearMeRadius = 10; // miles
        this.nearMeRetailers = [];

        // Retailer search state
        this._retailerSearchToken = 0;
        this._lastSearchCenter = null;
        this._lastSearchRadius = null;
        this._mapAutoSearchAttached = false;
        this._zipCentroids = new Map();

        this.init();
    }

    async init() {
        this.showLoadingState();
        this.bindEvents();
        this.restoreSavedLocation();
        this.populateCityList();   // fire and forget — autocomplete only

        // Seed with the newest offline data we have. The last successful live
        // fetch beats the bundled data.js, which is a build-time snapshot and
        // goes stale the moment a game launches or closes.
        const cached = this.loadCachedGames();
        this.games = cached ? cached.games : [...TEXAS_SCRATCH_OFFS];
        if (cached) this.setDataProvenance('cache', new Date(cached.at));
        else this.setDataProvenance('bundled', null);

        // Try to fetch API updates (offline data is only ever a base)
        const success = await this.fetchFromAPI();

        if (!success) {
            const age = cached ? this.describeAge(cached.at) : t('app.bundledSnapshot');
            console.log(`[App] API unavailable, showing offline data (${age})`);
            this.showNotification(t('app.usingCachedAge', { age }), 'warning');
        }

        // Use only valid games (those with complete data)
        this.filteredGames = this.getValidGames();

        console.log(`[App] Loaded ${this.filteredGames.length} valid games`);

        this.hideLoadingState();
        this.updateDashboard();
        this.updateTopPicks();
        this.renderGames();
        this.generateInsights();
        this.updateLastRefreshTime();

        // Auto-start refresh if configured
        if (typeof CONFIG !== 'undefined' && CONFIG.AUTO_START_REFRESH) {
            this.startAutoRefresh();
        }
    }

    showLoadingState() {
        this.isLoading = true;
        const grid = document.getElementById('gamesGrid');
        if (grid) {
            grid.innerHTML = `
                <div class="loading" style="grid-column: 1/-1; padding: 60px; text-align: center;">
                    <i class="fas fa-spinner fa-spin" style="font-size: 48px; color: var(--primary-light);"></i>
                    <p style="margin-top: 16px; color: var(--text-muted);">${t('app.loadingData')}</p>
                </div>
            `;
        }
    }

    hideLoadingState() {
        this.isLoading = false;
    }

    bindEvents() {
        // Location search
        document.getElementById('setLocationBtn').addEventListener('click', () => this.setLocation());
        document.getElementById('locationInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.setLocation();
        });

        // Filters
        document.getElementById('applyFilters').addEventListener('click', () => this.applyFilters());
        document.getElementById('resetFilters').addEventListener('click', () => this.resetFilters());

        // Filter change listeners for instant feedback
        ['priceFilter', 'sortBy', 'jackpotFilter', 'typeFilter'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => this.applyFilters());
        });

        // Auto-refresh controls
        document.getElementById('toggleRefresh').addEventListener('click', () => this.toggleAutoRefresh());
        document.getElementById('manualRefresh').addEventListener('click', () => this.manualRefresh());
        document.getElementById('refreshInterval').addEventListener('change', (e) => {
            this.refreshInterval = parseInt(e.target.value);
            if (this.isRefreshing) {
                this.stopAutoRefresh();
                this.startAutoRefresh();
            }
        });

        // Modals
        document.getElementById('closeModal').addEventListener('click', () => this.closeGameModal());
        document.getElementById('closeRetailerModal').addEventListener('click', () => this.closeRetailerModal());

        // Close modals on overlay click
        document.getElementById('gameModal').addEventListener('click', (e) => {
            if (e.target.id === 'gameModal') this.closeGameModal();
        });
        document.getElementById('retailerModal').addEventListener('click', (e) => {
            if (e.target.id === 'retailerModal') this.closeRetailerModal();
        });

        // Retailer search
        document.getElementById('searchRetailers').addEventListener('click', () => this.searchRetailers());

        // Clear insight filter
        document.getElementById('clearInsightFilter').addEventListener('click', () => this.clearInsightFilter());

        // Near Me mode
        document.getElementById('nearMeToggle').addEventListener('change', (e) => this.toggleNearMe(e.target.checked));
        document.getElementById('nearMeDetect').addEventListener('click', () => this.detectNearMeLocation());
        document.getElementById('radiusSlider').addEventListener('input', (e) => {
            this.nearMeRadius = parseInt(e.target.value);
            document.getElementById('radiusValue').textContent = this.nearMeRadius;
        });
        document.getElementById('radiusSlider').addEventListener('change', () => {
            if (this.nearMeEnabled && this.nearMeLocation) {
                this.searchNearMeRetailers();
            }
        });
    }

    // ========================================
    // API COMMUNICATION
    // ========================================
    async fetchFromAPI() {
        try {
            console.log('[API] Fetching data from server...');

            const response = await fetch(`${this.API_BASE}/api/games`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();

            if (result.success && result.data && result.data.length > 0) {
                const staticById = new Map(TEXAS_SCRATCH_OFFS.map(g => [g.id, g]));
                const merged = result.data.map(game => {
                    const base = staticById.get(game.id) || {};
                    return {
                        id: game.id,
                        name: game.name || base.name,
                        price: game.price != null ? game.price : base.price,
                        topPrize: game.topPrize != null && game.topPrize > 0 ? game.topPrize : (base.topPrize || 0),
                        overallOdds: game.overallOdds != null ? game.overallOdds : (base.overallOdds || null),
                        topPrizesTotal: game.topPrizesTotal != null && game.topPrizesTotal > 0 ? game.topPrizesTotal : (base.topPrizesTotal || 0),
                        topPrizesRemaining: game.topPrizesRemaining != null ? game.topPrizesRemaining : (base.topPrizesRemaining || 0),
                        prizes: (game.prizes && game.prizes.length) ? game.prizes : (base.prizes || []),
                        type: game.type || base.type || 'standard',
                        salesStatus: game.salesStatus || 'active',
                        closeDate: game.closeDate || null,
                        callDate: game.callDate || null,
                        endDate: game.endDate || null,
                        // Detail-page slug, when the feed knows it. Lets odds be
                        // fetched for games that postdate data.js.
                        detailSlug: game.detailSlug || null,
                        lastUpdated: game.lastUpdated || new Date().toISOString()
                    };
                });

                // Deliberately NOT re-adding static games the live feed didn't
                // return: a game absent from the live data is closed (the CSV
                // keeps games through their whole 180-day claim window, so
                // absence really means gone). Resurrecting them from data.js is
                // how the long-closed "$3 Million Ca$h" ended up as a top pick.
                // Static data is only a base for odds and the full-offline
                // fallback.

                this.games = merged;
                this.lastRefreshTime = new Date(result.meta?.fetchedAt || Date.now());
                this.lastError = null;
                this.setDataProvenance('live', this.lastRefreshTime);

                console.log(`[API] Loaded ${result.data.length} live games (merged with ${TEXAS_SCRATCH_OFFS.length} static) → ${this.games.length} total`);
                this.saveCachedGames(merged);
                this.backfillOverallOdds();   // async; re-renders if it finds any
                return true;
            }

            return false;
        } catch (error) {
            console.error('[API] Fetch failed:', error.message);
            this.lastError = error.message;
            return false;
        }
    }

    async forceRefreshFromAPI() {
        try {
            console.log('[API] Force refreshing data...');

            const response = await fetch(`${this.API_BASE}/api/refresh`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();

            if (result.success && result.data) {
                const staticById = new Map(TEXAS_SCRATCH_OFFS.map(g => [g.id, g]));
                const merged = result.data.map(game => {
                    const base = staticById.get(game.id) || {};
                    return {
                        id: game.id,
                        name: game.name || base.name,
                        price: game.price != null ? game.price : base.price,
                        topPrize: game.topPrize != null && game.topPrize > 0 ? game.topPrize : (base.topPrize || 0),
                        overallOdds: game.overallOdds != null ? game.overallOdds : (base.overallOdds || null),
                        topPrizesTotal: game.topPrizesTotal != null && game.topPrizesTotal > 0 ? game.topPrizesTotal : (base.topPrizesTotal || 0),
                        topPrizesRemaining: game.topPrizesRemaining != null ? game.topPrizesRemaining : (base.topPrizesRemaining || 0),
                        prizes: (game.prizes && game.prizes.length) ? game.prizes : (base.prizes || []),
                        type: game.type || base.type || 'standard',
                        salesStatus: game.salesStatus || 'active',
                        closeDate: game.closeDate || null,
                        callDate: game.callDate || null,
                        endDate: game.endDate || null,
                        lastUpdated: game.lastUpdated || new Date().toISOString()
                    };
                });
                // Live feed is authoritative — see fetchFromAPI() for why
                // static-only games must not be re-added here.

                this.games = merged;
                this.filteredGames = [...this.games];
                return true;
            }

            return false;
        } catch (error) {
            console.error('[API] Force refresh failed:', error.message);
            return false;
        }
    }

    // ========================================
    // AUTO-REFRESH SYSTEM
    // ========================================
    toggleAutoRefresh() {
        if (this.isRefreshing) {
            this.stopAutoRefresh();
        } else {
            this.startAutoRefresh();
        }
    }

    startAutoRefresh() {
        this.isRefreshing = true;
        this.countdown = this.refreshInterval;

        // Update UI
        const btn = document.getElementById('toggleRefresh');
        btn.innerHTML = '<i class="fas fa-stop"></i> ' + t('refresh.stop');
        btn.classList.add('active');

        document.getElementById('refreshIndicator').classList.add('active');
        document.getElementById('refreshStatus').textContent = t('refresh.on');
        document.getElementById('liveBadge').classList.add('active');

        // Start countdown
        this.updateCountdown();
        this.countdownTimer = setInterval(() => {
            this.countdown--;
            this.updateCountdown();

            if (this.countdown <= 0) {
                this.refreshData();
                this.countdown = this.refreshInterval;
            }
        }, 1000);
    }

    stopAutoRefresh() {
        this.isRefreshing = false;

        // Clear timers
        if (this.countdownTimer) {
            clearInterval(this.countdownTimer);
            this.countdownTimer = null;
        }

        // Update UI
        const btn = document.getElementById('toggleRefresh');
        btn.innerHTML = '<i class="fas fa-play"></i> ' + t('refresh.start');
        btn.classList.remove('active');

        document.getElementById('refreshIndicator').classList.remove('active');
        document.getElementById('refreshStatus').textContent = t('refresh.off');
        document.getElementById('nextRefresh').textContent = '--';
        document.getElementById('liveBadge').classList.remove('active');
    }

    updateCountdown() {
        const mins = Math.floor(this.countdown / 60);
        const secs = this.countdown % 60;
        document.getElementById('nextRefresh').textContent =
            mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`;
    }

    manualRefresh() {
        this.refreshData();
        if (this.isRefreshing) {
            this.countdown = this.refreshInterval;
        }
    }

    async refreshData() {
        // Fetch real data from API
        const indicator = document.getElementById('refreshIndicator');
        indicator.classList.add('fetching');

        const success = await this.fetchFromAPI();

        indicator.classList.remove('fetching');

        if (success) {
            this.filteredGames = [...this.games];

            // Update all displays
            this.lastRefreshTime = new Date();
            this.updateLastRefreshTime();
            this.updateDashboard();
            this.updateTopPicks();
            this.applyFilters();
            this.generateInsights();

            // Visual feedback
            this.flashUpdate();
            console.log(`[Refresh] Data updated at ${this.lastRefreshTime.toLocaleTimeString()}`);
        } else {
            // Show error notification but keep existing data
            this.showNotification(t('app.refreshFailed'), 'error');
        }
    }

    /**
     * Show when the DATA was produced, not when the page last re-rendered.
     * Those are different things: reloading the app against a three-day-old
     * offline copy is not fresh data, and the old clock-only display made that
     * look identical to a live fetch.
     */
    updateLastRefreshTime() {
        const el = document.getElementById('lastUpdate');
        if (!el) return;

        const at = this.dataGeneratedAt;
        if (!at) {
            // The bundled data.js snapshot carries no machine-readable date, so
            // there is nothing honest to show. Saying "unknown" beats printing
            // a fabricated one — `new Date(null)` is epoch zero, not invalid,
            // which is exactly how this rendered "20661 days ago".
            el.textContent = t('dash.unknownDate');
            el.classList.add('data-stale');
            el.classList.remove('data-fresh');
            el.title = t('dash.sourceLabel', { src: t('dash.source.' + (this.dataSource || 'bundled')) });
            return;
        }

        const ageMs = Date.now() - at.getTime();
        const stale = ageMs > LotChanceApp.STALE_DATA_MS;
        const when = at.toLocaleString([], {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        el.textContent = `${when} · ${this.describeAge(at.getTime())}`;
        el.classList.toggle('data-stale', stale);
        el.classList.toggle('data-fresh', !stale);
        el.title = t('dash.sourceLabel', { src: t('dash.source.' + (this.dataSource || 'live')) })
            + (stale ? ` — ${t('dash.staleHint')}` : '');
    }

    /** Record where the current game data came from and when it was produced. */
    setDataProvenance(source, generatedAt) {
        this.dataSource = source;
        // null/undefined must stay null: `new Date(null)` is a valid Date at
        // epoch zero, so an isNaN check alone lets 1969 through.
        const d = generatedAt == null ? null
            : (generatedAt instanceof Date ? generatedAt : new Date(generatedAt));
        this.dataGeneratedAt = (d && !isNaN(d.getTime())) ? d : null;
        this.updateLastRefreshTime();
    }

    flashUpdate() {
        // Add flash animation to top picks
        document.querySelectorAll('.top-pick-card, .stat-card').forEach(el => {
            el.classList.add('update-flash');
            setTimeout(() => el.classList.remove('update-flash'), 1000);
        });
    }

    // ========================================
    // TOP 5 PICKS CALCULATIONS
    // ========================================
    updateTopPicks() {
        this.renderTopJackpotChance();
        this.renderTopOverallOdds();
        this.renderTopBudgetValue();
    }

    // Only recommend games that are fully on sale. Games in the closing
    // pipeline ('closing'/'pulled') are being removed from store shelves and
    // may be impossible to find — they stay in the grid with a warning badge
    // but never appear in Top Picks. Games with no salesStatus (static
    // offline fallback) pass, so the app still renders picks with no network.
    isFullyOnSale(game) {
        return !game.salesStatus || game.salesStatus === 'active';
    }

    // Top 5 by Jackpot Size + Adjusted Chance
    calculateJackpotChanceScore(gameData) {
        if (!gameData.hasRealOdds) return 0;
        const remainingRatio = gameData.topPrizesRemaining / gameData.topPrizesTotal;
        if (remainingRatio === 0) return 0;
        const adjustedOdds = gameData.overallOdds / remainingRatio;
        return (gameData.topPrize * remainingRatio) / adjustedOdds;
    }

    renderTopJackpotChance() {
        // Get valid games only (filters out games without proper data)
        const validGames = this.getValidGames();

        const scored = validGames
            .filter(g => g.topPrizesRemaining > 0 && this.isFullyOnSale(g))
            .map(g => ({
                ...g,
                score: this.calculateJackpotChanceScore(g)
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);

        const container = document.getElementById('topJackpotChance');
        container.innerHTML = scored.map((game, i) => `
            <div class="top-pick-item" onclick="app.showGameDetail(${game.id})">
                <div class="top-pick-rank">${i + 1}</div>
                <div class="top-pick-info">
                    <div class="top-pick-name">${game.name}</div>
                    <div class="top-pick-details">
                        <span>${this.formatCurrency(game.topPrize)}</span>
                        <span>|</span>
                        <span>${t('picks.leftFrac', { r: game.topPrizesRemaining, t: game.topPrizesTotal })}</span>
                    </div>
                </div>
                <div class="top-pick-price">$${game.price}</div>
            </div>
        `).join('');
    }

    // Top 5 by Overall Winning Odds (adjusted for remaining prizes)
    renderTopOverallOdds() {
        // Get valid games only — must have real odds
        const validGames = this.getValidGames();

        const sorted = validGames
            .filter(g => g.topPrizesRemaining > 0 && g.hasRealOdds && this.isFullyOnSale(g))
            .sort((a, b) => a.overallOdds - b.overallOdds)
            .slice(0, 5);

        const container = document.getElementById('topOverallOdds');
        container.innerHTML = sorted.map((game, i) => `
            <div class="top-pick-item" onclick="app.showGameDetail(${game.id})">
                <div class="top-pick-rank">${i + 1}</div>
                <div class="top-pick-info">
                    <div class="top-pick-name">${game.name}</div>
                    <div class="top-pick-details">
                        <span>${t('picks.odds', { o: game.overallOdds.toFixed(2) })}</span>
                        <span>|</span>
                        <span>${this.formatCurrency(game.topPrize)}</span>
                    </div>
                </div>
                <div class="top-pick-price">$${game.price}</div>
            </div>
        `).join('');
    }

    // Top 5 by Budget Value (best return per dollar)
    calculateBudgetValueScore(gameData) {
        if (!gameData.hasRealOdds) return 0;
        const remainingRatio = gameData.topPrizesRemaining / gameData.topPrizesTotal;
        if (remainingRatio === 0) return 0;

        // Expected value considering adjusted odds
        const adjustedOdds = gameData.overallOdds / remainingRatio;
        const expectedReturn = gameData.topPrize / adjustedOdds;

        return expectedReturn / gameData.price;
    }

    renderTopBudgetValue() {
        // Get valid games only — must have real odds
        const validGames = this.getValidGames();

        const scored = validGames
            .filter(g => g.topPrizesRemaining > 0 && g.hasRealOdds && this.isFullyOnSale(g))
            .map(g => ({
                ...g,
                score: this.calculateBudgetValueScore(g)
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);

        const container = document.getElementById('topBudgetValue');
        container.innerHTML = scored.map((game, i) => {
            const remainingPct = Math.round((game.topPrizesRemaining / game.topPrizesTotal) * 100);
            return `
                <div class="top-pick-item" onclick="app.showGameDetail(${game.id})">
                    <div class="top-pick-rank">${i + 1}</div>
                    <div class="top-pick-info">
                        <div class="top-pick-name">${game.name}</div>
                        <div class="top-pick-details">
                            <span>${t('picks.prizesLeftPct', { p: remainingPct })}</span>
                            <span>|</span>
                            <span>${game.hasRealOdds ? '1:' + game.overallOdds.toFixed(2) : 'N/A'}</span>
                        </div>
                    </div>
                    <div class="top-pick-price">$${game.price}</div>
                </div>
            `;
        }).join('');
    }

    // ========================================
    // DASHBOARD STATISTICS
    // ========================================
    updateDashboard() {
        // Get only valid games with proper data
        const validGames = this.getValidGames();

        if (validGames.length === 0) {
            console.error('[Dashboard] No valid games found!');
            return;
        }

        const totalGames = validGames.length;
        const totalJackpots = validGames.reduce((sum, g) => sum + (g.topPrize * g.topPrizesRemaining), 0);
        const gamesWithOdds = validGames.filter(g => g.hasRealOdds);
        const bestOddsGame = gamesWithOdds.length > 0 ? gamesWithOdds.reduce((best, g) => g.overallOdds < best.overallOdds ? g : best) : null;
        const jackpotsClaimed = validGames.reduce((sum, g) => sum + (g.topPrizesTotal - g.topPrizesRemaining), 0);

        document.getElementById('totalGames').textContent = totalGames;
        document.getElementById('totalJackpots').textContent = this.formatCurrency(totalJackpots);
        document.getElementById('bestOdds').textContent = bestOddsGame ? `1 in ${bestOddsGame.overallOdds.toFixed(2)}` : 'N/A';
        document.getElementById('jackpotsClaimed').textContent = jackpotsClaimed;

        // Best value calculation
        const bestValue = this.calculateBestValue();
        document.getElementById('bestValue').textContent = bestValue ? bestValue.name : 'N/A';

        // Highest jackpot
        const highestJackpot = Math.max(...validGames.map(g => g.topPrize));
        document.getElementById('highestJackpot').textContent = this.formatCurrency(highestJackpot);
    }

    calculateBestValue() {
        // Get only valid games
        const validGames = this.getValidGames();

        // Value score = (top prize * remaining percentage) / (price * odds)
        const scored = validGames
            .filter(g => g.topPrizesRemaining > 0 && g.hasRealOdds)
            .map(g => {
                const remainingPct = g.topPrizesRemaining / g.topPrizesTotal;
                const valueScore = (g.topPrize * remainingPct) / (g.price * g.overallOdds);
                return { ...g, valueScore };
            });
        scored.sort((a, b) => b.valueScore - a.valueScore);
        return scored[0];
    }

    generateInsights() {
        // Get only valid games with proper data
        const validGames = this.getValidGames();

        const insights = [];

        // Find games with all jackpots remaining
        const allJackpotsLeft = validGames.filter(g => g.topPrizesRemaining === g.topPrizesTotal);
        if (allJackpotsLeft.length > 0) {
            insights.push({
                type: 'tip',
                icon: 'fa-gem',
                text: t('insights.allLeft', { n: allJackpotsLeft.length, names: allJackpotsLeft.slice(0, 2).map(g => g.name).join(', ') }),
                gameIds: allJackpotsLeft.map(g => g.id),
                filterLabel: t('insights.allLeftLabel', { n: allJackpotsLeft.length })
            });
        }

        // Games with low jackpots remaining (< 25%)
        const lowJackpots = validGames.filter(g => (g.topPrizesRemaining / g.topPrizesTotal) < 0.25 && g.topPrizesRemaining > 0);
        if (lowJackpots.length > 0) {
            insights.push({
                type: 'warning',
                icon: 'fa-exclamation-triangle',
                text: t('insights.low', { n: lowJackpots.length, names: lowJackpots.slice(0, 2).map(g => g.name).join(', ') }),
                gameIds: lowJackpots.map(g => g.id),
                filterLabel: t('insights.lowLabel', { n: lowJackpots.length })
            });
        }

        // Best odds by price point
        const pricePoints = [1, 2, 3, 5, 10, 20, 30, 50, 100];
        pricePoints.forEach(price => {
            const gamesAtPrice = validGames.filter(g => g.price === price && g.topPrizesRemaining > 0 && g.hasRealOdds);
            if (gamesAtPrice.length > 0) {
                const sorted = [...gamesAtPrice].sort((a, b) => a.overallOdds - b.overallOdds);
                const best = sorted[0];
                insights.push({
                    type: 'hot',
                    icon: 'fa-fire',
                    text: t('insights.bestAtPrice', { price: price, name: best.name, odds: best.overallOdds.toFixed(2) }),
                    gameIds: sorted.map(g => g.id),
                    filterLabel: t('insights.bestAtPriceLabel', { n: gamesAtPrice.length, price: price })
                });
            }
        });

        // Highest expected value
        const highEV = this.calculateBestValue();
        if (highEV) {
            // Get top 10 by value
            const topValue = validGames
                .filter(g => g.topPrizesRemaining > 0 && g.hasRealOdds)
                .map(g => ({ ...g, vs: this.calculateValueScore(g) }))
                .sort((a, b) => b.vs - a.vs)
                .slice(0, 10);
            insights.push({
                type: 'tip',
                icon: 'fa-chart-line',
                text: t('insights.highestValue', { name: highEV.name, price: highEV.price }),
                gameIds: topValue.map(g => g.id),
                filterLabel: t('insights.highestValueLabel')
            });
        }

        // Store insights for click handling
        this.currentInsights = insights;

        const grid = document.getElementById('insightsGrid');
        grid.innerHTML = insights.map((insight, index) => `
            <div class="insight-item ${insight.type} clickable${this.activeInsightIndex === index ? ' active-filter' : ''}" data-insight-index="${index}" title="${t('insights.clickToFilter')}">
                <i class="insight-icon fas ${insight.icon}"></i>
                <span class="insight-text">${insight.text}</span>
            </div>
        `).join('');

        // Add click handlers
        grid.querySelectorAll('.insight-item.clickable').forEach(item => {
            item.addEventListener('click', () => {
                const idx = parseInt(item.dataset.insightIndex);
                this.filterByInsight(idx);
            });
        });
    }

    filterByInsight(index) {
        const insight = this.currentInsights[index];
        if (!insight) return;

        // Toggle off if same insight clicked again
        if (this.activeInsightIndex === index) {
            this.clearInsightFilter();
            return;
        }

        this.activeInsightIndex = index;
        this.insightFilterGameIds = insight.gameIds;

        // Filter games to only those in the insight
        const validGames = this.getValidGames();
        this.filteredGames = validGames.filter(g => insight.gameIds.includes(g.id));

        // Show banner
        const banner = document.getElementById('insightFilterBanner');
        banner.style.display = 'flex';
        document.getElementById('insightFilterText').textContent = t('insights.filterPrefix', { label: insight.filterLabel });

        // Update active state on insight items
        document.querySelectorAll('.insight-item.clickable').forEach(item => {
            item.classList.remove('active-filter');
        });
        const activeItem = document.querySelector(`.insight-item[data-insight-index="${index}"]`);
        if (activeItem) activeItem.classList.add('active-filter');

        this.renderGames();

        // Scroll to games section
        document.querySelector('.games-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    clearInsightFilter() {
        this.activeInsightIndex = null;
        this.insightFilterGameIds = null;

        // Hide banner
        document.getElementById('insightFilterBanner').style.display = 'none';

        // Remove active state from insight items
        document.querySelectorAll('.insight-item.clickable').forEach(item => {
            item.classList.remove('active-filter');
        });

        // Re-apply normal filters
        this.applyFilters();
    }

    // ========================================
    // FILTERING & SORTING
    // ========================================
    applyFilters() {
        const price = document.getElementById('priceFilter').value;
        const sortBy = document.getElementById('sortBy').value;
        const jackpotFilter = document.getElementById('jackpotFilter').value;
        const typeFilter = document.getElementById('typeFilter').value;

        // Near Me mode: if enabled but no retailers in range, show no games
        if (this.nearMeEnabled && this.nearMeLocation && this.nearMeRetailers.length === 0) {
            this.filteredGames = [];
            this.renderGames();
            return;
        }

        // Get valid games with enriched data
        const validGames = this.getValidGames();

        this.filteredGames = validGames.filter(game => {
            // Price filter
            if (price !== 'all' && game.price !== parseInt(price)) return false;

            // Jackpot filter
            if (jackpotFilter === 'available' && game.topPrizesRemaining === 0) return false;
            if (jackpotFilter === 'mostLeft' && (game.topPrizesRemaining / game.topPrizesTotal) < 0.5) return false;
            if (jackpotFilter === 'allLeft' && game.topPrizesRemaining !== game.topPrizesTotal) return false;

            // Type filter
            if (typeFilter !== 'all' && game.type !== typeFilter) return false;

            return true;
        });

        // Sorting (using enriched data which already has correct values)
        // Games without real odds sort to the end for odds-based sorts
        this.filteredGames.sort((a, b) => {
            switch (sortBy) {
                case 'adjustedOdds': {
                    const oddsA = this.calculateAdjustedOddsWithValues(a.overallOdds, a.topPrizesRemaining, a.topPrizesTotal);
                    const oddsB = this.calculateAdjustedOddsWithValues(b.overallOdds, b.topPrizesRemaining, b.topPrizesTotal);
                    if (oddsA == null && oddsB == null) return 0;
                    if (oddsA == null) return 1;
                    if (oddsB == null) return -1;
                    return oddsA - oddsB;
                }
                case 'overallOdds': {
                    const oA = a.hasRealOdds ? a.overallOdds : Infinity;
                    const oB = b.hasRealOdds ? b.overallOdds : Infinity;
                    return oA - oB;
                }
                case 'jackpot':
                    return b.topPrize - a.topPrize;
                case 'price':
                    return a.price - b.price;
                case 'priceDesc':
                    return b.price - a.price;
                case 'remaining':
                    return (b.topPrizesRemaining / b.topPrizesTotal) - (a.topPrizesRemaining / a.topPrizesTotal);
                case 'value': {
                    const scoreA = this.calculateValueScore(a);
                    const scoreB = this.calculateValueScore(b);
                    return scoreB - scoreA;
                }
                default:
                    return 0;
            }
        });

        this.renderGames();
    }

    resetFilters() {
        document.getElementById('priceFilter').value = 'all';
        document.getElementById('sortBy').value = 'adjustedOdds';
        document.getElementById('jackpotFilter').value = 'all';
        document.getElementById('typeFilter').value = 'all';
        this.filteredGames = this.getValidGames();
        this.applyFilters();
    }

    // Adjusted Odds Calculation
    calculateAdjustedOdds(game) {
        // Adjusted odds based on remaining top prizes
        // If 50% of prizes claimed, odds effectively double for top prize
        const remainingRatio = game.topPrizesRemaining / game.topPrizesTotal;
        if (remainingRatio === 0) return Infinity;
        return game.overallOdds / remainingRatio;
    }

    calculateAdjustedOddsWithValues(overallOdds, remaining, total) {
        if (!overallOdds || overallOdds <= 0) return null;
        const remainingRatio = remaining / total;
        if (remainingRatio === 0) return Infinity;
        return overallOdds / remainingRatio;
    }

    calculateValueScore(game) {
        if (!game.overallOdds || game.overallOdds <= 0) return 0;
        const remainingPct = game.topPrizesRemaining / game.topPrizesTotal;
        if (remainingPct === 0) return 0;
        return (game.topPrize * remainingPct) / (game.price * game.overallOdds);
    }

    getValueRating(game) {
        const score = this.calculateValueScore(game);
        if (score > 5000) return { class: 'excellent', label: t('value.excellent') };
        if (score > 2000) return { class: 'good', label: t('value.good') };
        if (score > 500) return { class: 'fair', label: t('value.fair') };
        return { class: 'poor', label: t('value.poor') };
    }

    // ========================================
    // RENDER GAMES
    // ========================================
    renderGames() {
        const grid = document.getElementById('gamesGrid');
        const validGamesCount = this.getValidGames().length;
        document.getElementById('gamesShown').textContent = this.filteredGames.length;
        document.getElementById('gamesTotal').textContent = validGamesCount;

        // Update near-me badge in games header
        const nearMeBadge = document.getElementById('nearMeActiveBadge');
        if (this.nearMeEnabled && this.nearMeRetailers.length > 0) {
            nearMeBadge.style.display = 'flex';
            document.getElementById('nearMeBadgeText').textContent =
                t('nearme.storesWithin', { n: this.nearMeRetailers.length, r: this.nearMeRadius });
        } else {
            nearMeBadge.style.display = 'none';
        }

        // Near Me mode: if enabled but no retailers, show specific message
        if (this.nearMeEnabled && this.nearMeRetailers.length === 0 && this.nearMeLocation) {
            grid.innerHTML = `
                <div class="no-results" style="grid-column: 1/-1;">
                    <i class="fas fa-map-marker-alt" style="font-size: 48px; color: var(--warning); margin-bottom: 12px;"></i>
                    <p style="font-size: 16px; font-weight: 600;">${t('nearme.noRetailersInRadius', { r: this.nearMeRadius })}</p>
                    <p style="color: var(--text-muted); margin-top: 8px;">${t('nearme.increaseRadius')}</p>
                </div>
            `;
            return;
        }

        if (this.filteredGames.length === 0) {
            grid.innerHTML = `
                <div class="no-results">
                    <i class="fas fa-search"></i>
                    <p>${t('games.noMatch')}</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = this.filteredGames.map(game => this.renderGameCard(game)).join('');

        // Add click handlers
        document.querySelectorAll('.game-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (!e.target.closest('button')) {
                    this.showGameDetail(parseInt(card.dataset.gameId));
                }
            });
        });

        document.querySelectorAll('.btn-find-retailer').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showRetailerModal(parseInt(btn.dataset.gameId));
            });
        });
    }

    renderGameCard(game) {
        // game is already enriched data from filteredGames
        const remainingPct = (game.topPrizesRemaining / game.topPrizesTotal) * 100;
        const adjustedOdds = this.calculateAdjustedOddsWithValues(game.overallOdds, game.topPrizesRemaining, game.topPrizesTotal);
        const claimed = game.topPrizesTotal - game.topPrizesRemaining;

        // Calculate value rating
        const valueScore = game.hasRealOdds ? (game.topPrize * (game.topPrizesRemaining / game.topPrizesTotal)) / (game.price * game.overallOdds) : null;
        let valueRating;
        if (valueScore == null) valueRating = { class: '', label: 'N/A' };
        else if (valueScore > 5000) valueRating = { class: 'excellent', label: t('value.excellent') };
        else if (valueScore > 2000) valueRating = { class: 'good', label: t('value.good') };
        else if (valueScore > 500) valueRating = { class: 'fair', label: t('value.fair') };
        else valueRating = { class: 'poor', label: t('value.poor') };

        let badge = '';
        let cardClass = '';

        if (game.topPrizesRemaining === game.topPrizesTotal) {
            badge = `<span class="game-badge badge-best">${t('card.allPrizesLeft')}</span>`;
        } else if (remainingPct < 25) {
            badge = `<span class="game-badge badge-limited">${t('card.limited')}</span>`;
            cardClass = 'jackpot-danger';
        } else if (remainingPct < 50) {
            cardClass = 'jackpot-warning';
        }

        if (game.topPrizesRemaining === 0) {
            badge = `<span class="game-badge badge-limited">${t('card.noJackpots')}</span>`;
            cardClass = 'jackpot-danger';
        }

        // Availability trumps prize-based badges: a game being removed from
        // stores is more important to know than how many prizes are left.
        if (game.salesStatus === 'pulled') {
            badge = `<span class="game-badge badge-limited">${t('card.pulled')}</span>`;
            cardClass = 'jackpot-danger';
        } else if (game.salesStatus === 'closing') {
            badge = `<span class="game-badge badge-limited">${t('card.closing', { d: this.formatShortDate(game.endDate) })}</span>`;
            if (!cardClass) cardClass = 'jackpot-warning';
        }

        let progressClass = 'good';
        if (remainingPct < 25) progressClass = 'low';
        else if (remainingPct < 50) progressClass = 'medium';

        return `
            <div class="game-card ${cardClass}" data-game-id="${game.id}">
                ${badge}
                <div class="game-header">
                    <div class="game-price">$${game.price}</div>
                    <span class="game-number">#${game.id}</span>
                </div>
                <h3 class="game-name">${game.name}</h3>

                <div class="game-stats">
                    <div class="game-stat">
                        <span class="game-stat-label">${t('card.topPrize')}</span>
                        <span class="game-stat-value jackpot">${this.formatCurrency(game.topPrize)}</span>
                    </div>
                    <div class="game-stat">
                        <span class="game-stat-label">${t('card.overallOdds')}</span>
                        <span class="game-stat-value odds">${game.hasRealOdds ? '1:' + game.overallOdds.toFixed(2) : 'N/A'}</span>
                    </div>
                </div>

                <div class="jackpot-progress">
                    <div class="jackpot-label">
                        <span>${t('card.topPrizesRemaining')}</span>
                        <span>${t('card.ofWon', { r: game.topPrizesRemaining, t: game.topPrizesTotal, c: claimed })}</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill ${progressClass}" style="width: ${remainingPct}%"></div>
                    </div>
                </div>

                <div class="adjusted-odds">
                    <div class="adjusted-odds-label">${t('card.adjustedOdds')}</div>
                    <div class="adjusted-odds-value">${adjustedOdds == null ? 'N/A' : adjustedOdds === Infinity ? '---' : '1:' + adjustedOdds.toFixed(2)}</div>
                    <div class="adjusted-odds-note">${t('card.basedOn', { r: game.topPrizesRemaining })}</div>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <span class="value-score ${valueRating.class}">
                        <i class="fas fa-star"></i> ${t('value.withSuffix', { label: valueRating.label })}
                    </span>
                    <span style="font-size: 12px; color: var(--text-muted);">${t('type.' + (game.type || 'standard'))}</span>
                </div>

                ${this.nearMeEnabled && this.nearMeRetailers.length > 0 ? `
                <div class="near-me-badge">
                    <i class="fas fa-map-marker-alt"></i>
                    ${t(this.nearMeRetailers.length === 1 ? 'card.availableOne' : 'card.availableMany', { n: this.nearMeRetailers.length, r: this.nearMeRadius })}
                    ${this.nearMeRetailers[0] ? ` &middot; ${t('card.nearest', { name: this.nearMeRetailers[0].name, dist: this.nearMeRetailers[0].distance })}` : ''}
                    &middot; ${t('card.checkStock')}
                </div>
                ` : ''}

                <div class="game-actions">
                    <button class="btn-secondary btn-find-retailer" data-game-id="${game.id}">
                        <i class="fas fa-map-marker-alt"></i> ${t('card.findNearby')}
                    </button>
                </div>
            </div>
        `;
    }

    // Get enriched game data - prefer API data, fall back to static
    getEnrichedGameData(game) {
        const gameId = game.id;

        // Get static game data for supplementary info
        const staticGame = TEXAS_SCRATCH_OFFS.find(g => g.id === gameId);

        // Start with the game data we have (from API or static)
        let result = {
            id: gameId,
            name: game.name || (staticGame && staticGame.name) || `Game ${gameId}`,
            price: game.price || (staticGame && staticGame.price) || 5,
            topPrize: game.topPrize || (staticGame && staticGame.topPrize) || 0,
            overallOdds: game.overallOdds || (staticGame && staticGame.overallOdds) || null,
            topPrizesTotal: game.topPrizesTotal || (staticGame && staticGame.topPrizesTotal) || 0,
            topPrizesRemaining: game.topPrizesRemaining != null ? game.topPrizesRemaining : (staticGame && staticGame.topPrizesRemaining != null ? staticGame.topPrizesRemaining : 0),
            prizes: game.prizes || [],
            type: game.type || (staticGame && staticGame.type) || 'standard',
            // Availability only comes from live data; static fallback games
            // have no salesStatus (isFullyOnSale treats that as unknown-OK).
            salesStatus: game.salesStatus || null,
            closeDate: game.closeDate || null,
            callDate: game.callDate || null,
            endDate: game.endDate || null
        };

        // PRIZE_BREAKDOWNS contributes the *immutable* facts about a game's
        // jackpot (the actual top-prize amount + how many were ever printed).
        // Don't let it override topPrizesRemaining — that's live data from the
        // CSV scrape. The hand-curated remaining count in PRIZE_BREAKDOWNS is
        // a snapshot from when data.js was last edited and goes stale fast.
        const prizeBreakdown = PRIZE_BREAKDOWNS[gameId];
        if (prizeBreakdown && prizeBreakdown.length > 0) {
            const highestPrize = prizeBreakdown.reduce((max, p) => p.prize > max.prize ? p : max, prizeBreakdown[0]);
            if (!result.topPrize || result.topPrize <= 0) result.topPrize = highestPrize.prize;
            if (!result.topPrizesTotal || result.topPrizesTotal <= 0) result.topPrizesTotal = highestPrize.total;
            // topPrizesRemaining intentionally left untouched — live wins.
        }

        // Validate - must have minimum usable data
        if (!result.topPrize || result.topPrize <= 0) return null;
        if (!result.topPrizesTotal || result.topPrizesTotal <= 0) return null;

        // Mark whether odds are real or missing
        result.hasRealOdds = result.overallOdds != null && result.overallOdds > 0;

        return result;
    }

    // Filter games to only include those with valid data
    getValidGames() {
        return this.games
            .map(g => this.getEnrichedGameData(g))
            .filter(g => g !== null); // Remove games without static data
    }

    // ========================================
    // GAME DETAIL MODAL
    // ========================================
    showGameDetail(gameId) {
        // Get enriched game data (uses static data as source of truth)
        const rawGame = this.games.find(g => g.id === gameId);
        const game = this.getEnrichedGameData(rawGame || { id: gameId });

        // If no valid data, show error
        if (!game) {
            this.showNotification(t('app.gameDataUnavailable'), 'error');
            return;
        }

        this.selectedGame = game;

        // Get prize breakdown.
        //
        // Prefer the hand-curated PRIZE_BREAKDOWNS (authoritative per-prize odds
        // from the Texas Lottery prospectus) when available. Otherwise derive
        // odds from CSV data:
        //
        //   total_tickets ≈ overallOdds × Σ prize_total   (winning tickets × overall)
        //   per_prize_odds = total_tickets / prize_total
        //
        // This produces accurate per-prize odds for any live game whose overall
        // odds are known (i.e. games we have in data.js). For games with no
        // known overallOdds we show "—" rather than a fabricated number.
        let prizeBreakdown = PRIZE_BREAKDOWNS[gameId];
        if (!prizeBreakdown && game.prizes && game.prizes.length > 0) {
            const totalWinning = game.prizes.reduce((sum, p) => sum + (p.total || 0), 0);
            const totalTickets = (game.overallOdds && totalWinning > 0)
                ? game.overallOdds * totalWinning
                : null;

            const formatOdds = (perPrizeTotal) => {
                if (!totalTickets || !perPrizeTotal) return '—';
                const odds = totalTickets / perPrizeTotal;
                if (!isFinite(odds) || odds <= 0) return '—';
                return t('modal.oneIn', { o: Math.round(odds).toLocaleString() });
            };

            prizeBreakdown = game.prizes.map(p => ({
                prize: p.amount,
                total: p.total,
                remaining: p.remaining,
                odds: formatOdds(p.total)
            }));
        }

        const remainingPct = (game.topPrizesRemaining / game.topPrizesTotal) * 100;
        const adjustedOdds = this.calculateAdjustedOddsWithValues(game.overallOdds, game.topPrizesRemaining, game.topPrizesTotal);
        const claimed = game.topPrizesTotal - game.topPrizesRemaining;

        // Calculate value rating
        const valueScore = game.hasRealOdds ? (game.topPrize * (game.topPrizesRemaining / game.topPrizesTotal)) / (game.price * game.overallOdds) : null;
        let valueRating;
        if (valueScore == null) valueRating = { class: '', label: 'N/A' };
        else if (valueScore > 5000) valueRating = { class: 'excellent', label: t('value.excellent') };
        else if (valueScore > 2000) valueRating = { class: 'good', label: t('value.good') };
        else if (valueScore > 500) valueRating = { class: 'fair', label: t('value.fair') };
        else valueRating = { class: 'poor', label: t('value.poor') };

        document.getElementById('modalContent').innerHTML = `
            <div class="game-detail">
                <div class="game-detail-header">
                    <div class="game-detail-price">
                        $${game.price}
                        <span>${t('modal.perTicket')}</span>
                    </div>
                    <div class="game-detail-info">
                        <h2>${game.name}</h2>
                        <div class="game-number">${t('modal.gameNumber', { id: game.id, type: t('type.' + (game.type || 'standard')) })}</div>
                        <div class="game-detail-jackpot">${t('modal.topPrizeSuffix', { amount: this.formatCurrency(game.topPrize) })}</div>
                    </div>
                </div>

                ${game.salesStatus === 'pulled' || game.salesStatus === 'closing' ? `
                <div style="margin-bottom: 16px; padding: 12px; background: rgba(217, 119, 6, 0.2); border-radius: 8px; border: 1px solid var(--warning);">
                    <i class="fas fa-exclamation-triangle" style="color: var(--warning);"></i>
                    <span style="font-size: 13px; color: var(--text-secondary);">
                        ${t(game.salesStatus === 'pulled' ? 'modal.pulledWarning' : 'modal.closingWarning', { d: this.formatShortDate(game.endDate) })}
                    </span>
                </div>
                ` : ''}

                <div class="detail-section">
                    <h3><i class="fas fa-chart-bar"></i> ${t('modal.keyStats')}</h3>
                    <div class="detail-stats-grid">
                        <div class="detail-stat">
                            <div class="detail-stat-label">${t('card.overallOdds')}</div>
                            <div class="detail-stat-value">${game.hasRealOdds ? t('modal.oneIn', { o: game.overallOdds.toFixed(2) }) : 'N/A'}</div>
                        </div>
                        <div class="detail-stat">
                            <div class="detail-stat-label">${t('card.adjustedOdds')}</div>
                            <div class="detail-stat-value" style="color: var(--purple)">${adjustedOdds == null ? 'N/A' : adjustedOdds === Infinity ? '---' : t('modal.oneIn', { o: adjustedOdds.toFixed(2) })}</div>
                        </div>
                        <div class="detail-stat">
                            <div class="detail-stat-label">${t('card.topPrizesRemaining')}</div>
                            <div class="detail-stat-value">${t('modal.xOfY', { r: game.topPrizesRemaining, t: game.topPrizesTotal })}</div>
                        </div>
                        <div class="detail-stat">
                            <div class="detail-stat-label">${t('modal.topPrizesClaimed')}</div>
                            <div class="detail-stat-value" style="color: var(--warning)">${t('modal.won', { c: claimed })}</div>
                        </div>
                    </div>
                </div>

                <div class="detail-section">
                    <h3><i class="fas fa-trophy"></i> ${t('modal.jackpotStatus')}</h3>
                    <div class="jackpot-progress" style="margin: 0;">
                        <div class="jackpot-label">
                            <span>${t('modal.pctRemaining', { p: remainingPct.toFixed(0) })}</span>
                            <span class="value-score ${valueRating.class}"><i class="fas fa-star"></i> ${valueRating.label}</span>
                        </div>
                        <div class="progress-bar" style="height: 12px;">
                            <div class="progress-fill ${remainingPct < 25 ? 'low' : remainingPct < 50 ? 'medium' : 'good'}" style="width: ${remainingPct}%"></div>
                        </div>
                    </div>
                    ${remainingPct < 50 ? `
                        <div style="margin-top: 12px; padding: 12px; background: rgba(217, 119, 6, 0.2); border-radius: 8px; border: 1px solid var(--warning);">
                            <i class="fas fa-exclamation-triangle" style="color: var(--warning);"></i>
                            <span style="font-size: 13px; color: var(--text-secondary);">
                                ${t('modal.warning', { c: claimed, t: game.topPrizesTotal })}
                            </span>
                        </div>
                    ` : ''}
                </div>

                ${prizeBreakdown ? `
                <div class="detail-section">
                    <h3><i class="fas fa-list-ol"></i> ${t('modal.prizeBreakdown')}</h3>
                    <div class="prize-breakdown">
                        <div class="prize-row header">
                            <span>${t('modal.prizeAmount')}</span>
                            <span>${t('modal.remaining')}</span>
                            <span>${t('modal.odds')}</span>
                        </div>
                        ${prizeBreakdown.map(p => `
                            <div class="prize-row">
                                <span class="prize-amount">${this.formatCurrency(p.prize)}</span>
                                <span class="prize-remaining">${t('modal.xOfY', { r: p.remaining, t: p.total })}</span>
                                <span class="prize-odds">${p.odds}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                ` : ''}

                <div class="game-actions" style="margin-top: 24px;">
                    <button class="btn-primary" onclick="app.showRetailerModal(${game.id}); app.closeGameModal();">
                        <i class="fas fa-map-marker-alt"></i> ${t('modal.findWhere')}
                    </button>
                    <a href="https://www.texaslottery.com/export/sites/lottery/Games/Scratch_Offs/details.html_${game.id}.html"
                       target="_blank" class="btn-secondary">
                        <i class="fas fa-external-link-alt"></i> ${t('modal.officialDetails')}
                    </a>
                </div>
            </div>
        `;

        document.getElementById('gameModal').classList.add('active');
    }

    closeGameModal() {
        document.getElementById('gameModal').classList.remove('active');
    }

    // ========================================
    // RETAILER MODAL WITH MAP
    // ========================================
    showRetailerModal(gameId) {
        const game = this.games.find(g => g.id === gameId);
        if (!game) return;

        this.selectedGame = game;

        // Get correct game name from static data if needed
        let gameName = game.name;
        const staticGame = TEXAS_SCRATCH_OFFS.find(g => g.id === gameId);
        if (staticGame && (!gameName || gameName.match(/^\d{2}\/\d{2}\/\d{2}$/))) {
            gameName = staticGame.name;
        }

        document.getElementById('selectedGameName').textContent = gameName;

        // Pre-fill location if set
        if (this.currentLocation) {
            if (/^\d{5}$/.test(this.currentLocation)) {
                document.getElementById('retailerZip').value = this.currentLocation;
            } else {
                document.getElementById('retailerCity').value = this.currentLocation;
            }
        }

        document.getElementById('retailerModal').classList.add('active');

        // Initialize map after modal is visible
        setTimeout(() => {
            this.initRetailerMap();

            // If Near Me mode is active with location & retailers, auto-populate the map
            if (this.nearMeEnabled && this.nearMeLocation && this.nearMeRetailers.length > 0) {
                this.populateRetailerMapFromNearMe();
            } else if (this.currentLocation) {
                // Saved location → kick off the search automatically
                this.searchRetailers();
            }
        }, 100);
    }

    /**
     * Auto-populate the retailer modal map with Near Me retailers already found
     */
    populateRetailerMapFromNearMe() {
        const { lat, lng } = this.nearMeLocation;

        // Clear existing markers
        if (this.retailerMarkers) {
            this.retailerMarkers.forEach(m => m.remove());
        }
        this.retailerMarkers = [];

        // Center map on user location with zoom based on radius
        let zoom = 13;
        if (this.nearMeRadius <= 3) zoom = 14;
        else if (this.nearMeRadius <= 10) zoom = 12;
        else if (this.nearMeRadius <= 25) zoom = 11;
        else zoom = 10;

        this.retailerMap.setView([lat, lng], zoom);

        // Add user location marker
        const userIcon = L.divIcon({
            className: 'custom-div-icon',
            html: '<div style="background: #3b82f6; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });

        const userMarker = L.marker([lat, lng], { icon: userIcon })
            .addTo(this.retailerMap)
            .bindPopup('<b>' + t('retailer.yourLocation') + '</b>');
        this.retailerMarkers.push(userMarker);

        // Add radius circle
        L.circle([lat, lng], {
            radius: this.nearMeRadius * 1609.34,
            color: '#3b82f6',
            fillColor: '#3b82f6',
            fillOpacity: 0.05,
            weight: 1,
            dashArray: '5, 5'
        }).addTo(this.retailerMap);

        // Add retailer markers
        const retailerIcon = L.divIcon({
            className: 'custom-div-icon',
            html: '<div style="background: linear-gradient(135deg, #ca8a04, #a16207); width: 30px; height: 30px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>',
            iconSize: [30, 30],
            iconAnchor: [15, 30]
        });

        this.nearMeRetailers.forEach(retailer => {
            if (retailer.lat && retailer.lng) {
                const cityStateZip = [retailer.city, retailer.state || 'TX', retailer.zip].filter(p => p && p.trim()).join(' ');
                const fullAddress = [retailer.address, retailer.city, 'TX', retailer.zip].filter(p => p && p.trim()).join(', ');

                const marker = L.marker([retailer.lat, retailer.lng], { icon: retailerIcon })
                    .addTo(this.retailerMap)
                    .bindPopup(`
                        <div class="popup-content">
                            <h4>${retailer.name || t('retailer.defaultName')}</h4>
                            ${retailer.address ? `<p>${retailer.address}</p>` : ''}
                            ${cityStateZip ? `<p>${cityStateZip}</p>` : ''}
                            ${retailer.distance ? `<p><strong>${retailer.distance}</strong></p>` : ''}
                            <a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress)}" target="_blank">
                                <i class="fas fa-directions"></i> ${t('retailer.getDirections')}
                            </a>
                        </div>
                    `);
                this.retailerMarkers.push(marker);
            }
        });

        // Update the retailer list panel too
        this.updateRetailerList(this.nearMeRetailers, lat, lng);

        // Hide loading
        document.getElementById('mapLoading').classList.add('hidden');

        this.showNotification(t('retailer.showingWithin', { n: this.nearMeRetailers.length, r: this.nearMeRadius }), 'success');
    }

    closeRetailerModal() {
        document.getElementById('retailerModal').classList.remove('active');
        // Clean up map
        if (this.retailerMap) {
            this.retailerMap.remove();
            this.retailerMap = null;
        }
    }

    initRetailerMap() {
        // Remove existing map if any
        if (this.retailerMap) {
            this.retailerMap.remove();
        }
        // Reset listener flag — a new map needs new listeners
        this._mapAutoSearchAttached = false;

        // Default to Texas center
        const defaultLat = 31.9686;
        const defaultLng = -99.9018;

        this.retailerMap = L.map('retailerMap').setView([defaultLat, defaultLng], 6);

        // Add dark theme tiles
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap, &copy; CARTO',
            maxZoom: 19
        }).addTo(this.retailerMap);

        // Hide loading
        document.getElementById('mapLoading').classList.add('hidden');

        // Add event listeners for location button
        document.getElementById('useMyLocation').onclick = () => this.useMyLocation();
        document.getElementById('searchRetailers').onclick = () => this.searchRetailers();
        this.attachMapAutoSearch();
    }

    /** Read inputs from the retailer modal; alias used by bindEvents and the auto-search path. */
    searchRetailers() {
        return this.searchRetailersByLocation();
    }

    useMyLocation() {
        if (!navigator.geolocation) {
            this.showNotification(t('retailer.geoUnsupported'), 'error');
            return;
        }
        const loading = document.getElementById('mapLoading');
        if (loading) {
            loading.classList.remove('hidden');
            loading.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>' + t('retailer.gettingLocation') + '</span>';
        }
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                this.retailerMap.setView([lat, lng], 13);
                this.runRetailerSearch({ lat, lng });
            },
            (error) => {
                if (loading) loading.classList.add('hidden');
                this.showNotification(t('retailer.geoFailed'), 'error');
                console.error('Geolocation error:', error);
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }

    async searchRetailersByLocation() {
        const zip = document.getElementById('retailerZip').value.trim();
        const city = document.getElementById('retailerCity').value.trim();

        if (!zip && !city) {
            this.showNotification(t('retailer.notifNoZipCity'), 'warning');
            return;
        }

        const loading = document.getElementById('mapLoading');
        if (loading) {
            loading.classList.remove('hidden');
            loading.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>' + t('retailer.locating') + '</span>';
        }

        try {
            // Constrain to the US (and bias ZIPs to Texas) — a bare ZIP like
            // "78701" otherwise matches a higher-importance foreign postcode
            // (e.g. one in Ukraine at 48.18,24.80), sending the map and the
            // distance filter to Europe so every Texas retailer is dropped.
            const query = zip ? `${zip}, TX, USA` : `${city}, Texas, USA`;
            const geoResponse = await fetch(`/proxy/nominatim/search?format=json&q=${encodeURIComponent(query)}&countrycodes=us&limit=1`);
            const geoResults = await geoResponse.json();

            if (geoResults.length === 0) {
                this.showNotification(t('retailer.notFound'), 'error');
                if (loading) loading.classList.add('hidden');
                return;
            }

            const lat = parseFloat(geoResults[0].lat);
            const lng = parseFloat(geoResults[0].lon);

            // City searches are broad (zoom 11), ZIP searches are tighter (zoom 13)
            this.retailerMap.setView([lat, lng], zip ? 13 : 11);
            await this.runRetailerSearch({ lat, lng, zip, city });
        } catch (error) {
            console.error('Search error:', error);
            this.showNotification(t('retailer.searchError', { msg: error.message }), 'error');
            if (loading) loading.classList.add('hidden');
        }
    }

    async showRetailersNearLocation(lat, lng) {
        if (this.retailerMap) this.retailerMap.setView([lat, lng], 13);
        return this.runRetailerSearch({ lat, lng });
    }

    async fetchRealRetailers(lat, lng) {
        // First, reverse geocode to get ZIP code
        const geoResponse = await fetch(
            `/proxy/nominatim/reverse?format=json&lat=${lat}&lon=${lng}`
        );
        const geoData = await geoResponse.json();
        const zip = geoData?.address?.postcode;
        const city = geoData?.address?.city || geoData?.address?.town || geoData?.address?.village;

        console.log(`[Retailers] Looking for retailers near ZIP: ${zip}, City: ${city}`);

        // Client-side retailer scrape (try ZIP, then city, then nearby ZIPs).
        // Each result is tagged carriesGame:true|false for the selected game.
        let data = [];
        try {
            if (zip) data = await this.fetchTaggedRetailers({ zip, limit: 25 });
            else if (city) data = await this.fetchTaggedRetailers({ city, limit: 25 });
        } catch (e) {
            console.error('[Scraper] retailers failed:', e);
        }

        if (data.length === 0 && zip) {
            const baseZip = zip.substring(0, 4);
            for (let i = 0; i <= 9; i++) {
                const tryZip = baseZip + i;
                if (tryZip !== zip) {
                    try {
                        const retry = await this.fetchTaggedRetailers({ zip: tryZip, limit: 25 });
                        if (retry.length > 0) { data = retry; break; }
                    } catch (e) { /* try next */ }
                }
            }
        }

        const result = { success: data.length > 0, data };
        if (!result.success) throw new Error('No retailers found');

        // Geocode retailer addresses to get coordinates
        const retailers = [];
        const geocodePromises = result.data.slice(0, 15).map(async (retailer, index) => {
            // Add delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, index * 250));

            // Skip if no valid address
            if (!retailer.address || !retailer.city) {
                console.log(`[Geocode] Skipping ${retailer.name} - missing address data`);
                return null;
            }

            try {
                // Build address from available parts
                const addressParts = [
                    retailer.address,
                    retailer.city,
                    retailer.state || 'TX',
                    retailer.zip
                ].filter(p => p && p.trim());

                const fullAddress = addressParts.join(', ');
                console.log(`[Geocode] Geocoding: ${fullAddress}`);

                const geocodeResponse = await fetch(
                    `/proxy/nominatim/search?format=json&q=${encodeURIComponent(fullAddress)}&countrycodes=us&limit=1`
                );
                const geocodeData = await geocodeResponse.json();

                if (geocodeData && geocodeData.length > 0) {
                    const rLat = parseFloat(geocodeData[0].lat);
                    const rLng = parseFloat(geocodeData[0].lon);

                    // Calculate distance from user
                    const distance = this.calculateDistance(lat, lng, rLat, rLng);

                    // Only accept results within reasonable distance (50 miles)
                    if (distance > 50) {
                        console.log(`[Geocode] ${retailer.name} too far (${distance.toFixed(1)} mi), skipping`);
                        return null;
                    }

                    return {
                        ...retailer,
                        lat: rLat,
                        lng: rLng,
                        distance: t('retailer.milesAway', { d: distance.toFixed(1) }),
                        distanceNum: distance
                    };
                } else {
                    console.log(`[Geocode] No results for: ${fullAddress}`);
                }
            } catch (err) {
                console.error(`[Geocode] Failed for ${retailer.name}:`, err.message);
            }

            return null;
        });

        const geocodedRetailers = await Promise.all(geocodePromises);

        // Filter out failed geocodes and sort by distance
        return geocodedRetailers
            .filter(r => r !== null)
            .sort((a, b) => a.distanceNum - b.distanceNum);
    }

    calculateDistance(lat1, lng1, lat2, lng2) {
        // Haversine formula for distance in miles
        const R = 3959; // Earth's radius in miles
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    makeRetailerIcon(carriesGame) {
        const color = carriesGame
            ? 'linear-gradient(135deg, #16a34a, #15803d)'   // green — carries the game
            : 'linear-gradient(135deg, #94a3b8, #64748b)';  // muted — general retailer
        const ring = carriesGame ? '3px solid #fef3c7' : '2px solid white';
        return L.divIcon({
            className: 'custom-div-icon',
            html: `<div style="background: ${color}; width: 30px; height: 30px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: ${ring}; box-shadow: 0 2px 5px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;">
                     <i class="fas fa-ticket-alt" style="transform: rotate(45deg); color: white; font-size: 12px;"></i>
                   </div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 30]
        });
    }

    /**
     * Pin for a whole ZIP whose stores have not been individually geocoded yet.
     * Shows the count so it reads as "several stores around here", not as one
     * shop at a precise spot.
     */
    makeZipClusterIcon(count, hasCarriers) {
        const color = hasCarriers
            ? 'linear-gradient(135deg, #16a34a, #15803d)'
            : 'linear-gradient(135deg, #94a3b8, #64748b)';
        const size = count > 9 ? 38 : 32;
        return L.divIcon({
            className: 'custom-div-icon',
            html: `<div style="background: ${color}; width: ${size}px; height: ${size}px; border-radius: 50%;
                        border: 2px dashed #fef3c7; box-shadow: 0 2px 5px rgba(0,0,0,0.35);
                        display: flex; align-items: center; justify-content: center;
                        color: white; font-weight: 700; font-size: ${count > 9 ? 13 : 14}px;">${count}</div>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2]
        });
    }

    makeZipClusterPopup(cluster) {
        const shown = cluster.items.slice(0, 8);
        const rest = cluster.items.length - shown.length;
        const rows = shown.map(r => `<li style="margin: 2px 0;">
                ${r.carriesGame ? '<i class="fas fa-check-circle" style="color:#16a34a"></i> ' : ''}${r.name || ''}
                <span style="color:#64748b">— ${r.address || ''}</span>
            </li>`).join('');
        return `
            <div class="popup-content">
                <h4>${t('retailer.zipClusterTitle', { n: cluster.items.length, zip: cluster.zip || '?' })}</h4>
                <p style="margin: 4px 0 8px; font-size: 12px; color:#475569;">${t('retailer.zipClusterNote')}</p>
                <ul style="margin: 0 0 6px; padding-left: 16px; font-size: 12px;">${rows}</ul>
                ${rest > 0 ? `<p style="font-size:12px; color:#64748b;">${t('retailer.andMore', { n: rest })}</p>` : ''}
            </div>
        `;
    }

    makeRetailerPopup(retailer, cityStateZip) {
        const addressParts = [retailer.address, retailer.city, retailer.state || 'TX', retailer.zip].filter(p => p && p.trim());
        const fullAddress = addressParts.join(', ');
        const dest = (retailer.lat && retailer.lng)
            ? `${retailer.lat},${retailer.lng}`
            : encodeURIComponent(fullAddress);
        const badge = retailer.carriesGame
            ? `<p style="margin: 4px 0 8px; padding: 4px 8px; background:#dcfce7; color:#166534; border-radius: 6px; font-weight: 700; font-size: 12px;"><i class="fas fa-check-circle"></i> ${t('retailer.carries')}</p>`
            : `<p style="margin: 4px 0 8px; padding: 4px 8px; background:#f1f5f9; color:#475569; border-radius: 6px; font-size: 12px;"><i class="fas fa-store"></i> ${t('retailer.generalFull')}</p>`;
        return `
            <div class="popup-content">
                <h4>${retailer.name || t('retailer.defaultName')}</h4>
                ${badge}
                <p>${retailer.address || ''}</p>
                ${cityStateZip ? `<p>${cityStateZip}</p>` : ''}
                ${retailer.distance ? `<p><strong>${retailer.distance}</strong></p>` : ''}
                <a href="https://www.google.com/maps/dir/?api=1&destination=${dest}" target="_blank">
                    <i class="fas fa-directions"></i> ${t('retailer.getDirections')}
                </a>
            </div>
        `;
    }

    /**
     * Fetch retailers and tag each with carriesGame:true|false based on
     * whether the Texas Lottery locator reports them as stocking the
     * currently-selected scratch-off. Called wherever we render retailers
     * in the per-game retailer modal.
     */
    async fetchTaggedRetailers({ zip = '', city = '', limit = 25, carriersOnly = false, gameId = undefined }) {
        // Take the caller's game when given one, so a search can't end up
        // sweeping with no game filter (which tags every store as a carrier)
        // while its caller believes it is filtering.
        if (gameId === undefined) gameId = this.selectedGame ? this.selectedGame.id : null;
        if (!gameId) {
            const all = await window.LotteryScraper.fetchRetailers({ zip, city, limit });
            return all.map(r => ({ ...r, carriesGame: false }));
        }
        if (carriersOnly) {
            const carriers = await window.LotteryScraper
                .fetchRetailers({ zip, city, limit, gameNumber: gameId })
                .catch(() => []);
            return carriers.map(r => ({ ...r, carriesGame: true }));
        }
        const [carriers, all] = await Promise.all([
            window.LotteryScraper.fetchRetailers({ zip, city, limit, gameNumber: gameId })
                .catch(() => []),
            window.LotteryScraper.fetchRetailers({ zip, city, limit })
                .catch(() => [])
        ]);
        const carrierKey = (r) => `${(r.name || '').toLowerCase()}|${(r.address || '').toLowerCase()}`;
        const carrierSet = new Set(carriers.map(carrierKey));

        const merged = [];
        const seen = new Set();
        for (const r of carriers) {
            const k = carrierKey(r);
            if (!seen.has(k)) { seen.add(k); merged.push({ ...r, carriesGame: true }); }
        }
        for (const r of all) {
            const k = carrierKey(r);
            if (seen.has(k)) continue;
            seen.add(k);
            merged.push({ ...r, carriesGame: carrierSet.has(k) });
        }
        return merged;
    }

    /**
     * Neighbouring ZIPs to widen a search into, nearest-first.
     *
     * The locator has no radius search: a ZIP query returns ONLY stores whose
     * registered ZIP matches that string exactly. So "near me" has to be built
     * by querying a ring of neighbouring ZIPs ourselves. ZIP numbers are
     * assigned roughly geographically, so numeric neighbours sharing the same
     * 3-digit prefix (the sectional centre) are genuinely close by; crossing
     * the prefix lands in a different region, so those are dropped. Real
     * distances are still verified by geocoding afterwards.
     */
    nearbyZipCandidates(zip, ringSize = 10) {
        if (!/^\d{5}$/.test(zip)) return [];
        const base = parseInt(zip, 10);
        const prefix = zip.slice(0, 3);
        const out = [];
        for (let d = 1; d <= ringSize; d++) {
            for (const sign of [+1, -1]) {
                const n = base + sign * d;
                if (n < 0 || n > 99999) continue;
                const s = String(n).padStart(5, '0');
                if (s.slice(0, 3) !== prefix) continue;   // different sectional centre — not nearby
                out.push(s);
            }
        }
        return out;
    }

    /**
     * Centroid of a ZIP code, cached for the life of the page.
     * Used to place (and filter) retailers we have not spent an individual
     * geocoding call on — one lookup covers every store in that ZIP.
     */
    async zipCentroid(zip) {
        if (!/^\d{5}$/.test(zip || '')) return null;
        if (!this._zipCentroids) this._zipCentroids = new Map();
        if (this._zipCentroids.has(zip)) return this._zipCentroids.get(zip);

        try {
            const resp = await fetch(`/proxy/nominatim/search?format=json&postalcode=${zip}&country=us&limit=1`);
            // 429/5xx is temporary. Returning without caching matters: caching
            // it would leave the rest of the session with no distances at all
            // because of one throttled burst.
            if (!resp.ok) return null;
            const d = await resp.json();
            const centroid = (Array.isArray(d) && d.length)
                ? { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) }
                : null;
            this._zipCentroids.set(zip, centroid);   // a real answer — cache it
            return centroid;
        } catch {
            return null;   // transient; a later search can retry
        }
    }

    /**
     * Single entry point for retailer search.
     * Performs an expanding search until at least one retailer carrying the
     * selected game is found (or the cap is hit). Renders markers + list and
     * tracks the search center/radius so the zoom-listener can decide whether
     * to re-run on map move.
     */
    async runRetailerSearch({ lat, lng, zip = '', city = '', radiusMiles = null }) {
        const token = ++this._retailerSearchToken;
        const map = this.retailerMap;
        if (!map) return;

        // Set tracking now (before any async work) so map move events fired by
        // a setView() during this run don't trigger a redundant auto-research.
        if (radiusMiles == null) radiusMiles = this.calculateMapRadiusMiles();
        this._lastSearchCenter = { lat, lng };
        this._lastSearchRadius = radiusMiles;

        // 1. Resolve missing zip/city via reverse-geocode (through Netlify
        // same-origin proxy — direct nominatim calls fail on some mobile PWAs)
        if (!zip && !city) {
            try {
                const r = await fetch(`/proxy/nominatim/reverse?format=json&lat=${lat}&lon=${lng}`);
                const d = await r.json();
                zip = d?.address?.postcode || '';
                city = d?.address?.city || d?.address?.town || d?.address?.village || '';
                console.log(`[Retailers] reverse-geocoded → zip="${zip}" city="${city}"`);
            } catch (e) {
                console.warn('[Retailers] reverse-geocode failed:', e.message);
            }
        }

        // 2. Recenter map and reset markers
        this.clearRetailerMarkers();
        const userIcon = L.divIcon({
            className: 'custom-div-icon',
            html: '<div style="background: #3b82f6; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        const userMarker = L.marker([lat, lng], { icon: userIcon })
            .addTo(map)
            .bindPopup(`<b>${t('retailer.searchLocation')}</b><br>${zip || city || t('retailer.mapCenter')}`);
        this.retailerMarkers.push(userMarker);

        // 3. Loading state
        const loading = document.getElementById('mapLoading');
        if (loading) {
            loading.classList.remove('hidden');
            loading.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>' + t('retailer.searchingRetailers') + '</span>';
        }
        document.getElementById('retailerList').innerHTML = `
            <div style="text-align: center; padding: 20px; color: var(--text-muted);">
                <i class="fas fa-spinner fa-spin" style="font-size: 24px;"></i>
                <p style="margin-top: 10px;">${t('retailer.searchingList')}</p>
            </div>
        `;

        // 4. Prefer the published bundle: one static fetch, retailers already
        // geocoded, no load on the state's servers. Falls through to live
        // scraping when it is unavailable or has nothing for this area.
        let raw = [];
        let scrapeError = null;
        let fromBundle = false;
        // Cleared per search: a live-scraped list must not inherit the "data as
        // of" stamp from a previous bundle-backed one.
        this._bundleGeneratedAt = null;

        if (window.RemoteData && window.RemoteData.enabled()) {
            try {
                const bundled = await window.RemoteData.findRetailers({
                    lat, lng, zip,
                    gameId: this.selectedGame?.id || null,
                    radiusMiles: Math.max(radiusMiles * 2, 25),
                    limit: LotChanceApp.MAX_RENDERED_RETAILERS
                });
                if (bundled.length) {
                    raw = bundled.map(r => ({
                        ...r,
                        distance: t('retailer.milesAway', { d: r.distanceNum.toFixed(1) })
                    }));
                    fromBundle = true;
                    // Retailer data has its own refresh cadence (twice daily),
                    // separate from the game/prize feed — so report it here
                    // rather than letting the dashboard date imply it.
                    const m = await window.RemoteData.getManifest();
                    this._bundleGeneratedAt = m && m.generatedAt ? new Date(m.generatedAt) : null;
                }
            } catch (e) {
                console.warn('[Retailers] bundle lookup failed, scraping live:', e.message);
            }
        }

        if (!fromBundle) {
            try {
                raw = await this.expandedRetailerSearch({
                    zip, city, gameId: this.selectedGame?.id, radiusMiles
                });
            } catch (e) {
                console.error('[Retailers] search failed:', e);
                scrapeError = e.message;
            }
        }
        if (token !== this._retailerSearchToken) return;
        console.log(`[Retailers] expandedSearch returned ${raw.length} raw retailers`);

        // 5. Place everything coarsely (one cached lookup per ZIP) and show it
        // straight away, then refine addresses in the background. Exact
        // geocoding has to be slow to stay inside Nominatim's rate limit, and
        // making the whole list wait on it left the map looking empty.
        const searchRadius = Math.max(radiusMiles * 2, 25);
        let coarse = raw;
        // Bundle results are already positioned and measured — running them
        // through the geocoding tiers would only make them worse.
        if (!fromBundle) {
            try {
                coarse = await this.coarseRetailerDistances(raw, lat, lng, searchRadius, zip);
            } catch (e) {
                console.warn('[Retailers] coarse placement failed:', e.message);
            }
        }
        if (token !== this._retailerSearchToken) return;
        console.log(`[Retailers] ${coarse.length}/${raw.length} within ${searchRadius.toFixed(0)} mi`);

        const sorted = this.renderRetailerResults(coarse, lat, lng, token);

        // Bundle data needs no refinement pass — it is already exact.
        if (fromBundle) {
            if (loading) loading.classList.add('hidden');
            this.notifyRetailerResult(sorted, radiusMiles, scrapeError, zip, city);
            return;
        }

        // 6. Background refinement — exact coordinates for the top results.
        // The list is already usable; only map pins are still missing, so say
        // that rather than leaving an apparently-empty map with no explanation.
        if (loading && sorted.length) {
            loading.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>' + t('retailer.placingPins') + '</span>';
        } else if (loading) {
            loading.classList.add('hidden');
        }
        const doneLoading = () => {
            if (loading && token === this._retailerSearchToken) loading.classList.add('hidden');
        };

        this.refineRetailerDistances(sorted, lat, lng, searchRadius, token)
            .then(refined => {
                if (refined && token === this._retailerSearchToken) {
                    this.renderRetailerResults(refined, lat, lng, token);
                }
                doneLoading();
            })
            .catch(e => { console.warn('[Retailers] refinement failed:', e.message); doneLoading(); });

        // 7. Notification
        this.notifyRetailerResult(sorted, radiusMiles, scrapeError, zip, city);
    }

    /** Result toast, shared by the bundle and live-scrape paths. */
    notifyRetailerResult(sorted, radiusMiles, scrapeError, zip, city) {
        const game = this.selectedGame || null;
        const carrierCount = sorted.filter(x => x.carriesGame).length;
        if (sorted.length === 0) {
            this.showNotification(
                scrapeError
                    ? t('retailer.errCouldntLoad', { msg: scrapeError })
                    : t('retailer.errNoneNear', { loc: zip || city || t('retailer.thisLocation') }),
                'error'
            );
        } else if (game && carrierCount > 0) {
            this.showNotification(
                t(carrierCount === 1 ? 'retailer.carriersOne' : 'retailer.carriersMany', { n: carrierCount, game: game.name, r: radiusMiles.toFixed(0) }),
                'success'
            );
        } else if (game) {
            this.showNotification(
                t('retailer.noCarrier', { game: game.name, n: sorted.length }),
                'warning'
            );
        } else {
            this.showNotification(t('retailer.foundN', { n: sorted.length }), 'success');
        }
    }

    /**
     * Sort, cap and draw a retailer list onto the map and the side panel.
     * Safe to call twice for one search (coarse pass, then refined pass).
     * Returns the list actually rendered.
     */
    renderRetailerResults(retailers, lat, lng, token) {
        const byProximity = (a, b) => {
            if (a.distanceNum != null && b.distanceNum != null) return a.distanceNum - b.distanceNum;
            if (a.distanceNum != null) return -1;
            if (b.distanceNum != null) return 1;
            if (a.zipGap != null && b.zipGap != null) return a.zipGap - b.zipGap;
            if (a.zipGap != null) return -1;
            if (b.zipGap != null) return 1;
            return 0;
        };

        // Carriers are the answer to "where can I buy this", so they are ranked
        // and capped separately — a pile of nearby general retailers must never
        // push a real carrier off the end of the list.
        const carriers = retailers.filter(r => r.carriesGame).sort(byProximity);
        const general = retailers.filter(r => !r.carriesGame).sort(byProximity);
        const sorted = carriers.concat(general).slice(0, LotChanceApp.MAX_RENDERED_RETAILERS);

        if (token !== this._retailerSearchToken) return sorted;

        // Drop the previous pass's pins but keep the "you are here" marker,
        // which is always the first one pushed for this search.
        const userMarker = this.retailerMarkers[0] || null;
        this.retailerMarkers.slice(1).forEach(m => m.remove());
        this.retailerMarkers = userMarker ? [userMarker] : [];

        // Stores with a confirmed street position get their own pin. Everything
        // still on a ZIP-centre estimate is collapsed into one pin per ZIP —
        // otherwise the map sits empty until background geocoding finishes, and
        // dropping 30 markers on a single centroid would be worse than useless.
        const clusters = new Map();
        for (const r of sorted) {
            if (r.lat && r.lng) {
                const cityStateZip = [r.city, r.state || 'TX', r.zip].filter(p => p && p.trim()).join(' ');
                const marker = L.marker([r.lat, r.lng], { icon: this.makeRetailerIcon(r.carriesGame) })
                    .addTo(this.retailerMap)
                    .bindPopup(this.makeRetailerPopup(r, cityStateZip));
                this.retailerMarkers.push(marker);
            } else if (r.zipLat && r.zipLng) {
                const k = r.zip || `${r.zipLat},${r.zipLng}`;
                if (!clusters.has(k)) clusters.set(k, { zip: r.zip, lat: r.zipLat, lng: r.zipLng, items: [] });
                clusters.get(k).items.push(r);
            }
        }
        for (const c of clusters.values()) {
            const marker = L.marker([c.lat, c.lng], {
                icon: this.makeZipClusterIcon(c.items.length, c.items.some(r => r.carriesGame))
            })
                .addTo(this.retailerMap)
                .bindPopup(this.makeZipClusterPopup(c));
            this.retailerMarkers.push(marker);
        }
        this.updateRetailerList(sorted, lat, lng, retailers.length);
        return sorted;
    }

    /**
     * Build the candidate pool of retailers around a location.
     *
     * Every locator query is an exact-match lookup — exact ZIP string, or exact
     * registered city — so no single query means "near me". We therefore always
     * sweep the centre ZIP, the reverse-geocoded city, and a ring of
     * neighbouring ZIPs, and let the distance filter decide what is actually in
     * range.
     *
     * The sweep must NOT stop as soon as some carrier turns up. It used to, and
     * that was the bug behind a game being reported at the chain stores in your
     * own ZIP while the store one ZIP over that also had it was never queried —
     * frequently the closer of the two.
     */
    async expandedRetailerSearch({ zip, city, gameId, radiusMiles }) {
        const seen = new Set();
        const merged = [];
        const key = (r) => `${(r.name || '').toLowerCase()}|${(r.address || '').toLowerCase()}`;
        const merge = (list) => {
            for (const r of list || []) {
                const k = key(r);
                if (!seen.has(k)) { seen.add(k); merged.push(r); }
            }
        };

        // Pass A — centre ZIP and city. These are the only queries that also
        // pull in non-carrier stores, so the map still shows general retailers.
        const base = [];
        if (zip) base.push(this.fetchTaggedRetailers({ zip, limit: 50, gameId }).catch(() => []));
        if (city) base.push(this.fetchTaggedRetailers({ city, limit: 100, gameId }).catch(() => []));
        (await Promise.all(base)).forEach(merge);

        // Pass B — neighbouring ZIPs, carriers only (one request each instead of
        // two). This is what turns an exact-ZIP lookup into a real area search.
        if (gameId && zip) {
            const ringSize = Math.min(20, Math.max(4, Math.ceil((radiusMiles || 10) / 1.5)));
            const variants = this.nearbyZipCandidates(zip, ringSize)
                .slice(0, LotChanceApp.MAX_NEIGHBOUR_ZIP_QUERIES);
            for (let i = 0; i < variants.length; i += 4) {
                const lists = await Promise.all(
                    variants.slice(i, i + 4).map(v =>
                        this.fetchTaggedRetailers({ zip: v, limit: 50, carriersOnly: true, gameId }).catch(() => [])
                    )
                );
                lists.forEach(merge);
            }
            console.log(`[Retailers] swept ${variants.length} neighbouring ZIPs around ${zip}`);
        }

        // Pass C — last resort when nothing in the ring stocks the game. The
        // city we searched came from the reverse geocoder, which reports the
        // colloquial name ("The Woodlands"); the locator stores the postal one,
        // and for the same ZIP that is often a different city ("SPRING"). The
        // rows we already have name their own registered cities, so retry with
        // those before reporting that nobody nearby has it.
        if (gameId && !merged.some(r => r.carriesGame)) {
            const searched = new Set([this.normalizeLocatorCity(city)]);
            const nearbyCities = [...new Set(merged.map(r => this.normalizeLocatorCity(r.city)))]
                .filter(c => c && !searched.has(c))
                .slice(0, 3);
            for (const c of nearbyCities) {
                const list = await this.fetchTaggedRetailers({ city: c, limit: 100, carriersOnly: true, gameId })
                    .catch(() => []);
                merge(list);
                if (list.length) console.log(`[Retailers] city fallback "${c}" added ${list.length} carriers`);
            }
        }

        return merged;
    }

    /**
     * Last successful live game list, kept so an offline start shows the most
     * recent real data instead of the build-time data.js snapshot.
     */
    loadCachedGames() {
        try {
            const c = JSON.parse(localStorage.getItem('lotchance.gamesCache'));
            if (c && Array.isArray(c.games) && c.games.length && c.at) return c;
        } catch { /* unreadable — fall back to the bundled snapshot */ }
        return null;
    }

    saveCachedGames(games) {
        try {
            localStorage.setItem('lotchance.gamesCache',
                JSON.stringify({ at: Date.now(), games }));
        } catch { /* quota or private mode — non-fatal */ }
    }

    /** "3 hours ago" / "2 days ago", for telling the user how stale data is. */
    describeAge(ts) {
        const mins = Math.max(1, Math.round((Date.now() - ts) / 60000));
        if (mins < 60) return t('age.minutes', { n: mins });
        const hours = Math.round(mins / 60);
        if (hours < 48) return t('age.hours', { n: hours });
        return t('age.days', { n: Math.round(hours / 24) });
    }

    /**
     * Fill in overall odds for games the feed didn't supply them for — in
     * practice, games launched since data.js was last generated.
     *
     * Reads each game's own detail page, cached permanently client-side (odds
     * never change for a given game). Bounded per load so a feed-wide outage
     * can't turn into 75 page fetches on a phone.
     */
    async backfillOverallOdds() {
        const scraper = window.LotteryScraper;
        if (!scraper || typeof scraper.fetchOverallOdds !== 'function') return;

        const missing = this.games.filter(g => !g.overallOdds && g.detailSlug);
        if (!missing.length) return;

        let filled = 0;
        for (const g of missing.slice(0, LotChanceApp.MAX_ODDS_BACKFILL)) {
            try {
                const odds = await scraper.fetchOverallOdds(g.id, g.detailSlug);
                if (odds) { g.overallOdds = odds; filled++; }
            } catch (e) {
                console.warn(`[App] odds lookup failed for game ${g.id}:`, e.message);
            }
        }
        if (missing.length > LotChanceApp.MAX_ODDS_BACKFILL) {
            console.log(`[App] ${missing.length - LotChanceApp.MAX_ODDS_BACKFILL} game(s) still without odds; will retry next load`);
        }
        if (filled) {
            console.log(`[App] backfilled overall odds for ${filled} game(s)`);
            this.applyFilters();
        }
    }

    /**
     * Fill the city autocomplete from the locator's own city dropdown.
     * Nothing is hardcoded, so a city the lottery adds shows up on its own.
     * Purely an aid — a failure here leaves the field as free text.
     */
    async populateCityList() {
        const list = document.getElementById('txCityList');
        if (!list || !window.LotteryScraper?.fetchCityList) return;
        try {
            const cities = await window.LotteryScraper.fetchCityList();
            // The locator stores cities uppercase; show them title-cased, but
            // the value stays exactly what the locator will match.
            list.innerHTML = cities.map(c =>
                `<option value="${c.replace(/"/g, '&quot;')}">`).join('');
            console.log(`[App] city autocomplete: ${cities.length} entries`);
        } catch (e) {
            console.warn('[App] city list unavailable:', e.message);
        }
    }

    /** Match scraper.js's city normalisation so comparisons line up. */
    normalizeLocatorCity(city) {
        const up = (city || '').toUpperCase().trim();
        return up.replace(/[\s,.]+(TX|TEXAS)[\s.]*$/, '').trim() || up;
    }

    /**
     * Tier 1 — place every retailer by its ZIP centroid and drop what is out
     * of range. One lookup per distinct ZIP (cached for the life of the page),
     * so a pool of 200 stores across 10 ZIPs costs 10 requests instead of 200.
     *
     * Accurate to within a few miles, which is enough to rank the list and to
     * throw out whole ZIPs that turned out to be far away despite being
     * numerically adjacent. Exact positions come later, in tier 2.
     */
    async coarseRetailerDistances(retailers, lat, lng, maxRadius, centreZip = '') {
        const zips = [...new Set(retailers.map(r => (r.zip || '').trim()).filter(z => /^\d{5}$/.test(z)))];
        const centroids = new Map();
        for (let i = 0; i < zips.length; i++) {
            if (i && !this._zipCentroids.has(zips[i])) {
                await new Promise(res => setTimeout(res, 1100));   // Nominatim: 1 req/s
            }
            centroids.set(zips[i], await this.zipCentroid(zips[i]));
        }

        // Ordering fallback for when the geocoder is unavailable: how far the
        // store's ZIP is from the search ZIP numerically. Never shown as a
        // distance — it just keeps the list roughly nearest-first instead of
        // arbitrary, which matters now that a search can return 200 stores.
        const zipGap = (z) => (/^\d{5}$/.test(centreZip) && /^\d{5}$/.test(z))
            ? Math.abs(parseInt(z, 10) - parseInt(centreZip, 10))
            : null;

        const out = [];
        for (const r of retailers) {
            const rzip = (r.zip || '').trim();
            const c = centroids.get(rzip);
            // No fix at all — keep it rather than hide a real store on a
            // geocoder hiccup, but it gets no distance and no marker.
            if (!c) { out.push({ ...r, distanceNum: null, distance: null, zipGap: zipGap(rzip) }); continue; }
            const d = this.calculateDistance(lat, lng, c.lat, c.lng);
            if (d > maxRadius) continue;
            out.push({
                ...r,
                distanceNum: d,
                approx: true,
                distance: t('retailer.milesApprox', { d: d.toFixed(1) }),
                zipGap: zipGap(rzip),
                // Kept separate from lat/lng (which mean "exact address"), so
                // the map can pin the ZIP without claiming a street position.
                zipLat: c.lat,
                zipLng: c.lng
            });
        }
        return out;
    }

    /**
     * Tier 2 — exact coordinates for the head of the list, so the map pins and
     * the "x.x miles away" figures are real rather than ZIP-centre estimates.
     *
     * Deliberately slow: Nominatim's usage policy is one request per second and
     * hammering it just gets the responses refused, which is why this runs in
     * the background after the coarse list is already on screen. Anything not
     * refined keeps its approximate distance.
     */
    async refineRetailerDistances(retailers, lat, lng, maxRadius, token) {
        const refined = [];
        let changed = false;

        for (const r of retailers.slice(0, LotChanceApp.MAX_EXACT_GEOCODES)) {
            if (token !== this._retailerSearchToken) return null;   // superseded
            if (!r.address || !r.city) { refined.push(r); continue; }

            if (refined.length) await new Promise(res => setTimeout(res, 1100));
            const full = [r.address, r.city, r.state || 'TX', r.zip].filter(p => p && p.trim()).join(', ');
            try {
                // Same-origin proxy to nominatim — direct calls fail on some mobile PWAs
                const resp = await fetch(`/proxy/nominatim/search?format=json&q=${encodeURIComponent(full)}&countrycodes=us&limit=1`);
                const d = await resp.json();
                if (!Array.isArray(d) || d.length === 0) { refined.push(r); continue; }
                const rLat = parseFloat(d[0].lat);
                const rLng = parseFloat(d[0].lon);
                const distance = this.calculateDistance(lat, lng, rLat, rLng);
                changed = true;
                refined.push({
                    ...r,
                    lat: rLat, lng: rLng,
                    distanceNum: distance,
                    approx: false,
                    distance: t('retailer.milesAway', { d: distance.toFixed(1) })
                });
            } catch {
                refined.push(r);   // keep the coarse fix
            }
        }

        if (!changed) return null;
        const all = refined.concat(retailers.slice(LotChanceApp.MAX_EXACT_GEOCODES));
        // Exact distances can push a store past the radius the estimate let in.
        return all.filter(r => r.distanceNum == null || r.distanceNum <= maxRadius);
    }

    clearRetailerMarkers() {
        if (this.retailerMarkers) {
            this.retailerMarkers.forEach(m => m.remove());
        }
        this.retailerMarkers = [];
    }

    /** Half-diagonal of the visible map area, in miles. */
    calculateMapRadiusMiles() {
        if (!this.retailerMap) return 10;
        const bounds = this.retailerMap.getBounds();
        const c = bounds.getCenter();
        const ne = bounds.getNorthEast();
        return this.calculateDistance(c.lat, c.lng, ne.lat, ne.lng);
    }

    /** Wire pan/zoom listeners that re-run search when bounds change meaningfully. */
    attachMapAutoSearch() {
        if (this._mapAutoSearchAttached || !this.retailerMap) return;
        this._mapAutoSearchAttached = true;
        let timer = null;
        this.retailerMap.on('moveend', () => {
            clearTimeout(timer);
            timer = setTimeout(() => this.maybeReSearchAfterMapMove(), 850);
        });
    }

    maybeReSearchAfterMapMove() {
        if (!this._lastSearchCenter || !this._lastSearchRadius) return;
        const c = this.retailerMap.getCenter();
        const radius = this.calculateMapRadiusMiles();
        const moved = this.calculateDistance(c.lat, c.lng, this._lastSearchCenter.lat, this._lastSearchCenter.lng);
        const grew = radius > this._lastSearchRadius * 1.5;
        const shifted = moved > Math.max(2, this._lastSearchRadius * 0.5);
        if (grew || shifted) {
            console.log(`[Map] auto-research (moved ${moved.toFixed(1)} mi, radius ${this._lastSearchRadius.toFixed(1)} → ${radius.toFixed(1)})`);
            this.runRetailerSearch({ lat: c.lat, lng: c.lng, radiusMiles: radius });
        }
    }

    updateRetailerList(retailers, userLat = null, userLng = null, totalFound = null) {
        const list = document.getElementById('retailerList');

        if (retailers.length === 0) {
            list.innerHTML = `
                <div class="no-retailers">
                    <i class="fas fa-store-slash" style="font-size: 32px; margin-bottom: 12px;"></i>
                    <p>${t('retailer.noneInArea')}</p>
                    <p style="font-size: 12px; margin-top: 8px;">${t('retailer.tryDifferent')}</p>
                </div>
            `;
            return;
        }

        const carrierCount = retailers.filter(r => r.carriesGame).length;
        // Say so when the list is capped, rather than implying these are all
        // the stores that were found.
        const truncated = totalFound != null && totalFound > retailers.length;
        const headerHtml = `
            <div style="padding: 8px 12px; background: rgba(202, 138, 4, 0.1); border-radius: 6px; margin-bottom: 12px; font-size: 12px; color: var(--primary-light);">
                <i class="fas fa-database"></i> ${truncated
                    ? t('retailer.showingNofTotal', { n: retailers.length, total: totalFound })
                    : t('retailer.nRetailersNearby', { n: retailers.length })}
                ${carrierCount > 0 ? `&middot; <span style="color:#22c55e; font-weight:700;">${t('retailer.nConfirmed', { n: carrierCount })}</span>` : ''}
            </div>
            <div style="padding: 6px 12px; margin-bottom: 12px; font-size: 11px; color: var(--text-muted); line-height: 1.4;">
                <i class="fas fa-info-circle"></i> ${t('retailer.nameNote')}
                ${this._bundleGeneratedAt ? `<br><i class="fas fa-clock"></i> ${t('retailer.dataAsOf', {
                    when: this._bundleGeneratedAt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
                    age: this.describeAge(this._bundleGeneratedAt.getTime())
                })}` : ''}
            </div>
        `;

        list.innerHTML = headerHtml + retailers.map(r => {
            const hasCoords = r.lat && r.lng;

            const addressParts = [r.address, r.city, r.state || 'TX', r.zip].filter(p => p && p.trim());
            const cityStateZip = [r.city, r.state || 'TX', r.zip].filter(p => p && p.trim()).join(' ');
            const fullAddress = addressParts.join(', ');

            const mapsUrl = hasCoords
                ? `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`
                : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress)}`;

            const badge = r.carriesGame
                ? `<span class="retailer-badge carries"><i class="fas fa-check-circle"></i> ${t('retailer.carries')}</span>`
                : `<span class="retailer-badge general"><i class="fas fa-store"></i> ${t('retailer.general')}</span>`;

            return `
                <div class="retailer-item ${r.carriesGame ? 'carries-game' : ''}" ${hasCoords ? `onclick="app.focusRetailer(${r.lat}, ${r.lng})"` : ''}>
                    <div class="retailer-icon" style="${r.carriesGame ? 'background: linear-gradient(135deg, #16a34a, #15803d);' : ''}">
                        <i class="fas fa-${r.carriesGame ? 'check' : 'store'}"></i>
                    </div>
                    <div class="retailer-info">
                        <div class="retailer-name">${r.name || t('retailer.defaultName')}</div>
                        ${badge}
                        <div class="retailer-address">${r.address || t('retailer.noAddress')}</div>
                        ${cityStateZip ? `<div class="retailer-address">${cityStateZip}</div>` : ''}
                        ${r.distance ? `<div class="retailer-distance"><i class="fas fa-map-marker-alt"></i> ${r.distance}</div>` : ''}
                    </div>
                    <div class="retailer-actions">
                        <a href="${mapsUrl}" target="_blank" onclick="event.stopPropagation()">
                            <i class="fas fa-directions"></i> ${t('retailer.directions')}
                        </a>
                    </div>
                </div>
            `;
        }).join('');
    }

    focusRetailer(lat, lng) {
        if (this.retailerMap) {
            this.retailerMap.setView([lat, lng], 16);
            // Find and open popup for this marker
            this.retailerMarkers.forEach(marker => {
                const markerLatLng = marker.getLatLng();
                if (Math.abs(markerLatLng.lat - lat) < 0.0001 && Math.abs(markerLatLng.lng - lng) < 0.0001) {
                    marker.openPopup();
                }
            });
        }
    }

    // ========================================
    // NEAR ME MODE
    // ========================================
    toggleNearMe(enabled) {
        this.nearMeEnabled = enabled;
        const body = document.getElementById('nearMeBody');
        const label = document.getElementById('nearMeLabel');

        if (enabled) {
            body.classList.add('active');
            label.textContent = 'ON';

            // Auto-detect location if not already set
            if (!this.nearMeLocation) {
                this.detectNearMeLocation();
            } else {
                this.searchNearMeRetailers();
            }
        } else {
            body.classList.remove('active');
            label.textContent = 'OFF';
            document.getElementById('nearMeResults').style.display = 'none';
            // Refresh games list without near-me constraint
            this.applyFilters();
        }
    }

    detectNearMeLocation() {
        if (!navigator.geolocation) {
            this.showNotification(t('retailer.geoUnsupported'), 'error');
            return;
        }

        const status = document.getElementById('nearMeStatus');
        status.textContent = t('nearme.detecting');
        status.className = 'near-me-status';

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                this.nearMeLocation = { lat, lng };

                // Reverse geocode for display
                try {
                    const response = await fetch(
                        `/proxy/nominatim/reverse?format=json&lat=${lat}&lon=${lng}`
                    );
                    const data = await response.json();
                    const city = data?.address?.city || data?.address?.town || data?.address?.village || 'Unknown';
                    const zip = data?.address?.postcode || '';
                    status.textContent = `${city}${zip ? ', ' + zip : ''} (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
                } catch {
                    status.textContent = `Location: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
                }
                status.className = 'near-me-status active';

                // Search for retailers
                if (this.nearMeEnabled) {
                    this.searchNearMeRetailers();
                }
            },
            (error) => {
                status.textContent = t('nearme.detectFailed');
                status.className = 'near-me-status';
                this.showNotification(t('nearme.detectFailedNotif'), 'error');
                console.error('Geolocation error:', error);
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }

    async searchNearMeRetailers() {
        if (!this.nearMeLocation) return;

        const { lat, lng } = this.nearMeLocation;
        const resultsDiv = document.getElementById('nearMeResults');
        const summaryDiv = document.getElementById('nearMeRetailersSummary');
        const listDiv = document.getElementById('nearMeRetailersList');
        const infoDiv = document.getElementById('nearMeInfo');

        resultsDiv.style.display = 'block';
        summaryDiv.innerHTML = `<i class="fas fa-spinner fa-spin"></i> <span>${t('nearme.searching', { r: this.nearMeRadius })}</span>`;
        listDiv.innerHTML = '';
        infoDiv.style.display = 'none';

        let retailers = [];
        let dataSource = '';

        try {
            // Step 1: Reverse geocode to get ZIP + city
            let zip = null;
            let city = null;
            try {
                const geoResponse = await fetch(
                    `/proxy/nominatim/reverse?format=json&lat=${lat}&lon=${lng}`
                );
                const geoData = await geoResponse.json();
                zip = geoData?.address?.postcode;
                city = geoData?.address?.city || geoData?.address?.town || geoData?.address?.village;
                console.log(`[NearMe] Detected ZIP: ${zip}, City: ${city}`);
            } catch (e) {
                console.warn('[NearMe] Reverse geocode failed:', e.message);
            }

            // Step 2: Fetch from our API (which scrapes official TX Lottery Retailer Locator)
            // Try ZIP first, then city
            const apiRetailers = await this.fetchRetailersFromAPI(zip, city);

            if (apiRetailers.length > 0) {
                // Step 3: Batch geocode by city+zip groups for distance calculation
                await this.geocodeRetailerGroups(apiRetailers, lat, lng, zip);

                // Filter by radius and sort
                retailers = apiRetailers
                    .filter(r => r.distanceNum <= this.nearMeRadius)
                    .sort((a, b) => a.distanceNum - b.distanceNum);

                dataSource = 'Texas Lottery';
            }

        } catch (error) {
            console.error('[NearMe] Error:', error);
        }

        this.nearMeRetailers = retailers;
        this.renderNearMeResults(retailers, dataSource);

        // Refresh game list — games only show if retailers are in range
        this.applyFilters();
    }

    /**
     * Fetch retailers from our backend API (scrapes official TX Lottery Retailer Locator)
     */
    async fetchRetailersFromAPI(zip, city) {
        const allRetailers = [];
        const seen = new Set();

        const addRetailers = (data) => {
            for (const r of data) {
                const key = `${r.name}-${r.address}`.toLowerCase();
                if (!seen.has(key) && r.address && r.city) {
                    seen.add(key);
                    allRetailers.push(r);
                }
            }
        };

        // Strategy 1: Search by exact ZIP (client-side scrape)
        if (zip) {
            try {
                const data = await window.LotteryScraper.fetchRetailers({ zip, limit: 100 });
                if (data.length) {
                    addRetailers(data);
                    console.log(`[NearMe] ZIP ${zip}: found ${data.length} retailers from TX Lottery`);
                }
            } catch (e) {
                console.warn('[NearMe] ZIP search failed:', e.message);
            }
        }

        // Strategy 2: Also search by city (client-side scrape)
        if (city && allRetailers.length < 20) {
            try {
                const data = await window.LotteryScraper.fetchRetailers({ city, limit: 100 });
                if (data.length) {
                    addRetailers(data);
                    console.log(`[NearMe] City ${city}: found ${data.length} retailers from TX Lottery`);
                }
            } catch (e) {
                console.warn('[NearMe] City search failed:', e.message);
            }
        }

        return allRetailers;
    }

    /**
     * Batch geocode retailers by city+zip groups for distance calculation
     * Much more efficient than geocoding each retailer individually
     */
    async geocodeRetailerGroups(retailers, userLat, userLng, userZip) {
        // Group by city+zip
        const groups = new Map();
        for (const r of retailers) {
            const key = `${r.city}-${r.zip}`;
            if (!groups.has(key)) {
                groups.set(key, { city: r.city, zip: r.zip });
            }
        }

        // Geocode each unique city/zip (max 8 to avoid rate limits)
        const geocoded = new Map();
        let idx = 0;
        for (const [key, group] of groups) {
            if (idx > 0) await new Promise(resolve => setTimeout(resolve, 350));
            if (idx >= 8) break;
            idx++;

            try {
                const q = group.zip
                    ? `${group.city}, TX ${group.zip}`
                    : `${group.city}, Texas`;
                const resp = await fetch(
                    `/proxy/nominatim/search?format=json&q=${encodeURIComponent(q)}&countrycodes=us&limit=1`
                );
                const results = await resp.json();
                if (results && results.length > 0) {
                    geocoded.set(key, {
                        lat: parseFloat(results[0].lat),
                        lng: parseFloat(results[0].lon)
                    });
                }
            } catch {}
        }

        // Assign distances
        for (const r of retailers) {
            const key = `${r.city}-${r.zip}`;
            const coords = geocoded.get(key);
            if (coords) {
                r.lat = coords.lat;
                r.lng = coords.lng;
                r.distanceNum = this.calculateDistance(userLat, userLng, coords.lat, coords.lng);
                r.distance = r.distanceNum.toFixed(1) + ' mi';
            } else if (r.zip === userZip) {
                // Same ZIP — close
                r.distanceNum = 2;
                r.distance = '~2 mi';
            } else {
                // From nearby search, estimate
                r.distanceNum = 10;
                r.distance = t('nearme.nearby');
            }
        }
    }

    /**
     * Render the Near Me results section
     */
    renderNearMeResults(retailers, dataSource) {
        const summaryDiv = document.getElementById('nearMeRetailersSummary');
        const listDiv = document.getElementById('nearMeRetailersList');

        if (retailers.length === 0) {
            summaryDiv.innerHTML = `
                <i class="fas fa-store-slash" style="font-size: 24px; color: var(--warning);"></i>
                <div>
                    <strong>${t('nearme.none', { r: this.nearMeRadius })}</strong>
                    <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">${t('nearme.noneHint')}</div>
                </div>
            `;
            listDiv.innerHTML = '';
            return;
        }

        const sourceNote = dataSource ? ` (via ${dataSource})` : '';
        summaryDiv.innerHTML = `
            <i class="fas fa-store"></i>
            <div>
                ${t(retailers.length === 1 ? 'nearme.foundOne' : 'nearme.foundMany', { n: retailers.length, r: this.nearMeRadius, src: sourceNote })}
                <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">${t('nearme.allAvailable')}</div>
            </div>
        `;

        listDiv.innerHTML = retailers.map(r => {
            const cityStateZip = [r.city, 'TX', r.zip].filter(p => p && p.trim()).join(' ');
            const fullAddress = [r.address, r.city, 'TX', r.zip].filter(p => p && p.trim()).join(', ');
            const mapsUrl = r.lat && r.lng
                ? `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`
                : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress)}`;

            return `
                <div class="near-me-retailer-card">
                    <div class="retailer-icon"><i class="fas fa-store"></i></div>
                    <div style="flex: 1;">
                        <div class="retailer-name">${r.name || t('retailer.defaultName')}</div>
                        ${r.address ? `<div class="retailer-address">${r.address}</div>` : ''}
                        ${cityStateZip ? `<div class="retailer-address">${cityStateZip}</div>` : ''}
                        <div class="retailer-distance"><i class="fas fa-map-marker-alt"></i> ${r.distance}</div>
                    </div>
                    <a href="${mapsUrl}" target="_blank" style="color: var(--primary-light); font-size: 12px; text-decoration: none;">
                        <i class="fas fa-directions"></i>
                    </a>
                </div>
            `;
        }).join('');
    }

    // ========================================
    // LOCATION
    // ========================================
    setLocation() {
        const input = document.getElementById('locationInput').value.trim();
        if (!input) return;

        this.currentLocation = input;
        document.getElementById('currentLocation').textContent = `📍 ${input}`;
        document.getElementById('locationInput').value = '';

        try { localStorage.setItem('lotchance.currentLocation', input); } catch (e) { /* ignore */ }

        this.showNotification(t('app.locationSet', { loc: input }));
    }

    restoreSavedLocation() {
        let saved = null;
        try { saved = localStorage.getItem('lotchance.currentLocation'); } catch (e) { /* ignore */ }
        if (!saved) return;
        this.currentLocation = saved;
        const el = document.getElementById('currentLocation');
        if (el) el.textContent = `📍 ${saved}`;
    }

    showNotification(message, type = 'success') {
        // Simple notification with type support
        const existing = document.querySelector('.notification');
        if (existing) existing.remove();

        const colors = {
            success: '#059669',
            warning: '#d97706',
            error: '#dc2626',
            info: '#3b82f6'
        };

        const icons = {
            success: 'fa-check-circle',
            warning: 'fa-exclamation-triangle',
            error: 'fa-times-circle',
            info: 'fa-info-circle'
        };

        const notif = document.createElement('div');
        notif.className = 'notification';
        notif.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: ${colors[type] || colors.success};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-weight: 600;
            z-index: 2000;
            animation: fadeIn 0.3s;
            display: flex;
            align-items: center;
            gap: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        notif.innerHTML = `<i class="fas ${icons[type] || icons.success}"></i> ${message}`;
        document.body.appendChild(notif);

        setTimeout(() => notif.remove(), 4000);
    }

    // ========================================
    // UTILITY
    // ========================================
    formatShortDate(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
    }

    formatCurrency(amount) {
        if (amount >= 1000000) {
            return '$' + (amount / 1000000).toFixed(amount % 1000000 === 0 ? 0 : 1) + 'M';
        } else if (amount >= 1000) {
            return '$' + (amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1) + 'K';
        }
        return '$' + amount.toLocaleString();
    }
}

// Initialize app
const app = new LotChanceApp();
