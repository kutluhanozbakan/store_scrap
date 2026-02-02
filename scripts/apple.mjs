import path from 'path';
import { fileURLToPath } from 'url';
import {
  createLimiter,
  fetchJson,
  isCacheFresh,
  loadJson,
  safeParseDate,
  saveJson,
  updateCache,
} from './util.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ITUNES_CACHE_PATH = path.join(__dirname, '..', 'cache', 'itunes_cache.json');
const ITUNES_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const RSS_BASE = 'https://rss.applemarketingtools.com/api/v2';

const feeds = {
  new: 'new-apps-we-love',
  updated: 'top-free',
};

const limiter = createLimiter(6);

async function fetchRssFeed(country, feedName) {
  const url = `${RSS_BASE}/${country}/apps/${feedName}/50/apps.json`;
  const data = await fetchJson(url);
  return data.feed?.results ?? [];
}

async function loadItunesCache() {
  return loadJson(ITUNES_CACHE_PATH, {});
}

async function saveItunesCache(cache) {
  await saveJson(ITUNES_CACHE_PATH, cache);
}

async function lookupItunes(cache, id, country) {
  const cached = cache[id];
  if (isCacheFresh(cached, ITUNES_TTL_MS)) {
    return cached.data ?? null;
  }

  const url = `https://itunes.apple.com/lookup?id=${id}&country=${country}`;
  const data = await fetchJson(url);
  const result = data.results?.[0] ?? null;
  updateCache(cache, id, { data: result });
  return result;
}

function formatItem(result, itunesData, country) {
  const releaseDate = safeParseDate(itunesData?.releaseDate || result.releaseDate);
  const genres = itunesData?.genres ?? [];
  return {
    id: result.id,
    name: result.name,
    developer: result.artistName,
    url: result.url,
    artwork: result.artworkUrl100,
    price: itunesData?.formattedPrice ?? 'Free',
    isFree: itunesData?.price === 0 || itunesData?.price === undefined,
    releaseDate: releaseDate ? releaseDate.toISOString() : null,
    genres,
    country,
  };
}

export async function fetchAppleData(country) {
  const cache = await loadItunesCache();
  const errors = [];

  const feedEntries = await Promise.all(
    Object.entries(feeds).map(async ([key, feedName]) => {
      try {
        const results = await fetchRssFeed(country, feedName);
        return [key, results];
      } catch (error) {
        errors.push({ feed: key, message: error.message });
        return [key, []];
      }
    })
  );

  const entriesByType = Object.fromEntries(feedEntries);
  const enriched = {};

  for (const [type, entries] of Object.entries(entriesByType)) {
    const items = await Promise.all(
      entries.map((entry) =>
        limiter(async () => {
          try {
            const itunesData = await lookupItunes(cache, entry.id, country);
            if (!itunesData) {
              return null;
            }
            const genres = itunesData.genres ?? [];
            if (!genres.includes('Games')) {
              return null;
            }
            return formatItem(entry, itunesData, country);
          } catch (error) {
            errors.push({ feed: type, id: entry.id, message: error.message });
            return null;
          }
        })
      )
    );

    enriched[type] = items.filter(Boolean);
  }

  await saveItunesCache(cache);

  return {
    country,
    store: 'apple',
    updatedAt: new Date().toISOString(),
    new: enriched.new ?? [],
    updated: enriched.updated ?? [],
    errors,
  };
}
