class ByteWriter {
  constructor(capacity = 1 << 18) {
    this.buf = new Uint8Array(capacity);
    this.len = 0;
  }

  ensure(extra) {
    if (this.len + extra <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  byte(value) {
    this.ensure(1);
    this.buf[this.len++] = value & 0xff;
  }

  bytes(arr) {
    this.ensure(arr.length);
    this.buf.set(arr, this.len);
    this.len += arr.length;
  }

  short(value) {
    this.byte(value);
    this.byte(value >> 8);
  }

  ascii(text) {
    for (let i = 0; i < text.length; i++) this.byte(text.charCodeAt(i));
  }

  patchShort(offset, value) {
    this.buf[offset] = value & 0xff;
    this.buf[offset + 1] = (value >> 8) & 0xff;
  }

  result() {
    return this.buf.slice(0, this.len);
  }
}

function lzwEncode(out, indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let dict = new Map();

  const block = new Uint8Array(255);
  let blockLen = 0;
  let bitBuffer = 0;
  let bitCount = 0;

  const flushBlock = () => {
    if (blockLen === 0) return;
    out.byte(blockLen);
    out.bytes(block.subarray(0, blockLen));
    blockLen = 0;
  };

  const emit = (code) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      block[blockLen++] = bitBuffer & 0xff;
      bitBuffer >>>= 8;
      bitCount -= 8;
      if (blockLen === 255) flushBlock();
    }
  };

  out.byte(minCodeSize);
  emit(clearCode);

  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (nextCode < 4096) {
      dict.set(key, nextCode);
      nextCode++;
      if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      emit(clearCode);
      dict = new Map();
      nextCode = endCode + 1;
      codeSize = minCodeSize + 1;
    }
    prefix = k;
  }

  emit(prefix);
  emit(endCode);

  if (bitCount > 0) {
    block[blockLen++] = bitBuffer & 0xff;
    if (blockLen === 255) flushBlock();
  }
  flushBlock();
  out.byte(0);
}

function bitsFor(colorCount) {
  let bits = 2;
  while (1 << bits < colorCount) bits++;
  return Math.min(bits, 8);
}

export class GifWriter {
  /**
   * Assembleur de fichier GIF89a anime, palette locale par image.
   */
  constructor(width, height, loopCount = 0) {
    this.width = width;
    this.height = height;
    this.out = new ByteWriter();
    this.lastDelayOffset = -1;
    this.lastDelayValue = 0;
    this.frameCount = 0;
    this.writeHeader(loopCount);
  }

  writeHeader(loopCount) {
    const out = this.out;
    out.ascii('GIF89a');
    out.short(this.width);
    out.short(this.height);
    out.byte(0x70);
    out.byte(0);
    out.byte(0);
    out.byte(0x21);
    out.byte(0xff);
    out.byte(0x0b);
    out.ascii('NETSCAPE2.0');
    out.byte(0x03);
    out.byte(0x01);
    out.short(loopCount);
    out.byte(0x00);
  }

  addFrame(frame) {
    const { indices, palette, colorCount, x, y, width, height, delayCs, transparentIndex } = frame;
    const out = this.out;
    const bits = bitsFor(Math.max(colorCount, transparentIndex >= 0 ? transparentIndex + 1 : 1));
    const tableSize = 1 << bits;

    out.byte(0x21);
    out.byte(0xf9);
    out.byte(0x04);
    out.byte((1 << 2) | (transparentIndex >= 0 ? 1 : 0));
    this.lastDelayOffset = out.len;
    this.lastDelayValue = delayCs;
    out.short(delayCs);
    out.byte(transparentIndex >= 0 ? transparentIndex : 0);
    out.byte(0x00);

    out.byte(0x2c);
    out.short(x);
    out.short(y);
    out.short(width);
    out.short(height);
    out.byte(0x80 | (bits - 1));

    const table = new Uint8Array(tableSize * 3);
    table.set(palette.subarray(0, Math.min(palette.length, tableSize * 3)));
    out.bytes(table);

    lzwEncode(out, indices, Math.max(2, bits));
    this.frameCount++;
  }

  extendLastDelay(extraCs) {
    if (this.lastDelayOffset < 0) return;
    this.lastDelayValue = Math.min(65535, this.lastDelayValue + extraCs);
    this.out.patchShort(this.lastDelayOffset, this.lastDelayValue);
  }

  finish() {
    this.out.byte(0x3b);
    return this.out.result();
  }
}
