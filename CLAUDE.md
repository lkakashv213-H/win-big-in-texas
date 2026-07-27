# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LotChance is a Texas Lottery scratch-off ticket analyzer. It scrapes real-time data from the Texas Lottery website, calculates adjusted odds based on remaining prizes, and presents Top 5 picks via a web dashboard.

## Commands

```bash
npm install        # Install dependencies
npm start          # Start the Express server on port 3000 (or PORT env var)
```

No test runner, linter, or build step is configured. The app is plain JavaScript (no transpilation).

Windows users can also use `install.bat` and `start.bat` as shortcuts.

## Architecture

**Backend** (`server.js`): Express server that scrapes Texas Lottery website using axios + cheerio. Serves the frontend as static files and exposes a REST API. Data is cached in-memory with a 1-minute TTL.

**Frontend** (`index.html`, `app.js`, `styles.css`): Single-page app using vanilla JS (no framework). The `LotChanceApp` class in `app.js` manages all UI state, fetching data from the backend API and falling back to static data when the server is unavailable.

**Static data** (`data.js`): Hardcoded `TEXAS_SCRATCH_OFFS` array used as fallback/base data. The frontend always loads this first, then merges any live updates from the API.

**Shared config** (`config.js`): Exports a `CONFIG` object that works in both browser and Node.js (via `module.exports` conditional). Controls refresh intervals, API settings, cache duration, display settings, and scraper configuration.

## API Endpoints

- `GET /api/games` — all scratch-off games
- `GET /api/games/:id` — single game details
- `GET /api/refresh` — force re-scrape from source
- `GET /api/status` — server status and cache info

## Key Dependencies

- **express** — HTTP server and static file serving
- **axios** — HTTP client for scraping
- **cheerio** — HTML parsing (jQuery-like API for server-side DOM)
- **cors** — CORS middleware

## Important Patterns

- The frontend must be accessed via `localhost:3000` (served by Express), not opened as a file, to avoid CORS issues.
- `config.js` uses a dual-export pattern (`module.exports` for Node, global `CONFIG` for browser via `<script>` tag).
- `data.js` defines `TEXAS_SCRATCH_OFFS` as a global for browser use; it is not imported by the server.
- Scraper selectors in `server.js` are fragile — if the Texas Lottery website changes its HTML structure, parsing will break.
