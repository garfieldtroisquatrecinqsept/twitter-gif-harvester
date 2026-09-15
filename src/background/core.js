const api = globalThis.browser || globalThis.chrome;

export const DEFAULTS = {
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

const jobs = new Map();

async function getSettings() {
  const stored = await api.storage.sync.get(DEFAULTS);
  return Object.assign({}, DEFAULTS, stored);
}

function sanitize(part) {
  return String(part == null ? '' : part)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function mediaIdFrom(url) {
  const match = /\/tweet_video\/([A-Za-z0-9_-]+)\.mp4/.exec(url || '');
  return match ? match[1] : 'gif';
}

export function buildFilename(settings, meta, sourceUrl) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const tokens = {
    screen_name: sanitize(meta.screenName || 'twitter'),
    tweet_id: sanitize(meta.tweetId || 'unknown'),
    index: String(meta.index == null ? 1 : meta.index),
    media_id: sanitize(mediaIdFrom(sourceUrl)),
    date: `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    time: `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  };
  let name = String(settings.pattern || DEFAULTS.pattern).replace(
    /\{(\w+)\}/g,
    (whole, key) => (key in tokens ? tokens[key] : whole)
  );
  name = sanitize(name) || 'twitter-gif';
  const folder = sanitize(settings.subfolder);
  return (folder ? folder + '/' : '') + name + '.gif';
}

function metaFromUrl(pageUrl) {
  const match = /(?:x|twitter)\.com\/([^/]+)\/status\/(\d+)/.exec(pageUrl || '');
  if (!match) return {};
  return { screenName: match[1], tweetId: match[2], index: 1 };
}

function gifUrlFromCandidate(candidate) {
  const value = candidate || '';
  if (value.indexOf('/tweet_video/') !== -1) return value.split('?')[0];
  const thumb = /tweet_video_thumb\/([A-Za-z0-9_-]+)\./.exec(value);
  if (thumb) return 'https://video.twimg.com/tweet_video/' + thumb[1] + '.mp4';
  return null;
}

async function recordHistory(entry) {
  const { history = [] } = await api.storage.local.get({ history: [] });
  history.unshift(entry);
  await api.storage.local.set({ history: history.slice(0, 25) });
}

export function createHarvester(adapter) {
  /**
   * Logique commune aux deux navigateurs. L'adaptateur fournit la conversion,
   * qui se fait dans un document offscreen sur Chrome et dans la page de fond sur Firefox.
   */
  async function runJob(sourceUrl, meta, tabId) {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const settings = await getSettings();
    jobs.set(jobId, { tabId, sourceUrl });

    const notify = (payload) => {
      if (tabId == null) return;
      const message = Object.assign({ jobId, sourceUrl }, payload);
      Promise.resolve(api.tabs.sendMessage(tabId, message)).catch(() => {});
    };

    notify({ type: 'gifharvest:progress', percent: 0 });

    try {
      const result = await adapter.convert(
        {
          jobId,
          url: sourceUrl,
          options: {
            maxFps: Number(settings.maxFps),
            maxWidth: Number(settings.maxWidth),
            maxHeight: Number(settings.maxHeight),
            dither: Boolean(settings.dither),
            tolerance: Number(settings.tolerance),
            loop: Boolean(settings.loop)
          }
        },
        (percent) => notify({ type: 'gifharvest:progress', percent })
      );

      const filename = buildFilename(settings, meta || {}, sourceUrl);
      try {
        await api.downloads.download({
          url: result.blobUrl,
          filename,
          saveAs: Boolean(settings.askWhereToSave)
        });
      } finally {
        setTimeout(() => adapter.release(result.blobUrl), 60000);
      }

      await recordHistory({
        filename,
        size: result.size,
        width: result.width,
        height: result.height,
        frames: result.frames,
        at: Date.now(),
        tweetId: meta && meta.tweetId ? meta.tweetId : null,
        screenName: meta && meta.screenName ? meta.screenName : null
      });

      notify({ type: 'gifharvest:done', filename, size: result.size, frames: result.frames });
      return { filename, size: result.size };
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      notify({ type: 'gifharvest:error', message });
      throw error;
    } finally {
      jobs.delete(jobId);
    }
  }

  function reportProgress(jobId, percent) {
    const job = jobs.get(jobId);
    if (!job || job.tabId == null) return;
    Promise.resolve(
      api.tabs.sendMessage(job.tabId, {
        type: 'gifharvest:progress',
        jobId,
        sourceUrl: job.sourceUrl,
        percent
      })
    ).catch(() => {});
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'gifharvest:download') return;
    const tabId = sender.tab ? sender.tab.id : null;
    runJob(message.url, message.meta, tabId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({ ok: false, error: String(error && error.message ? error.message : error) })
      );
    return true;
  });

  api.runtime.onInstalled.addListener(() => {
    api.contextMenus.removeAll(() => {
      api.contextMenus.create({
        id: 'gifharvest-download',
        title: 'Telecharger ce GIF (.gif)',
        contexts: ['video', 'image', 'link'],
        documentUrlPatterns: ['https://x.com/*', 'https://twitter.com/*']
      });
    });
  });

  api.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'gifharvest-download') return;
    let url = gifUrlFromCandidate(info.srcUrl) || gifUrlFromCandidate(info.linkUrl);
    if (!url && tab && tab.id != null) {
      const found = await Promise.resolve(
        api.tabs.sendMessage(tab.id, { type: 'gifharvest:resolve-context' })
      ).catch(() => null);
      if (found && found.url) url = found.url;
    }
    if (!url) return;
    runJob(url, tab && tab.url ? metaFromUrl(tab.url) : {}, tab ? tab.id : null).catch(() => {});
  });

  return { runJob, reportProgress };
}
