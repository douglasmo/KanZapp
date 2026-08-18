/**
 * Converte PNG para 24 bits sem canal alfa (color type 2).
 *
 * A Chrome Web Store exige "PNG de 24 bits (sem alfa)" nos prints e blocos
 * promocionais, e o Chrome headless grava RGBA (color type 6). O upload é
 * recusado com uma mensagem genérica, então a conversão tem de ser explícita.
 *
 * Pixels com transparência são compostos sobre um fundo opaco (branco por
 * padrão) — descartar o alfa sem compor deixaria halo escuro nas bordas.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function readChunks(buffer) {
  if (!buffer.slice(0, 8).equals(SIGNATURE)) throw new Error('não é um PNG');
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.slice(offset + 4, offset + 8).toString('latin1');
    const data = buffer.slice(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Desfaz os filtros por scanline (PNG spec 9.2). */
function unfilter(raw, width, height, channels) {
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = raw.slice(pos, pos + stride);
    pos += stride;
    const target = out.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x += 1) {
      const rawByte = line[x];
      const left = x >= channels ? target[x - channels] : 0;
      const up = prev ? prev[x] : 0;
      const upLeft = prev && x >= channels ? prev[x - channels] : 0;
      let value;
      if (filter === 0) value = rawByte;
      else if (filter === 1) value = rawByte + left;
      else if (filter === 2) value = rawByte + up;
      else if (filter === 3) value = rawByte + ((left + up) >> 1);
      else if (filter === 4) value = rawByte + paeth(left, up, upLeft);
      else throw new Error(`filtro PNG desconhecido: ${filter}`);
      target[x] = value & 0xff;
    }
  }
  return out;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.slice(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * @returns {{width:number, height:number, hadAlpha:boolean}}
 */
export function toRgbPng(sourcePath, targetPath, { background = [255, 255, 255] } = {}) {
  const chunks = readChunks(fs.readFileSync(sourcePath));
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('PNG sem IHDR');

  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (bitDepth !== 8) throw new Error(`profundidade não suportada: ${bitDepth}`);
  if (interlace !== 0) throw new Error('PNG entrelaçado não suportado');

  const channelsByType = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const channels = channelsByType[colorType];
  if (!channels) throw new Error(`color type não suportado: ${colorType}`);

  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const pixels = unfilter(zlib.inflateSync(idat), width, height, channels);

  // monta RGB, compondo sobre o fundo quando houver alfa
  const rgb = Buffer.alloc(width * height * 3);
  const hasAlpha = colorType === 4 || colorType === 6;
  let sawTransparency = false;
  for (let i = 0, p = 0; i < width * height; i += 1) {
    const base = i * channels;
    let r;
    let g;
    let b;
    let a = 255;
    if (colorType === 0) { r = g = b = pixels[base]; }
    else if (colorType === 4) { r = g = b = pixels[base]; a = pixels[base + 1]; }
    else if (colorType === 2) { r = pixels[base]; g = pixels[base + 1]; b = pixels[base + 2]; }
    else { r = pixels[base]; g = pixels[base + 1]; b = pixels[base + 2]; a = pixels[base + 3]; }

    if (hasAlpha && a < 255) {
      sawTransparency = true;
      const alpha = a / 255;
      r = Math.round(r * alpha + background[0] * (1 - alpha));
      g = Math.round(g * alpha + background[1] * (1 - alpha));
      b = Math.round(b * alpha + background[2] * (1 - alpha));
    }
    rgb[p] = r; rgb[p + 1] = g; rgb[p + 2] = b;
    p += 3;
  }

  // reencoda com filtro 0 por linha (simples e suficiente para capturas de tela)
  const stride = width * 3;
  const withFilters = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    withFilters[y * (stride + 1)] = 0;
    rgb.copy(withFilters, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdrOut = Buffer.alloc(13);
  ihdrOut.writeUInt32BE(width, 0);
  ihdrOut.writeUInt32BE(height, 4);
  ihdrOut[8] = 8;
  ihdrOut[9] = 2;   // truecolor, sem alfa
  ihdrOut[10] = 0;
  ihdrOut[11] = 0;
  ihdrOut[12] = 0;

  fs.writeFileSync(targetPath, Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdrOut),
    chunk('IDAT', zlib.deflateSync(withFilters, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]));

  return { width, height, hadAlpha: hasAlpha, composited: sawTransparency };
}

/** Lê só o cabeçalho: serve para conferir o que foi gravado. */
export function inspect(file) {
  const ihdr = readChunks(fs.readFileSync(file)).find((c) => c.type === 'IHDR');
  return {
    width: ihdr.data.readUInt32BE(0),
    height: ihdr.data.readUInt32BE(4),
    bitDepth: ihdr.data[8],
    colorType: ihdr.data[9],
    hasAlpha: ihdr.data[9] === 4 || ihdr.data[9] === 6
  };
}
