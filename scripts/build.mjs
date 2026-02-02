import path from 'path';
import { fileURLToPath } from 'url';
import { fetchAppleData } from './apple.mjs';
import { fetchGoogleData } from './google.mjs';
import {
  createLimiter,
  loadJson,
  roundRobinSlice,
  saveJson,
} from './util.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const APPLE_DIR = path.join(DATA_DIR, 'apple');
const GOOGLE_DIR = path.join(DATA_DIR, 'google');
const META_PATH = path.join(DATA_DIR, 'meta.json');

function parseArgs(argv) {
  const args = new Set(argv);
  const getValue = (flag, fallback) => {
    const entry = argv.find((item) => item.startsWith(`${flag}=`));
    if (!entry) {
      return fallback;
    }
    return entry.split('=').slice(1).join('=') || fallback;
  };

  return {
    incremental: args.has('--incremental') || !args.has('--full'),
    full: args.has('--full'),
    limit: Number.parseInt(getValue('--limit', '20'), 10),
    countries: getValue('--countries', null),
  };
}

async function loadCountryList() {
  const countriesPath = path.join(ROOT, 'countries.json');
  const data = await loadJson(countriesPath, []);
  return data.map((entry) => entry.code).filter(Boolean);
}

async function build() {
  const args = parseArgs(process.argv.slice(2));
  const meta = await loadJson(META_PATH, { incrementalCursor: 0 });
  const countries = await loadCountryList();
  const normalizedCountries = args.countries
    ? args.countries.split(',').map((code) => code.trim().toUpperCase())
    : null;

  let targetCountries = countries;
  let nextCursor = meta.incrementalCursor ?? 0;

  if (normalizedCountries && normalizedCountries.length > 0) {
    targetCountries = countries.filter((code) => normalizedCountries.includes(code));
  } else if (!args.full && args.incremental) {
    const { slice, nextCursor: cursor } = roundRobinSlice(
      countries,
      meta.incrementalCursor ?? 0,
      Number.isNaN(args.limit) ? 20 : args.limit
    );
    targetCountries = slice;
    nextCursor = cursor;
  }

  const limiter = createLimiter(4);

  const results = await Promise.all(
    targetCountries.map((country) =>
      limiter(async () => {
        const applePath = path.join(APPLE_DIR, `${country}.json`);
        const googlePath = path.join(GOOGLE_DIR, `${country}.json`);
        const previousApple = await loadJson(applePath, null);
        const previousGoogle = await loadJson(googlePath, null);

        let appleData;
        try {
          appleData = await fetchAppleData(country);
        } catch (error) {
          appleData = previousApple ?? {
            country,
            store: 'apple',
            updatedAt: new Date().toISOString(),
            new: [],
            updated: [],
            errors: [],
          };
          appleData.errors = [
            ...(appleData.errors ?? []),
            { message: error.message, preserved: Boolean(previousApple) },
          ];
        }

        const googleData = await fetchGoogleData(country, previousGoogle);

        await saveJson(applePath, appleData);
        await saveJson(googlePath, googleData);

        return { country, appleData, googleData };
      })
    )
  );

  const summaryCountries = await Promise.all(
    countries.map(async (country) => {
      const applePath = path.join(APPLE_DIR, `${country}.json`);
      const googlePath = path.join(GOOGLE_DIR, `${country}.json`);
      const apple = await loadJson(applePath, null);
      const google = await loadJson(googlePath, null);
      return {
        code: country,
        apple: apple
          ? {
              updatedAt: apple.updatedAt,
              newCount: apple.new?.length ?? 0,
              updatedCount: apple.updated?.length ?? 0,
              errorCount: apple.errors?.length ?? 0,
            }
          : null,
        google: google
          ? {
              updatedAt: google.updatedAt,
              newCount: google.new?.length ?? 0,
              updatedCount: google.updated?.length ?? 0,
              errorCount: google.errors?.length ?? 0,
            }
          : null,
      };
    })
  );

  await saveJson(
    path.join(DATA_DIR, 'global_summary.json'),
    {
      generatedAt: new Date().toISOString(),
      meta: {
        runType: args.full ? 'full' : 'incremental',
        countriesProcessed: targetCountries,
        totalCountries: countries.length,
      },
      countries: summaryCountries,
    }
  );

  await saveJson(META_PATH, {
    lastRunAt: new Date().toISOString(),
    runType: args.full ? 'full' : 'incremental',
    incrementalCursor: args.full ? meta.incrementalCursor ?? 0 : nextCursor,
    incrementalSize: Number.isNaN(args.limit) ? 20 : args.limit,
    countriesProcessed: targetCountries,
  });

  console.log(`Processed ${results.length} countries.`);
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
