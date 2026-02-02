import gplay from 'google-play-scraper';

const GOOGLE_LIMIT = 100;
const TARGET_SIZE = 50;
const FALLBACK_COLLECTIONS = [
  gplay.collection.TOP_FREE,
  gplay.collection.TOP_GROSSING,
  gplay.collection.NEW_FREE,
];

function mapEntry(entry, country) {
  return {
    id: entry.appId,
    name: entry.title,
    developer: entry.developer,
    url: entry.url,
    artwork: entry.icon,
    price: entry.priceText ?? (entry.free ? 'Free' : null),
    isFree: entry.free ?? entry.price === 0,
    releaseDate: entry.updated ? new Date(entry.updated).toISOString() : null,
    genres: entry.genre ? [entry.genre] : [],
    country,
  };
}

async function fetchCollection(country, collection, fullDetail) {
  return gplay.list({
    collection,
    country,
    category: gplay.category.GAME,
    num: GOOGLE_LIMIT,
    fullDetail,
  });
}

async function fetchCollectionSafe(country, collections, label) {
  let lastError;
  for (const collection of collections) {
    try {
      return await fetchCollection(country, collection, true);
    } catch (error) {
      lastError = error;
      try {
        return await fetchCollection(country, collection, false);
      } catch (fallbackError) {
        lastError = fallbackError;
      }
    }
  }
  console.warn(`Google ${label} fetch failed for ${country}`, lastError?.message ?? lastError);
  return [];
}

export async function fetchGoogleData(country, previousData = null) {
  const [newApps, updatedApps] = await Promise.all([
    fetchCollectionSafe(country, FALLBACK_COLLECTIONS, 'new'),
    fetchCollectionSafe(country, [gplay.collection.TOP_GROSSING, gplay.collection.TOP_FREE], 'updated'),
  ]);

  const newItems = newApps.map((entry) => mapEntry(entry, country));
  const updatedItems = updatedApps.map((entry) => mapEntry(entry, country));
  newItems.sort((a, b) => {
    const aDate = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
    const bDate = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
    return bDate - aDate;
  });

  if (newItems.length === 0 && updatedItems.length === 0 && previousData) {
    return {
      ...previousData,
      country,
      store: 'google',
      preservedAt: new Date().toISOString(),
      errors: [],
    };
  }

  return {
    country,
    store: 'google',
    updatedAt: new Date().toISOString(),
    new: newItems.slice(0, TARGET_SIZE),
    updated: updatedItems.slice(0, TARGET_SIZE),
    errors: [],
  };
}
