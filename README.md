# LotChance - Texas Lottery Scratch-Off Analyzer

Real-time Texas Lottery scratch-off ticket analyzer with live data updates.

## Features

- **Live Data**: Scrapes real data from Texas Lottery website
- **Auto-Refresh**: Configurable refresh intervals (5s to 5min)
- **Top 5 Picks**: Best tickets by jackpot+odds, overall odds, and budget value
- **Jackpot Tracking**: Shows remaining vs claimed top prizes
- **Adjusted Odds**: Calculates real winning chances based on prizes remaining
- **Retailer Finder**: Links to find nearby ticket retailers

## Quick Start

### 1. Install Dependencies

```bash
cd C:\Projects\lotchance
npm install
```

### 2. Start the Server

```bash
npm start
```

### 3. Open the App

Open your browser to: **http://localhost:3000**

## How It Works

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser UI    │────▶│  Node.js Server  │────▶│  Texas Lottery  │
│   (Frontend)    │◀────│    (Backend)     │◀────│    Website      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

1. **Server** scrapes Texas Lottery website for current game data
2. **Frontend** fetches data from server API every X seconds
3. **Top 5 lists** recalculate automatically on each refresh
4. **Dashboard** updates with latest statistics

## Configuration

Edit `config.js` to customize:

```javascript
// Refresh interval (seconds)
DEFAULT_REFRESH_INTERVAL: 10,

// Auto-start refresh on page load
AUTO_START_REFRESH: false,

// Server cache duration
SERVER_CACHE_DURATION: 60000, // 1 minute
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/games` | Get all scratch-off games |
| `GET /api/games/:id` | Get specific game details |
| `GET /api/refresh` | Force refresh data from source |
| `GET /api/status` | Check server status and cache info |

## File Structure

```
lotchance/
├── index.html      # Main UI
├── styles.css      # Styling
├── app.js          # Frontend logic
├── data.js         # Fallback static data
├── config.js       # Configuration
├── server.js       # Backend server
├── package.json    # Node.js dependencies
└── README.md       # This file
```

## Troubleshooting

### "Using cached data" message
- The backend server isn't running
- Run `npm start` in the lotchance folder

### Data not updating
- Check server console for scraping errors
- Texas Lottery website structure may have changed
- Try `http://localhost:3000/api/refresh` to force refresh

### CORS errors
- Make sure you're accessing via `localhost:3000`, not opening HTML file directly

## Data Sources

1. **Primary**: Texas Lottery Official Website
   - https://www.texaslottery.com/export/sites/lottery/Games/Scratch_Offs/

2. **Backup**: Lottery.net
   - https://www.lottery.net/texas/scratch-offs

## Disclaimer

This app is for informational purposes only. Play responsibly. Must be 18+ to play lottery in Texas. Data accuracy depends on source websites.

## License

MIT License
