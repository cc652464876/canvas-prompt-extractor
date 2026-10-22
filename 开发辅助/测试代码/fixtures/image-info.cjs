'use strict';
const zlib = require('node:zlib');
function chunk(type, data) {
  const tag = Buffer.from(type),
    header = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  let sum = 0xffffffff;
  for (const byte of Buffer.concat([tag, data])) {
    sum ^= byte;
    for (let i = 0; i < 8; i++) sum = (sum >>> 1) ^ (sum & 1 ? 0xedb88320 : 0);
  }
  crc.writeUInt32BE((sum ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, tag, data, crc]);
}
function png(text, { key = 'Description', type = 'tEXt' } = {}) {
  const base = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
    'base64'
  );
  let data = Buffer.from(text, 'utf8');
  if (type === 'zTXt') data = Buffer.concat([Buffer.from([0]), zlib.deflateSync(data)]);
  if (type === 'iTXt') data = Buffer.concat([Buffer.from([0, 0, 0, 0]), data]);
  // Deliberately after IDAT: fast2 would miss this prompt.
  return Buffer.concat([
    base.subarray(0, -12),
    chunk(type, Buffer.concat([Buffer.from(key + '\0'), data])),
    base.subarray(-12)
  ]);
}
module.exports = { png, chunk };
