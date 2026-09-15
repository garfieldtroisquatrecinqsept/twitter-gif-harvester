const api = globalThis.browser || globalThis.chrome;

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' Ko';
  return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');
  return pad(date.getHours()) + ':' + pad(date.getMinutes());
}

async function render() {
  const list = document.getElementById('history');
  const { history = [] } = await api.storage.local.get({ history: [] });

  list.replaceChildren();

  if (!history.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'Aucun GIF telecharge pour le moment.';
    list.appendChild(empty);
    return;
  }

  for (const entry of history) {
    const item = document.createElement('li');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = entry.filename;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const parts = [formatTime(entry.at)];
    if (entry.width && entry.height) parts.push(entry.width + 'x' + entry.height);
    if (entry.frames) parts.push(entry.frames + ' images');
    if (entry.size) parts.push(formatSize(entry.size));
    meta.textContent = parts.join(' | ');
    item.appendChild(name);
    item.appendChild(meta);
    list.appendChild(item);
  }
}

const REQUIRED_ORIGINS = [
  'https://x.com/*',
  'https://twitter.com/*',
  'https://video.twimg.com/*',
  'https://pbs.twimg.com/*'
];

async function checkPermissions() {
  if (!api.permissions || !api.permissions.contains) return;
  let granted = true;
  try {
    granted = await api.permissions.contains({ origins: REQUIRED_ORIGINS });
  } catch (error) {
    return;
  }
  if (granted) return;

  const banner = document.getElementById('grant');
  banner.style.display = 'block';
  document.getElementById('grantButton').addEventListener('click', async () => {
    const accepted = await api.permissions.request({ origins: REQUIRED_ORIGINS }).catch(() => false);
    if (accepted) banner.style.display = 'none';
  });
}

document.getElementById('options').addEventListener('click', (event) => {
  event.preventDefault();
  api.runtime.openOptionsPage();
});

render();
checkPermissions();
