import { readFileSync, writeFileSync } from 'fs';
import * as font from './src/font.js';
import * as opentype from 'opentype.js';

const toAb = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const f = font.importTTF(toAb(readFileSync('C:/Windows/Fonts/arialbd.ttf')), 'a');

// export unchanged → reparse → dump 'A' path as SVG
const buf = font.exportTTF(f);
writeFileSync('C:/Users/liagi/Desktop/grotto_test.ttf', Buffer.from(buf));
const back = opentype.parse(buf);
console.log('names:', JSON.stringify(back.names.fontFamily));
console.log('glyphs count:', back.glyphs.length);
console.log('space idx:', back.charToGlyphIndex(' '), '| A idx:', back.charToGlyphIndex('A'));

const p = back.charToGlyph('A').getPath(0, 0, 72);
writeFileSync('C:/Users/liagi/Desktop/glyph_export.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120"><path d="${p.toPathData(2)}" fill="black"/></svg>`);

// winding check on exported A: outer CW(negative area in y-up?) 
const gA = back.charToGlyph('A');
console.log('A contours:', gA.path.commands.filter((c) => c.type === 'M').length);
console.log('ok');
