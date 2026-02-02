import gplay from 'google-play-scraper';

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

async function fetchCollection(country, collection) {
  return gplay.list({
    collection,
    country,
    num: 50,
    fullDetail: true,
  });
}

export async function fetchGoogleData(country, previousData = null) {
  try {
    const [newApps, updatedApps] = await Promise.all([
      fetchCollection(country, gplay.collection.NEW_FREE),
      fetchCollection(country, gplay.collection.TOP_FREE),
    ]);

    return {
      country,
      store: 'google',
      updatedAt: new Date().toISOString(),
      new: newApps.map((entry) => mapEntry(entry, country)),
      updated: updatedApps.map((entry) => mapEntry(entry, country)),
      errors: [],
    };
  } catch (error) {
    if (previousData) {
      return {
        ...previousData,
        country,
        store: 'google',
        preservedAt: new Date().toISOString(),
        errors: [
          ...(previousData.errors ?? []),
          { message: error.message, preserved: true },
        ],
      };
    }

    return {
      country,
      store: 'google',
      updatedAt: new Date().toISOString(),
      new: [],
      updated: [],
      errors: [{ message: error.message }],
    };
  }
}
