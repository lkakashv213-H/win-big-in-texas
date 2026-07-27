/**
 * LotChance — published data bundle client.
 *
 * Reads the JSON that .github/workflows/update-data.yml regenerates twice a
 * day and commits to the repo. This is the preferred data path: it means the
 * app hits a static CDN instead of texaslottery.com / data.texas.gov, so a
 * thousand users cost the state nothing and nobody gets rate-limited.
 *
 * Retailers arrive pre-geocoded (US Census, done once in CI), so distances are
 * plain arithmetic here — no per-user geocoding, no Nominatim, no waiting.
 *
 * Everything degrades: if the bundle is unreachable or stale-looking, callers
 * fall back to the live scrapers in scraper.js.
 *
 * Exposes: window.RemoteData
 */
(function () {
    const BASE = (typeof CONFIG !== 'undefined' && CONFIG.DATA_BUNDLE_URL) || '';
    const LS = {
        manifest: 'lotchance.bundle.manifest',
        games: 'lotchance.bundle.games',
        shard: (z3) => `lotchance.bundle.retailers.${z3}`,
        carriers: (id) => `lotchance.bundle.carriers.${id}`
    };
    // Re-check the manifest at most this often; it is tiny but there is no
    // point asking on every render.
    const MANIFEST_TTL_MS = 30 * 60 * 1000;

    const enabled = () => !!BASE;

    function lsGet(key) {
        try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    }
    function lsSet(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); return true; }
        catch { return false; }   // quota — we just refetch next time
    }

    async function getJson(pathname) {
        const res = await fetch(`${BASE}/${pathname}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`${pathname} HTTP ${res.status}`);
        return res.json();
    }

    let manifestPromise = null;

    /**
     * Current manifest, cached in memory for the page and in localStorage
     * across sessions. `version` changes whenever CI publishes, which is what
     * every other cached file is validated against.
     */
    async function getManifest({ force = false } = {}) {
        if (!enabled()) return null;
        const cached = lsGet(LS.manifest);
        if (!force && cached && (Date.now() - cached.checkedAt) < MANIFEST_TTL_MS) return cached.manifest;
        if (manifestPromise) return manifestPromise;

        manifestPromise = (async () => {
            try {
                const manifest = await getJson('manifest.json');
                lsSet(LS.manifest, { checkedAt: Date.now(), manifest });
                if (!cached || cached.manifest.version !== manifest.version) {
                    console.log(`[RemoteData] bundle ${manifest.version} (${manifest.counts.games} games, ${manifest.counts.retailers} retailers)`);
                }
                return manifest;
            } catch (e) {
                console.warn('[RemoteData] manifest unavailable:', e.message);
                return cached ? cached.manifest : null;   // last known good
            } finally {
                manifestPromise = null;
            }
        })();
        return manifestPromise;
    }

    /**
     * Fetch a bundle file, reusing the cached copy while the manifest still
     * advertises the same hash for it. That is what keeps repeat launches to a
     * single 8 KB manifest request.
     */
    async function cachedFile(lsKey, pathname, expectedHash) {
        const hit = lsGet(lsKey);
        if (hit && expectedHash && hit.hash === expectedHash) return hit.data;
        const data = await getJson(pathname);
        lsSet(lsKey, { hash: expectedHash || null, data });
        return data;
    }

    async function fetchGames() {
        const m = await getManifest();
        if (!m) return null;
        const meta = m.files && m.files['games.json'];
        const payload = await cachedFile(LS.games, 'games.json', meta && meta.hash);
        return payload && payload.games ? payload.games : null;
    }

    /** Retailers are sharded by 3-digit ZIP; a search only needs its own area. */
    async function fetchRetailerShards(zip3List) {
        const m = await getManifest();
        if (!m) return [];
        const out = [];
        for (const z3 of zip3List) {
            const meta = m.retailers && m.retailers[z3];
            if (!meta) continue;
            try {
                out.push(...await cachedFile(LS.shard(z3), `retailers/${z3}.json`, meta.hash));
            } catch (e) {
                console.warn(`[RemoteData] shard ${z3} failed:`, e.message);
            }
        }
        return out;
    }

    /** Retailer numbers reported as selling a game within the sales window. */
    async function fetchCarriers(gameId) {
        const m = await getManifest();
        if (!m) return null;
        const meta = m.carriers && m.carriers[gameId];
        if (!meta) return null;
        try {
            return new Set(await cachedFile(LS.carriers(gameId), `carriers/${gameId}.json`, meta.hash));
        } catch (e) {
            console.warn(`[RemoteData] carriers ${gameId} failed:`, e.message);
            return null;
        }
    }

    function distanceMiles(lat1, lng1, lat2, lng2) {
        const R = 3959;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /** 3-digit ZIP prefixes to pull, given the search ZIP. */
    function shardsFor(zip) {
        if (!/^\d{5}$/.test(zip || '')) return [];
        const base = parseInt(zip.slice(0, 3), 10);
        // Neighbouring sectional centres, because a metro can straddle two.
        return [base, base - 1, base + 1]
            .filter((n) => n >= 0 && n <= 999)
            .map((n) => String(n).padStart(3, '0'));
    }

    /**
     * Retailers near a point, already carrying real coordinates and distances.
     * Returns [] when the bundle can't answer, so callers can fall back.
     */
    async function findRetailers({ lat, lng, zip = '', gameId = null, radiusMiles = 25, limit = 50 }) {
        if (!enabled() || lat == null || lng == null) return [];

        const shards = shardsFor(zip);
        if (!shards.length) return [];

        const [retailers, carriers] = await Promise.all([
            fetchRetailerShards(shards),
            gameId ? fetchCarriers(gameId) : Promise.resolve(null)
        ]);
        if (!retailers.length) return [];

        const out = [];
        for (const r of retailers) {
            if (r.lat == null || r.lng == null) continue;   // not geocoded in CI
            const d = distanceMiles(lat, lng, r.lat, r.lng);
            if (d > radiusMiles) continue;
            out.push({
                name: r.n, address: r.a, city: r.c, state: 'TX', zip: r.z, county: r.k,
                lat: r.lat, lng: r.lng,
                distanceNum: d,
                carriesGame: carriers ? carriers.has(r.r) : false,
                retailerNumber: r.r
            });
        }

        out.sort((a, b) => (a.carriesGame === b.carriesGame)
            ? a.distanceNum - b.distanceNum
            : (a.carriesGame ? -1 : 1));

        console.log(`[RemoteData] ${out.length} retailers within ${radiusMiles} mi` +
            (carriers ? `, ${out.filter(r => r.carriesGame).length} carrying game ${gameId}` : ''));
        return out.slice(0, limit);
    }

    window.RemoteData = {
        enabled, getManifest, fetchGames, findRetailers, fetchCarriers, distanceMiles, shardsFor
    };
})();
