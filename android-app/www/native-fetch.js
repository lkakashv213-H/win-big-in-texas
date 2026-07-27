/**
 * Patch window.fetch on Android so cross-origin requests go through
 * CapacitorHttp (native HTTP, no CORS). Same-origin requests pass through
 * unchanged. In a regular browser this is a no-op.
 */
(function () {
    const cap = window.Capacitor;
    if (!cap?.isNativePlatform?.() || !cap.Plugins?.CapacitorHttp) {
        console.log('[NativeFetch] not native — fetch unchanged');
        return;
    }
    const http = cap.Plugins.CapacitorHttp;
    const origFetch = window.fetch.bind(window);

    window.fetch = async function (input, init = {}) {
        const url = typeof input === 'string' ? input : input.url;

        // Same-origin → use the original fetch (Leaflet tiles via Capacitor's
        // local server, app assets, etc).
        let parsed;
        try {
            parsed = new URL(url, location.href);
            if (parsed.origin === location.origin || parsed.origin === 'null') {
                return origFetch(input, init);
            }
        } catch (e) {
            return origFetch(input, init);
        }

        const method = (init.method || 'GET').toUpperCase();
        const headers = init.headers || {};
        const data = init.body || undefined;

        try {
            const res = await http.request({
                url: parsed.toString(),
                method,
                headers,
                data,
                responseType: 'text'
            });
            const bodyText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
            return new Response(bodyText, {
                status: res.status,
                statusText: '',
                headers: res.headers || {}
            });
        } catch (err) {
            console.error('[NativeFetch] CapacitorHttp request failed:', url, err);
            throw err;
        }
    };
    console.log('[NativeFetch] fetch() patched for cross-origin via CapacitorHttp');
})();
