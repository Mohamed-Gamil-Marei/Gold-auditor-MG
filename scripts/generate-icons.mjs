import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generates a clean 64x64 Gold Audit PNG icon and wraps it into a valid Windows .ico file
 * in build/icon.png and build/icon.ico using built-in Node.js modules only.
 */
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff];
  }
  return (c ^ -1) >>> 0;
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function generateGoldIconPng(size = 64) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawData = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    rawData[rowStart] = 0; // no filter
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      const dx = x - size / 2;
      const dy = y - size / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > size * 0.46) {
        // Transparent corners
        rawData[px] = 0;
        rawData[px + 1] = 0;
        rawData[px + 2] = 0;
        rawData[px + 3] = 0;
      } else if (dist > size * 0.38) {
        // Dark slate border
        rawData[px] = 15;
        rawData[px + 1] = 23;
        rawData[px + 2] = 42;
        rawData[px + 3] = 255;
      } else {
        // Warm metallic gold gradient
        rawData[px] = 245;
        rawData[px + 1] = Math.max(145, 195 - Math.floor((y / size) * 50));
        rawData[px + 2] = 11;
        rawData[px + 3] = 255;
      }
    }
  }

  const idat = zlib.deflateSync(rawData);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngToIco(pngBuffer, size = 64) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // ICO type
  header.writeUInt16LE(1, 4); // 1 image

  const dir = Buffer.alloc(16);
  dir[0] = size === 256 ? 0 : size;
  dir[1] = size === 256 ? 0 : size;
  dir[2] = 0;
  dir[3] = 0;
  dir.writeUInt16LE(1, 4); // Color planes
  dir.writeUInt16LE(32, 6); // Bits per pixel
  dir.writeUInt32LE(pngBuffer.length, 8); // Size of PNG data
  dir.writeUInt32LE(22, 12); // Offset (6 + 16)

  return Buffer.concat([header, dir, pngBuffer]);
}

const buildDir = path.join(__dirname, '../build');
fs.mkdirSync(buildDir, { recursive: true });

const png = generateGoldIconPng(256);
const ico = pngToIco(png, 256);

fs.writeFileSync(path.join(buildDir, 'icon.png'), png);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);
console.log('Generated 256x256 build/icon.png and build/icon.ico successfully.');
