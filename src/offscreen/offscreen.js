import { convertToGif } from '../lib/convert.js';

const activeUrls = new Set();

async function handleConvert(message) {
  const { jobId, url, options } = message;
  const result = await convertToGif(url, options, (percent) => {
    chrome.runtime.sendMessage({ type: 'job:progress', jobId, percent }).catch(() => {});
  });
  const blob = new Blob([result.bytes], { type: 'image/gif' });
  const blobUrl = URL.createObjectURL(blob);
  activeUrls.add(blobUrl);
  return {
    blobUrl,
    size: blob.size,
    width: result.width,
    height: result.height,
    frames: result.frames,
    fps: result.fps
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return;
  if (!message.type.startsWith('offscreen:')) return;

  if (message.type === 'offscreen:convert') {
    handleConvert(message)
      .then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((error) => sendResponse({ ok: false, error: String(error && error.message ? error.message : error) }));
    return true;
  }

  if (message.type === 'offscreen:release') {
    if (activeUrls.has(message.blobUrl)) {
      URL.revokeObjectURL(message.blobUrl);
      activeUrls.delete(message.blobUrl);
    }
    sendResponse({ ok: true });
    return true;
  }
});
