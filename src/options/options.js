const api = globalThis.browser || globalThis.chrome;

const DEFAULTS = {
  maxFps: 25,
  maxWidth: 640,
  maxHeight: 640,
  dither: true,
  tolerance: 8,
  loop: true,
  subfolder: 'TwitterGifHarvest',
  pattern: '{screen_name}-{tweet_id}-{index}',
  askWhereToSave: false
};

const FIELDS = Object.keys(DEFAULTS);

function fill(values) {
  for (const key of FIELDS) {
    const input = document.getElementById(key);
    if (!input) continue;
    if (input.type === 'checkbox') {
      input.checked = Boolean(values[key]);
    } else {
      input.value = values[key];
    }
  }
}

function collect() {
  const values = {};
  for (const key of FIELDS) {
    const input = document.getElementById(key);
    if (!input) continue;
    if (input.type === 'checkbox') {
      values[key] = input.checked;
    } else if (input.type === 'number') {
      const parsed = Number(input.value);
      values[key] = isFinite(parsed) ? parsed : DEFAULTS[key];
    } else {
      values[key] = input.value.trim();
    }
  }
  values.maxFps = Math.min(50, Math.max(5, values.maxFps));
  values.maxWidth = Math.min(1920, Math.max(120, values.maxWidth));
  values.maxHeight = Math.min(1920, Math.max(120, values.maxHeight));
  values.tolerance = Math.min(40, Math.max(0, values.tolerance));
  if (!values.pattern) values.pattern = DEFAULTS.pattern;
  return values;
}

function flashStatus() {
  const status = document.getElementById('status');
  status.classList.add('visible');
  setTimeout(() => status.classList.remove('visible'), 1600);
}

api.storage.sync.get(DEFAULTS).then((stored) => fill(Object.assign({}, DEFAULTS, stored)));

document.getElementById('save').addEventListener('click', async () => {
  const values = collect();
  await api.storage.sync.set(values);
  fill(values);
  flashStatus();
});

document.getElementById('reset').addEventListener('click', async () => {
  await api.storage.sync.set(DEFAULTS);
  fill(DEFAULTS);
  flashStatus();
});
