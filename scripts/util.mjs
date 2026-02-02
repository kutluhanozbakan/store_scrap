import fs from 'fs/promises';
import path from 'path';

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'store-scrap/1.0',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed (${response.status}) for ${url}: ${body.slice(0, 200)}`);
  }

  return response.json();
}

export function createLimiter(limit = 5) {
  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= limit || queue.length === 0) {
      return;
    }

    const { fn, resolve, reject } = queue.shift();
    active += 1;

    Promise.resolve()
      .then(fn)
      .then((value) => {
        active -= 1;
        resolve(value);
        next();
      })
      .catch((error) => {
        active -= 1;
        reject(error);
        next();
      });
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

export function safeParseDate(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function loadJson(filePath, fallback) {
  try {
    const contents = await fs.readFile(filePath, 'utf8');
    return JSON.parse(contents);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

export async function saveJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export function isCacheFresh(entry, ttlMs) {
  if (!entry || !entry.updatedAt) {
    return false;
  }
  const updatedAt = new Date(entry.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) {
    return false;
  }
  return Date.now() - updatedAt.getTime() <= ttlMs;
}

export function updateCache(cache, key, data) {
  cache[key] = {
    ...data,
    updatedAt: new Date().toISOString(),
  };
}

export function roundRobinSlice(list, cursor, size) {
  if (!Array.isArray(list) || list.length === 0) {
    return { slice: [], nextCursor: 0 };
  }

  const normalizedCursor = Math.max(0, cursor) % list.length;
  const slice = [];
  const limit = Math.min(size, list.length);

  for (let i = 0; i < limit; i += 1) {
    slice.push(list[(normalizedCursor + i) % list.length]);
  }

  return {
    slice,
    nextCursor: (normalizedCursor + slice.length) % list.length,
  };
}
