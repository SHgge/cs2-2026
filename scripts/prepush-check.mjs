// Push-ээс өмнөх шалгалт: нийтийн repo-д нууц, хувийн мэдээлэл, дотоод файл орохоос сэргийлнэ.
// Ашиглах: node scripts/prepush-check.mjs   (алдаа олдвол exit code 1)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, extname } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'output', 'test-results', 'playwright-report'].includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p); else check(p);
  }
}

const TEXT = new Set(['.js', '.mjs', '.html', '.css', '.json', '.md', '.sql', '.txt', '.svg']);
const BANNED_EXT = new Set(['.csv', '.xlsx', '.xls', '.env', '.pem', '.key']);
const PATTERNS = [
  [/sb_secret_[A-Za-z0-9_\-]+/, 'Supabase secret key'],
  [/"role"\s*:\s*"service_role"/, 'service_role JWT'],
  [/eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]*c2VydmljZV9yb2xl/, 'service_role JWT (base64)'],
  [/\b[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}\b/, 'admin setup code (plaintext)'],
  [/\b7656119\d{10}\b/, 'real-looking SteamID64'],
  [/PRIVATE KEY-----/, 'private key'],
];

function check(p) {
  const rel = relative(repo, p).replaceAll('\\', '/');
  if (rel === 'scripts/prepush-check.mjs') return; // this file contains the patterns themselves
  const ext = extname(p).toLowerCase();
  if (BANNED_EXT.has(ext)) problems.push(`${rel}: forbidden file type ${ext}`);
  if (!TEXT.has(ext)) return;
  const text = readFileSync(p, 'utf8');
  for (const [re, what] of PATTERNS) {
    if (!re.test(text)) continue;
    // SteamID64 patterns are allowed only in tests/fixtures with obviously fake values
    if (what.startsWith('real-looking') && /tests\//.test(rel)) continue;
    // the regex text itself in validators is fine
    if (what.startsWith('real-looking') && /7656119\\d\{10\}|7656119\[0-9\]\{10\}/.test(text) && !/\b7656119\d{10}\b/.test(text.replace(/7656119\\d\{10\}|7656119\[0-9\]\{10\}/g, ''))) continue;
    problems.push(`${rel}: ${what}`);
  }
}

walk(repo);

// JS syntax check of everything under docs/js
function jsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) jsFiles(p, out); else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}
for (const f of jsFiles(join(repo, 'docs', 'js'))) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { problems.push(`${relative(repo, f)}: syntax error ${String(e.stderr).split('\n')[0]}`); }
}

if (problems.length) {
  console.error('PRE-PUSH CHECK FAILED:\n' + problems.map((x) => ' - ' + x).join('\n'));
  process.exit(1);
}
console.log('pre-push check OK');
