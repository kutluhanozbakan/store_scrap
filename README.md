# Store Scrap

Store Scrap provides a lightweight Node API that fetches the latest top 50 game listings per
country from the Apple App Store and Google Play. The UI calls the API on demand, caches responses
for a short time, and lets you filter by country, time range, and price.

## Features

- On-demand per-country fetch with a configurable cache (default 5 minutes).
- Top 50 "new" games sorted by release date from store charts.
- Manual refresh button to bypass the cache for the selected country.
- Filters for country, time range, and price.

## Local setup

```bash
npm install
```

```bash
npm run dev
```

Open `http://localhost:8787`.

### Environment variables

- `PORT` (default: 8787)
- `CACHE_TTL_MS` (default: 300000)

Example:

```bash
PORT=9000 CACHE_TTL_MS=60000 npm run dev
```

## API

```text
GET /api/summary
GET /api/country/{CODE}
GET /api/country/{CODE}?refresh=1
GET /api/health
```

## Legacy build scripts (optional)

`scripts/build.mjs` can still generate JSON snapshots, but the current UI expects the API endpoints
above. If you want a fully static build, update `assets/app.js` to read from `data/` again.

## Data sources and licensing

- Apple RSS feeds and iTunes lookup APIs are used to identify games. Apple content and metadata
  remain subject to Apple's terms.
- Google Play data is collected via `google-play-scraper`, which may be subject to Google Play
  terms. Treat this data source as beta and avoid production usage without proper review.
- This repository provides the data "as-is" without warranties.
