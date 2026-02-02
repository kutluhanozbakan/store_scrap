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
const RSS_LIMIT = 100;
const TARGET_SIZE = 50;
const RETRY_DELAYS = [300, 800, 1500];

const feeds = {
  new: ['top-free', 'top-grossing', 'top-paid'],
  updated: ['top-grossing', 'top-free', 'top-paid'],
};

const limiter = createLimiter(6);

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url) {
  let lastError;
  for (let i = 0; i <= RETRY_DELAYS.length; i += 1) {
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;
      if (i < RETRY_DELAYS.length) {
        await sleep(RETRY_DELAYS[i]);
      }
    }
  }
  throw lastError;
}

async function fetchRssFeed(country, feedNames) {
  let lastError;
  for (const feedName of feedNames) {
    const url = `${RSS_BASE}/${country}/apps/${feedName}/${RSS_LIMIT}/apps.json`;
    try {
      const data = await fetchWithRetry(url);
      return data.feed?.results ?? [];
    } catch (error) {
      lastError = error;
      if (error.message?.includes('(404)')) {
        continue;
      }
      continue;
    }
  }
  console.warn(`Apple RSS fetch failed for ${country}`, lastError?.message ?? lastError);
  return [];
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

  const feedEntries = await Promise.all(
    Object.entries(feeds).map(async ([key, feedName]) => {
      const results = await fetchRssFeed(country, feedName);
      return [key, results];
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
            return null;
          }
        })
      )
    );
    const normalized = items.filter(Boolean);
    if (type === 'new') {
      normalized.sort((a, b) => {
        const aDate = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
        const bDate = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
        return bDate - aDate;
      });
    }
    enriched[type] = normalized.slice(0, TARGET_SIZE);
  }

  await saveItunesCache(cache);

  return {
    country,
    store: 'apple',
    updatedAt: new Date().toISOString(),
    new: enriched.new ?? [],
    updated: enriched.updated ?? [],
    errors: [],
  };
}
