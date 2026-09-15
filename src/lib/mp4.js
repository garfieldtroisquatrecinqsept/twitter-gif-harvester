function boxType(view, offset) {
  return (
    String.fromCharCode(view.getUint8(offset)) +
    String.fromCharCode(view.getUint8(offset + 1)) +
    String.fromCharCode(view.getUint8(offset + 2)) +
    String.fromCharCode(view.getUint8(offset + 3))
  );
}

function walk(view, start, end, visit) {
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = boxType(view, offset + 4);
    let headerSize = 8;

    if (size === 1) {
      if (offset + 16 > end) break;
      const high = view.getUint32(offset + 8);
      const low = view.getUint32(offset + 12);
      size = high * 4294967296 + low;
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }

    if (size < headerSize || offset + size > end) break;
    visit(type, offset + headerSize, offset + size);
    offset += size;
  }
}

function findBox(view, start, end, path) {
  let found = null;
  walk(view, start, end, (type, contentStart, contentEnd) => {
    if (found || type !== path[0]) return;
    if (path.length === 1) {
      found = { start: contentStart, end: contentEnd };
    } else {
      found = findBox(view, contentStart, contentEnd, path.slice(1));
    }
  });
  return found;
}

function readMdhd(view, box) {
  const version = view.getUint8(box.start);
  if (version === 1) {
    return { timescale: view.getUint32(box.start + 20) };
  }
  return { timescale: view.getUint32(box.start + 12) };
}

function readStts(view, box, timescale, maxSamples) {
  const entryCount = view.getUint32(box.start + 4);
  const durations = [];
  let offset = box.start + 8;
  for (let i = 0; i < entryCount; i++) {
    if (offset + 8 > box.end) break;
    const sampleCount = view.getUint32(offset);
    const sampleDelta = view.getUint32(offset + 4);
    offset += 8;
    for (let s = 0; s < sampleCount; s++) {
      durations.push(sampleDelta / timescale);
      if (durations.length >= maxSamples) return durations;
    }
  }
  return durations;
}

export function parseMp4Timing(buffer, maxSamples = 3000) {
  /**
   * Extrait les durees d'image exactes de la piste video d'un MP4 non fragmente.
   * Retourne null si le conteneur n'est pas exploitable.
   */
  const view = new DataView(buffer);
  const moov = findBox(view, 0, view.byteLength, ['moov']);
  if (!moov) return null;

  let result = null;

  walk(view, moov.start, moov.end, (type, trakStart, trakEnd) => {
    if (result || type !== 'trak') return;

    const hdlr = findBox(view, trakStart, trakEnd, ['mdia', 'hdlr']);
    if (!hdlr) return;
    if (boxType(view, hdlr.start + 8) !== 'vide') return;

    const mdhd = findBox(view, trakStart, trakEnd, ['mdia', 'mdhd']);
    const stts = findBox(view, trakStart, trakEnd, ['mdia', 'minf', 'stbl', 'stts']);
    if (!mdhd || !stts) return;

    const { timescale } = readMdhd(view, mdhd);
    if (!timescale) return;

    const durations = readStts(view, stts, timescale, maxSamples);
    if (durations.length < 2) return;

    let total = 0;
    for (const d of durations) total += d;
    if (!(total > 0)) return;

    result = { timescale, durations, duration: total, frameCount: durations.length };
  });

  return result;
}
