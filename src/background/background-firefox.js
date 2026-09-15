import { createHarvester } from './core.js';
import { convertToGif } from '../lib/convert.js';

const activeUrls = new Set();

createHarvester({
  async convert(job, onProgress) {
    const result = await convertToGif(job.url, job.options, onProgress);
    const blob = new Blob([result.bytes], { type: 'image/gif' });
    const blobUrl = URL.createObjectURL(blob);
    activeUrls.add(blobUrl);
    return {
      blobUrl,
      size: blob.size,
      width: result.width,
      height: result.height,
      frames: result.frames
    };
  },

  release(blobUrl) {
    if (!activeUrls.has(blobUrl)) return;
    URL.revokeObjectURL(blobUrl);
    activeUrls.delete(blobUrl);
  }
});
