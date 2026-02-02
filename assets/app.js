const state = {
  summary: null,
  dataCache: new Map(),
  activeTab: 'apple-new',
  activeCountry: null,
};

const selectors = {
  countrySelect: document.getElementById('country-select'),
  timeRange: document.getElementById('time-range'),
  priceFilter: document.getElementById('price-filter'),
  tabs: document.getElementById('tabs'),
  content: document.getElementById('content'),
  lastUpdated: document.getElementById('last-updated'),
  empty: document.getElementById('empty'),
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
  countries.forEach((country) => {
    const option = document.createElement('option');
    option.value = country.code;
    option.textContent = country.code;
    selectors.countrySelect.append(option);
  });
}

function updateLastUpdated() {
  const entries = state.summary?.countries ?? [];
  const active = entries.find((entry) => entry.code === state.activeCountry);
  const timestamp =
    active?.apple?.updatedAt || active?.google?.updatedAt || state.summary?.generatedAt;
  selectors.lastUpdated.textContent = formatDate(timestamp);
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json();
}

async function loadSummary() {
  const summary = await fetchJson('data/global_summary.json');
  state.summary = summary;
  const countries = summary.countries ?? [];
  buildCountryOptions(countries);
  state.activeCountry = countries[0]?.code ?? null;
  selectors.countrySelect.value = state.activeCountry;
  updateLastUpdated();
  await loadCountryData(state.activeCountry);
  render();
}

async function loadCountryData(country) {
  if (!country || state.dataCache.has(country)) {
    return;
  }
  const [appleData, googleData] = await Promise.all([
    fetchJson(`data/apple/${country}.json`).catch(() => null),
    fetchJson(`data/google/${country}.json`).catch(() => null),
  ]);
  state.dataCache.set(country, { apple: appleData, google: googleData });
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
  state.activeCountry = event.target.value;
  await loadCountryData(state.activeCountry);
  updateLastUpdated();
  render();
});

selectors.timeRange.addEventListener('change', render);
selectors.priceFilter.addEventListener('change', render);

selectors.tabs.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-tab]');
  if (!button) {
    return;
  }
  selectors.tabs.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
  button.classList.add('active');
  state.activeTab = button.dataset.tab;
  render();
});

loadSummary().catch((error) => {
  selectors.content.innerHTML = '';
  const message = renderMessage(`Failed to load summary: ${error.message}`, 'error');
  selectors.content.append(message);
});
