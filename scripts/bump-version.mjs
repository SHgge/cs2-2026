// Шинэ хувилбарын дугаар (кэш шинэчлэх): config.js-ийн BUILD ба index.html-ийн ?v= утгыг солино.
// Ашиглах: node scripts/bump-version.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const now = new Date(Date.now() + 8 * 3600 * 1000); // Asia/Ulaanbaatar
const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');

const cfgPath = join(root, 'js', 'config.js');
const cfg = readFileSync(cfgPath, 'utf8');
const nextCfg = cfg.replace(/export const BUILD = '[^']*';/, `export const BUILD = '${stamp}';`);
if (nextCfg === cfg) throw new Error('BUILD constant not found in config.js');
writeFileSync(cfgPath, nextCfg);

const idxPath = join(root, 'index.html');
const idx = readFileSync(idxPath, 'utf8');
const nextIdx = idx.replace(/\?v=[0-9A-Za-z.\-]+/g, `?v=${stamp}`);
writeFileSync(idxPath, nextIdx);
console.log(`BUILD = ${stamp}`);
