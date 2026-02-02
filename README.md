# Store Scrap

Store Scrap keeps a lightweight, country-by-country snapshot of newly released and recently updated game listings from the Apple App Store and Google Play. Data is refreshed in small increments and published as static JSON so it can be hosted on GitHub Pages or any static site host.

## Features

- Incremental refreshes to avoid hitting store rate limits.
- Per-country snapshots for Apple and Google listings.
- Global summary feed for a fast front-end bootstrap.
- Static, zero-backend front-end with filters for country, time range, and price.

## Local setup

```bash
npm install
```

### Run an incremental build

```bash
node scripts/build.mjs --incremental
```

### Run a full rebuild

```bash
node scripts/build.mjs --full
```

### Limit countries (optional)

```bash
node scripts/build.mjs --incremental --countries=US,CA,GB --limit=3
```

## Local preview

Serve the project root with any static server. Example using Python:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## GitHub Pages

1. Enable GitHub Pages for the repository (Settings → Pages → Deploy from a branch).
2. Point Pages at the default branch root.
3. The GitHub Action workflow will refresh `data/` and `cache/` every 10 minutes and push updates.

## Data sources and licensing

- Apple RSS feeds and iTunes lookup APIs are used to identify games. Apple content and metadata remain subject to Apple’s terms.
- Google Play data is collected via `google-play-scraper`, which may be subject to Google Play terms. Treat this data source as beta and avoid production usage without proper review.
- This repository provides the data “as-is” without warranties.
