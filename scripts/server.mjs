import http from 'http';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { fetchAppleData } from './apple.mjs';
import { fetchGoogleData } from './google.mjs';
import { loadJson } from './util.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const COUNTRIES_PATH = path.join(ROOT, 'countries.json');

const PORT = Number.parseInt(process.env.PORT ?? '8787', 10);
const CACHE_TTL_MS = Number.parseInt(process.env.CACHE_TTL_MS ?? '300000', 10);

const cache = new Map();
const inFlight = new Map();
let countryCodes = [];
let countries = [];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

async function initCountries() {
  const data = await loadJson(COUNTRIES_PATH, []);
  countries = data
    .map((entry) => ({
      code: entry.code?.toUpperCase(),
      name: entry.name?.trim() || null,
    }))
    .filter((entry) => entry.code);
  countryCodes = countries.map((entry) => entry.code);
}

function isFresh(entry) {
  if (!entry) {
    return false;
  }
  return Date.now() - entry.fetchedAt <= CACHE_TTL_MS;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, body) {
  setCors(res);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

function toSummaryEntry(data) {
  if (!data) {
    return null;
  }
  return {
    updatedAt: data.updatedAt,
    newCount: data.new?.length ?? 0,
    updatedCount: data.updated?.length ?? 0,
    errorCount: data.errors?.length ?? 0,
  };
}

function buildSummary() {
  return {
    generatedAt: new Date().toISOString(),
    meta: {
      cacheTtlMs: CACHE_TTL_MS,
      countries: countryCodes.length,
    },
    countries: countries.map(({ code, name }) => {
      const apple = cache.get(`apple:${code}`)?.data;
      const google = cache.get(`google:${code}`)?.data;
      return {
        code,
        name,
        apple: toSummaryEntry(apple),
        google: toSummaryEntry(google),
      };
    }),
  };
}

async function getStoreData(store, country, { force = false } = {}) {
  const key = `${store}:${country}`;
  const cached = cache.get(key);
  if (!force && isFresh(cached)) {
    return cached.data;
  }
  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const promise = (async () => {
    let data;
    try {
      if (store === 'apple') {
        data = await fetchAppleData(country);
      } else {
        data = await fetchGoogleData(country, cached?.data ?? null);
      }
    } catch (error) {
      const fallback = cached?.data ?? null;
      if (fallback) {
        data = {
          ...fallback,
          preservedAt: new Date().toISOString(),
          errors: [
            ...(fallback.errors ?? []),
            { message: error.message, preserved: true },
          ],
        };
      } else {
        data = {
          country,
          store,
          updatedAt: new Date().toISOString(),
          new: [],
          updated: [],
          errors: [{ message: error.message }],
        };
      }
    }
    cache.set(key, { data, fetchedAt: Date.now() });
    inFlight.delete(key);
    return data;
  })();

  inFlight.set(key, promise);
  return promise;
}

function resolveStaticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const safePath = path.resolve(ROOT, `.${decoded}`);
  if (!safePath.startsWith(ROOT)) {
    return null;
  }
  return safePath;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = resolveStaticPath(pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(500);
    res.end('Server error');
  }
}

function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (url.pathname === '/api/summary') {
    sendJson(res, 200, buildSummary());
    return;
  }

  if (url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, timestamp: new Date().toISOString() });
    return;
  }

  if (url.pathname.startsWith('/api/country/')) {
    const code = url.pathname.split('/').pop()?.toUpperCase();
    if (!code || !countryCodes.includes(code)) {
      sendJson(res, 404, { error: 'Unknown country code' });
      return;
    }
    const force = url.searchParams.get('refresh') === '1' || url.searchParams.get('refresh') === 'true';

    Promise.all([getStoreData('apple', code, { force }), getStoreData('google', code, { force })])
      .then(([apple, google]) => {
        sendJson(res, 200, { country: code, apple, google });
      })
      .catch((error) => {
        sendJson(res, 500, { error: error.message });
      });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

await initCountries();

const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/api/')) {
    handleApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Store Scrap server running at http://localhost:${PORT}`);
  console.log(`Cache TTL: ${Math.round(CACHE_TTL_MS / 1000)}s`);
});
