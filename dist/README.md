# LotChance — Netlify build (client-side scraping)

This folder is a fully static deploy. **All scraping runs in your phone's
browser**: `scraper.js` parses the Texas Lottery CSV and HTML directly using
`fetch()` and `DOMParser`. There are no server functions and no Node code in
production.

The only thing Netlify does is forward requests to `texaslottery.com`
transparently (via the redirects in `netlify.toml`), because Texas Lottery
doesn't send CORS headers — without that pipe, the phone's browser would block
the cross-origin request. Netlify never parses or processes the response.

## Deploy

### Option 1 — Netlify Drop (drag-and-drop)

1. Open https://app.netlify.com/drop
2. Drag the entire `dist/` folder in.

That's it. The proxy redirects in `netlify.toml` start working immediately, so
the phone gets live data on the first load.

### Option 2 — Netlify CLI

```bash
npm install -g netlify-cli      # one-time
cd dist
netlify deploy --prod
```

### Option 3 — Git repo

Push `dist/` contents to GitHub, then in Netlify: **Add new site → Import from
Git** with publish directory pointing at the folder containing `netlify.toml`.

## Installing on your phone (PWA)

Open the deployed URL in mobile Chrome/Safari:

- **iPhone**: Share → "Add to Home Screen"
- **Android**: ⋮ menu → "Install app"

You get the Lone Star icon, full-screen launch, and offline shell caching.
Live data still comes from the proxy when online; offline you see the cached
view.

## What's in here

| File | Purpose |
|---|---|
| `index.html`, `styles.css` | UI |
| `app.js` | App logic (uses `LotteryScraper`) |
| `i18n.js` | English/Spanish dictionary + `t()` helper, first-launch language picker |
| `scraper.js` | **Client-side** Texas Lottery scraper (CSV + retailer HTML) |
| `data.js` | Static fallback / source of overall odds (don't change game-to-game) |
| `config.js` | App config |
| `manifest.webmanifest`, `service-worker.js` | PWA glue |
| `icons/` | App icons (SVG + PNG sizes) |
| `netlify.toml` | Same-origin redirects to texaslottery.com (CORS pipe only) |
