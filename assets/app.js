const state = {
  summary: null,
  dataCache: new Map(),
  activeTab: 'apple-new',
  activeCountry: null,
  isLoading: false,
};

const REFRESH_MS = 5 * 60 * 1000;

const selectors = {
  countrySelect: document.getElementById('country-select'),
  timeRange: document.getElementById('time-range'),
  priceFilter: document.getElementById('price-filter'),
  tabs: document.getElementById('tabs'),
  content: document.getElementById('content'),
  lastUpdated: document.getElementById('last-updated'),
  empty: document.getElementById('empty'),
  refreshButton: document.getElementById('refresh-country'),
};

function formatDate(value) {
  if (!value) {
    return 'Unknown';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  return date.toLocaleString();
}

function buildCountryOptions(countries) {
  selectors.countrySelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a country';
  selectors.countrySelect.append(placeholder);
  countries.forEach((country) => {
    const option = document.createElement('option');
    option.value = country.code;
    option.textContent = country.name ?? country.code;
    selectors.countrySelect.append(option);
  });
}

function updateLastUpdated() {
  if (!state.activeCountry) {
    selectors.lastUpdated.textContent = 'Select a country';
    return;
  }
  const entries = state.summary?.countries ?? [];
  const active = entries.find((entry) => entry.code === state.activeCountry);
  const timestamp =
    active?.apple?.updatedAt || active?.google?.updatedAt || state.summary?.generatedAt;
  selectors.lastUpdated.textContent = formatDate(timestamp);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withLoading(task, minMs = 200) {
  if (state.isLoading) {
    return task();
  }
  state.isLoading = true;
  render();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const start = Date.now();
  const result = await task();
  const elapsed = Date.now() - start;
  if (elapsed < minMs) {
    await delay(minMs - elapsed);
  }
  state.isLoading = false;
  render();
  return result;
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json();
}

async function loadSummary() {
  await withLoading(async () => {
    const summary = await fetchJson('/api/summary');
    state.summary = summary;
    const countries = summary.countries ?? [];
    buildCountryOptions(countries);
    state.activeCountry = null;
    selectors.countrySelect.value = '';
    updateLastUpdated();
  }, 400);
}

async function loadCountryData(country) {
  if (!country || state.dataCache.has(country)) {
    return;
  }
  const payload = await fetchJson(`/api/country/${country}`).catch(() => null);
  if (!payload) {
    state.dataCache.set(country, { apple: null, google: null });
    return;
  }
  state.dataCache.set(country, { apple: payload.apple, google: payload.google });
}

async function refreshActiveCountry() {
  if (!state.activeCountry) {
    return;
  }
  const button = selectors.refreshButton;
  const previousLabel = button?.textContent ?? '';
  if (button) {
    button.disabled = true;
    button.textContent = 'Refreshing...';
  }

  try {
    await withLoading(async () => {
      const payload = await fetchJson(`/api/country/${state.activeCountry}?refresh=1`);
      state.dataCache.set(state.activeCountry, {
        apple: payload.apple ?? null,
        google: payload.google ?? null,
      });
      const summary = await fetchJson('/api/summary');
      state.summary = summary;
      updateLastUpdated();
    });
  } catch (error) {
    console.warn('Manual refresh failed', error);
    const message = renderMessage(`Refresh failed: ${error.message}`, 'error');
    selectors.content.prepend(message);
  }

  if (button) {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

function getActiveDataset() {
  const store = state.activeTab.startsWith('apple') ? 'apple' : 'google';
  const type = state.activeTab.endsWith('new') ? 'new' : 'updated';
  const countryData = state.dataCache.get(state.activeCountry) || {};
  const data = countryData[store];
  return {
    store,
    type,
    data,
  };
}

function filterByDate(items, range) {
  if (range === 'all') {
    return items;
  }
  const now = Date.now();
  const limitMs =
    range === '24h'
      ? 24 * 60 * 60 * 1000
      : range === '7d'
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;

  return items.filter((item) => {
    if (!item.releaseDate) {
      return false;
    }
    const timestamp = new Date(item.releaseDate).getTime();
    return now - timestamp <= limitMs;
  });
}

function filterByPrice(items, filter) {
  if (filter === 'all') {
    return items;
  }
  return items.filter((item) => (filter === 'free' ? item.isFree : !item.isFree));
}

function render() {
  const { store, type, data } = getActiveDataset();
  selectors.content.innerHTML = '';

  if (state.isLoading) {
    selectors.content.append(renderMessage('Loading data...', 'loading'));
    return;
  }

  if (!state.activeCountry) {
    selectors.content.append(renderMessage('Select a country to load store data.', 'empty'));
    return;
  }

  if (!data) {
    selectors.content.append(renderMessage('No data for this country yet.', 'empty'));
    return;
  }

  if (data.errors && data.errors.length > 0) {
    const message = document.createElement('div');
    message.className = 'error';
    message.textContent = `Some data failed to load (${data.errors.length} errors).`;
    selectors.content.append(message);
  }

  const items = data[type] ?? [];
  const filtered = filterByPrice(filterByDate(items, selectors.timeRange.value), selectors.priceFilter.value);

  if (filtered.length === 0) {
    selectors.content.append(
      renderMessage(`No ${type} ${store} apps match these filters.`, 'empty')
    );
    return;
  }

  filtered.forEach((item) => selectors.content.append(renderCard(item)));
}

function renderMessage(text, className) {
  const message = document.createElement('div');
  message.className = className;
  message.textContent = text;
  return message;
}

function renderCard(item) {
  const card = document.createElement('article');
  card.className = 'card';

  const image = document.createElement('img');
  image.src = item.artwork;
  image.alt = `${item.name} artwork`;

  const title = document.createElement('h3');
  title.textContent = item.name;

  const developer = document.createElement('p');
  developer.textContent = item.developer ?? 'Unknown developer';

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML = `
    <span>${item.isFree ? 'Free' : 'Paid'}</span>
    <span>${item.genres?.[0] ?? 'Games'}</span>
    <span>${formatDate(item.releaseDate)}</span>
  `;

  const link = document.createElement('a');
  link.href = item.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Open in store';

  card.append(image, title, developer, meta, link);
  return card;
}

selectors.countrySelect.addEventListener('change', async (event) => {
  await withLoading(async () => {
    const nextCountry = event.target.value;
    state.activeCountry = nextCountry || null;
    if (!state.activeCountry) {
      updateLastUpdated();
      return;
    }
    state.dataCache.delete(state.activeCountry);
    await loadCountryData(state.activeCountry);
    updateLastUpdated();
  });
});

selectors.timeRange.addEventListener('change', () => {
  withLoading(async () => {}, 150);
});
selectors.priceFilter.addEventListener('change', () => {
  withLoading(async () => {}, 150);
});

selectors.tabs.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-tab]');
  if (!button) {
    return;
  }
  selectors.tabs.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
  button.classList.add('active');
  state.activeTab = button.dataset.tab;
  withLoading(async () => {}, 150);
});

selectors.refreshButton?.addEventListener('click', refreshActiveCountry);

loadSummary().catch((error) => {
  selectors.content.innerHTML = '';
  const message = renderMessage(`Failed to load summary: ${error.message}`, 'error');
  selectors.content.append(message);
});

setInterval(async () => {
  if (!state.activeCountry) {
    return;
  }
  try {
    const summary = await fetchJson('/api/summary');
    state.summary = summary;
    state.dataCache.delete(state.activeCountry);
    await loadCountryData(state.activeCountry);
    updateLastUpdated();
    render();
  } catch (error) {
    console.warn('Auto-refresh failed', error);
  }
}, REFRESH_MS);
