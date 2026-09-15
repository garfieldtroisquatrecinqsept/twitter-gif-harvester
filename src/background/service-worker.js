import { createHarvester } from './core.js';

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';

let offscreenReady = null;

async function ensureOffscreen() {
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async () => {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts.length > 0) return;
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['BLOBS'],
        justification: 'Decodage video et encodage GIF hors du service worker.'
      });
    } catch (error) {
      if (!String(error).includes('Only a single offscreen')) throw error;
    }
  })();
  try {
    await offscreenReady;
  } catch (error) {
    offscreenReady = null;
    throw error;
  }
  return offscreenReady;
}

const harvester = createHarvester({
  async convert(job) {
    await ensureOffscreen();
    const response = await chrome.runtime.sendMessage({
      type: 'offscreen:convert',
      jobId: job.jobId,
      url: job.url,
      options: job.options
    });
    if (!response || !response.ok) {
      throw new Error((response && response.error) || 'Conversion impossible');
    }
    return response;
  },

  release(blobUrl) {
    chrome.runtime.sendMessage({ type: 'offscreen:release', blobUrl }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== 'job:progress') return;
  harvester.reportProgress(message.jobId, message.percent);
});
