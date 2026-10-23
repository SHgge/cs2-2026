// «Сургуулийн аварга – CS2 2026» — тэмцээний логик (CONTRACT §3).
// Pure ES module: no DOM, no dependencies besides ./event.js; runs in browsers and Node >= 22.
// Works only with team ids/codes, scores and times — never with player data.
import { GROUPS, GROUP_LABEL, TEAMS, DRAW_ORDER, MATCHES, MAPS } from './event.js';

/**
 * @typedef {object} Match  A match as returned by resolveMatches(): event.js fields + live fields from the state.
 * @property {number} no  1–20
 * @property {1|2} day
 * @property {'group'|'qf'|'sf'|'final'|'third'} stage
 * @property {string|null} code  '1/4-1' … 'Финал', '3-р байр'; null for group matches
 * @property {string|null} grp  'A'|'B'|'V'|'G' for group matches, else null
 * @property {'A'|'B'} station
 * @property {string} start  ISO time with +08:00 (the state's value wins if the admin moved the match)
 * @property {string} end
 * @property {string} src_a  'seat:A1' | 'rank:A1' | 'W:13' | 'L:17'
 * @property {string} src_b
 * @property {string} status  'scheduled' when unknown; only 'reported' and 'final' count as played
 * @property {number|null} score_a
 * @property {number|null} score_b
 * @property {boolean|null} ot
 * @property {'a'|'b'|null} forfeit  side that LOST by forfeit (technical loss 13:0)
 * @property {number|null} team_a  resolved team id, null while unknown
 * @property {number|null} team_b
 */

/**
 * @typedef {object} StandingRow
 * @property {number} teamId
 * @property {1|2|3} seat  seat in the group (= pot)
 * @property {number} p  played
 * @property {number} w
 * @property {number} d  12:12 draws
 * @property {number} l
 * @property {number} rf  rounds won
 * @property {number} ra  rounds lost
 * @property {number} rd  rf − ra
 * @property {number} pts  3 / 1 / 0
 * @property {number|null} rank  1–3; teams in an unresolved tie share the block's best rank; null while 'pending'
 */

// ---------------------------------------------------------------- SHA-256

const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

/**
 * SHA-256 of a string (UTF-8), lowercase hex — synchronous pure-JS version.
 * sha256Hex() falls back to it where crypto.subtle is missing (e.g. a page opened over plain http on the LAN).
 * @param {string} str
 * @returns {string}
 */
export function sha256HexSync(str) {
  if (typeof str !== 'string') throw new TypeError('sha256: string expected');
  const msg = new TextEncoder().encode(str);
  const len = msg.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, Math.floor(len / 0x20000000)); // bit length, high word
  view.setUint32(total - 4, (len * 8) >>> 0); // bit length, low word
  const hash = H0.slice();
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      w[i] = w[i - 16] + (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) + w[i - 7] + (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { hash[i] = (hash[i] + v) >>> 0; });
  }
  return hash.map((v) => v.toString(16).padStart(8, '0')).join('');
}

/**
 * SHA-256 of a string (UTF-8), lowercase hex. Uses globalThis.crypto.subtle; pure-JS fallback if it is unavailable.
 * @param {string} str
 * @returns {Promise<string>}
 */
export async function sha256Hex(str) {
  if (typeof str !== 'string') throw new TypeError('sha256Hex: string expected');
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (subtle && typeof subtle.digest === 'function') {
    try {
      const digest = await subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
    } catch { /* fall through to the pure-JS version */ }
  }
  return sha256HexSync(str);
}

// ---------------------------------------------------------------- draw

/**
 * Normalises one draw number: an integer 0–9999 (number, or a string of 1–4 digits such as "0042") → integer; else null.
 * @param {unknown} v
 * @returns {number|null}
 */
export function parseDrawNum(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 9999 ? v + 0 : null;
  if (typeof v === 'string' && /^\s*\d{1,4}\s*$/.test(v)) return Number(v.trim());
  return null;
}

/**
 * Canonical draw input string "12a=1234,11a=5,…" in DRAW_ORDER (decimal, no leading zeros). Extra keys are ignored.
 * @param {Record<string, number|string>} nums  team code → number 0–9999
 * @returns {string}
 * @throws {RangeError} if a number is missing or not an integer 0–9999
 */
export function drawInputsString(nums) {
  const src = nums && typeof nums === 'object' ? nums : {};
  return DRAW_ORDER.map((code) => {
    const n = parseDrawNum(src[code]);
    if (n === null) throw new RangeError(`draw number for "${code}" must be an integer 0–9999`);
    return `${code}=${n}`;
  }).join(',');
}

/**
 * Verifiable group draw (CONTRACT §3, test vector in tests/logic.test.mjs).
 * seed = sha256Hex("cs2draw-v1|" + secret.toLowerCase() + "|" + inputs); keys[code] = sha256Hex(seed + "|" + code);
 * inside each pot (1, 2, 3; TEAMS order) teams are sorted by key ascending → positions 0,1,2,3 go to groups A,Б,В,Г;
 * seat number = pot, so groups[g] = [pot-1 code, pot-2 code, pot-3 code].
 * @param {string} secretHex  the committed secret (64 hex)
 * @param {Record<string, number|string>} nums  the 12 numbers (team code → 0–9999)
 * @returns {Promise<{inputs:string, seed:string, keys:Record<string,string>, groups:{A:string[],B:string[],V:string[],G:string[]}}>}
 */
export async function computeDraw(secretHex, nums) {
  if (typeof secretHex !== 'string' || !secretHex) throw new TypeError('computeDraw: secret must be a non-empty string');
  const inputs = drawInputsString(nums);
  const seed = await sha256Hex(`cs2draw-v1|${secretHex.toLowerCase()}|${inputs}`);
  const hashes = await Promise.all(DRAW_ORDER.map((code) => sha256Hex(`${seed}|${code}`)));
  const keys = Object.fromEntries(DRAW_ORDER.map((code, i) => [code, hashes[i]]));
  const groups = Object.fromEntries(GROUPS.map((grp) => [grp, []]));
  for (const pot of [1, 2, 3]) {
    const codes = TEAMS.filter((t) => t.pot === pot).map((t) => t.code);
    codes.sort((x, y) => (keys[x] < keys[y] ? -1 : keys[x] > keys[y] ? 1 : 0));
    codes.forEach((code, i) => groups[GROUPS[i]].push(code));
  }
  return { inputs, seed, keys, groups };
}

// ---------------------------------------------------------------- scores

const KO_STAGES = new Set(['qf', 'sf', 'final', 'third']);

function toInt(v) {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? v + 0 : null;
  if (typeof v === 'string' && /^\s*\d{1,5}\s*$/.test(v)) return Number(v.trim());
  return null;
}
const noForfeit = (f) => f == null || f === '' || f === false;

/**
 * Is this a legal final score? (a, b may be numbers or digit strings.)
 * group: 13:0…13:11 either way, or 12:12. Knockout (qf/sf/final/third): 13:0…13:11 either way, or overtime
 * W:L with W = 16 + 3k (k ≥ 0) and W−4 ≤ L ≤ W−2 (16:12…16:14, 19:15…19:17, …).
 * forfeit 'a' / 'b' = that side LOST by forfeit → the only legal score is 13:0 for the other side (0:13 / 13:0).
 * @param {'group'|'qf'|'sf'|'final'|'third'} stage
 * @param {number|string} a
 * @param {number|string} b
 * @param {'a'|'b'|null} [forfeit]
 * @returns {boolean}
 */
export function validScore(stage, a, b, forfeit = null) {
  const ko = KO_STAGES.has(stage);
  if (!ko && stage !== 'group') return false;
  const x = toInt(a);
  const y = toInt(b);
  if (!noForfeit(forfeit)) {
    if (forfeit === 'a') return x === 0 && y === 13;
    if (forfeit === 'b') return x === 13 && y === 0;
    return false;
  }
  if (x === null || y === null) return false;
  const hi = Math.max(x, y);
  const lo = Math.min(x, y);
  if (hi === 13 && lo <= 11) return true;
  if (!ko) return x === 12 && y === 12;
  return hi >= 16 && (hi - 16) % 3 === 0 && lo >= hi - 4 && lo <= hi - 2;
}

/**
 * The legal result of a match, or null if it has no legal score (status is NOT checked here).
 * A forfeit counts as 13:0 for the other side.
 * @param {Partial<Match>} m
 * @returns {{a:number, b:number, forfeit:'a'|'b'|null, ot:boolean, winner:'a'|'b'|null}|null}  winner null = 12:12 draw
 */
export function matchResult(m) {
  if (!m || typeof m !== 'object') return null;
  const f = m.forfeit === 'a' || m.forfeit === 'b' ? m.forfeit : null;
  if (!f && !noForfeit(m.forfeit)) return null;
  const a = f ? (f === 'a' ? 0 : 13) : toInt(m.score_a);
  const b = f ? (f === 'b' ? 0 : 13) : toInt(m.score_b);
  if (a === null || b === null || !validScore(m.stage, a, b, f)) return null;
  return { a, b, forfeit: f, ot: !f && Math.max(a, b) >= 16, winner: a > b ? 'a' : b > a ? 'b' : null };
}

/**
 * Score text in a : b order: "13 : 9", "16 : 14 (OT)", "13 : 0 (техникийн)" / "0 : 13 (техникийн)"; '' if no score yet.
 * OT is read from the score (a side reached 16+), so it never contradicts the numbers.
 * @param {Partial<Match>} m
 * @returns {string}
 */
export function fmtScore(m) {
  if (!m || typeof m !== 'object') return '';
  if (m.forfeit === 'a') return '0 : 13 (техникийн)';
  if (m.forfeit === 'b') return '13 : 0 (техникийн)';
  const a = toInt(m.score_a);
  const b = toInt(m.score_b);
  if (a === null || b === null) return '';
  return `${a} : ${b}${Math.max(a, b) >= 16 ? ' (OT)' : ''}`;
}

// ---------------------------------------------------------------- teams, seats, labels

function idByCode(state) {
  const map = new Map(TEAMS.map((t) => [t.code, t.id]));
  if (state && Array.isArray(state.teams)) {
    for (const t of state.teams) if (t && t.code != null && t.id != null) map.set(String(t.code), Number(t.id));
  }
  return map;
}

/**
 * Id of «Багш нарын баг»: the state team with is_teachers, else event.js (id 4).
 * @param {object|null} state
 * @returns {number|null}
 */
export function teachersTeamId(state) {
  if (state && Array.isArray(state.teams)) {
    const t = state.teams.find((x) => x && x.is_teachers === true);
    if (t) return Number(t.id);
  }
  const t = TEAMS.find((x) => x.is_teachers);
  return t ? t.id : null;
}

/**
 * Seat → team id from state.draw.groups, e.g. {A1: 4, A2: 8, A3: 9, B1: 1, …}.
 * Null until the draw is published (status 'published'); {includeComputed:true} also accepts 'computed' (admin preview).
 * Unknown codes map to null.
 * @param {object|null} state
 * @param {{includeComputed?: boolean}} [options]
 * @returns {Record<string, number|null>|null}
 */
export function seatMap(state, options) {
  const draw = state && state.draw;
  if (!draw || !draw.groups || typeof draw.groups !== 'object') return null;
  const preview = !!(options && options.includeComputed);
  if (!(draw.status === 'published' || (preview && draw.status === 'computed'))) return null;
  const ids = idByCode(state);
  const out = {};
  for (const grp of GROUPS) {
    const codes = Array.isArray(draw.groups[grp]) ? draw.groups[grp] : [];
    for (let s = 1; s <= 3; s++) {
      const id = ids.get(codes[s - 1]);
      out[`${grp}${s}`] = id === undefined ? null : id;
    }
  }
  return out;
}

const genitive = (code) => (/[14]$/.test(code) ? '-ийн' : '-ын'); // нэгийн, хоёрын, гурвын, дөрвийн

/**
 * Placeholder label for a match side, matching the printed posters:
 * 'seat:A1' → 'А1'; 'rank:A1' → 'А№1' (long: 'А хэсгийн 1-р байр'); 'W:13' → '1/4-1-ийн ялагч'; 'L:17' → '1/2-1-ийн ялагдагч'.
 * @param {string} src
 * @param {{long?: boolean}} [options]
 * @returns {string}  '' for an unknown source
 */
export function srcLabel(src, options) {
  if (typeof src !== 'string') return '';
  const [kind, ref = ''] = src.split(':');
  if (kind === 'seat' || kind === 'rank') {
    const letter = GROUP_LABEL[ref.slice(0, 1)];
    const n = ref.slice(1);
    if (!letter || !/^[123]$/.test(n)) return '';
    if (kind === 'seat') return `${letter}${n}`;
    return options && options.long ? `${letter} хэсгийн ${n}-р байр` : `${letter}№${n}`;
  }
  if (kind === 'W' || kind === 'L') {
    const m = MATCHES.find((x) => x.no === Number(ref));
    if (!m || !m.code) return '';
    return `${m.code}${genitive(m.code)} ${kind === 'W' ? 'ялагч' : 'ялагдагч'}`;
  }
  return '';
}

// ---------------------------------------------------------------- internals: merge, count, rank

const EVENT_MATCHES = [...MATCHES].sort((x, y) => x.no - y.no);
const STRUCTURAL = new Set(['no', 'day', 'stage', 'grp', 'src_a', 'src_b', 'team_a', 'team_b']);
const EVENT_IF_NULL = new Set(['station', 'start', 'end']);
const counts = (status, official) => status === 'final' || (!official && status === 'reported');
const opt = (o, key, dflt) => (typeof o === 'boolean' ? o : o && typeof o === 'object' && o[key] != null ? !!o[key] : dflt);

/**
 * event.js matches (structure, knockout codes) + state.matches (status, scores, moved start/end/station),
 * by match number; fresh copies.
 */
function mergedMatches(state) {
  const live = new Map();
  if (state && Array.isArray(state.matches)) {
    for (const m of state.matches) if (m && typeof m === 'object' && m.no != null) live.set(Number(m.no), m);
  }
  return EVENT_MATCHES.map((e) => {
    const m = { ...e, status: 'scheduled', score_a: null, score_b: null, ot: null, forfeit: null };
    const s = live.get(e.no);
    if (s) {
      for (const [key, v] of Object.entries(s)) {
        if (v === undefined || STRUCTURAL.has(key) || (v === null && EVENT_IF_NULL.has(key))) continue;
        if (key === 'code' && (e.code != null || v == null)) continue;
        m[key] = v;
      }
    }
    if (m.status == null) m.status = 'scheduled';
    m.team_a = null;
    m.team_b = null;
    return m;
  });
}

function makeCtx(state) {
  return { state, seats: seatMap(state), matches: mergedMatches(state), cache: new Map() };
}

function tally(row, own, opp) {
  row.p += 1;
  row.rf += own;
  row.ra += opp;
  if (own > opp) { row.w += 1; row.pts += 3; } else if (own === opp) { row.d += 1; row.pts += 1; } else row.l += 1;
}

/** Splits ids into blocks of equal key, best (highest) first; keeps the input order inside a block. */
function splitDesc(ids, key) {
  const values = [...new Set(ids.map(key))].sort((x, y) => y - x);
  return values.map((v) => ids.filter((id) => key(id) === v));
}

/**
 * Orders the group: points → (for every tied block) head-to-head points among the block → round difference in the
 * group → rounds won in the group → lot. Whenever a criterion splits a block, every sub-block restarts from
 * head-to-head. Returns blocks in order; a block with >1 team is an unresolved tie. Logs each split to `log`.
 * (In a complete 3-team group rounds-won can never split a block that round difference left level; it is kept for
 * rule fidelity and for incomplete groups.)
 */
function orderBlocks(rows, games, lot, log) {
  const stat = new Map(rows.map((r) => [r.teamId, r]));
  const h2h = (block) => {
    const inBlock = new Set(block);
    const pts = new Map(block.map((id) => [id, 0]));
    for (const gm of games) {
      if (!inBlock.has(gm.ta) || !inBlock.has(gm.tb)) continue;
      pts.set(gm.ta, pts.get(gm.ta) + (gm.a > gm.b ? 3 : gm.a === gm.b ? 1 : 0));
      pts.set(gm.tb, pts.get(gm.tb) + (gm.b > gm.a ? 3 : gm.a === gm.b ? 1 : 0));
    }
    return (id) => pts.get(id);
  };
  const criteria = [['h2h', h2h], ['rd', () => (id) => stat.get(id).rd], ['rw', () => (id) => stat.get(id).rf]];
  const resolve = (block) => {
    if (block.length < 2) return [block];
    for (const [by, keyFor] of criteria) {
      const parts = splitDesc(block, keyFor(block));
      if (parts.length > 1) {
        log.push({ teams: [...block], by });
        return parts.flatMap(resolve);
      }
    }
    if (lot && block.every((id) => lot.includes(id))) {
      log.push({ teams: [...block], by: 'lot' });
      return [...block].sort((x, y) => lot.indexOf(x) - lot.indexOf(y)).map((id) => [id]);
    }
    return [block];
  };
  return splitDesc(rows.map((r) => r.teamId), (id) => stat.get(id).pts).flatMap(resolve);
}

function computeStandings(c, grp, official) {
  const { state, seats } = c;
  const dec = state && state.decisions && typeof state.decisions === 'object' ? state.decisions[grp] : null;
  const lot = dec && Array.isArray(dec.lot) ? dec.lot.map(Number) : null;
  const out = { grp, rows: [], status: 'pending', tied: [], tiebreaks: [], counted: 0, approved: !!(dec && dec.approved) };
  if (!seats || !GROUPS.includes(grp)) return out;
  const rows = [];
  for (let s = 1; s <= 3; s++) {
    const id = seats[`${grp}${s}`];
    if (id != null && !rows.some((r) => r.teamId === id)) {
      rows.push({ teamId: id, seat: s, p: 0, w: 0, d: 0, l: 0, rf: 0, ra: 0, rd: 0, pts: 0, rank: null });
    }
  }
  const byId = new Map(rows.map((r) => [r.teamId, r]));
  const games = [];
  let finals = 0;
  for (const m of c.matches) {
    if (m.stage !== 'group' || m.grp !== grp || !counts(m.status, official)) continue;
    const r = matchResult(m);
    const ta = seats[m.src_a.slice(5)];
    const tb = seats[m.src_b.slice(5)];
    if (!r || !byId.has(ta) || !byId.has(tb) || ta === tb) continue;
    games.push({ ta, tb, a: r.a, b: r.b });
    if (m.status === 'final') finals += 1;
    tally(byId.get(ta), r.a, r.b);
    tally(byId.get(tb), r.b, r.a);
  }
  for (const r of rows) r.rd = r.rf - r.ra;
  out.counted = games.length;
  if (!games.length) { out.rows = rows; return out; }
  let pos = 1;
  for (const block of orderBlocks(rows, games, lot, out.tiebreaks)) {
    for (const id of block) { const r = byId.get(id); r.rank = pos; out.rows.push(r); }
    if (block.length > 1) out.tied.push([...block]);
    pos += block.length;
  }
  if (games.length < 3) out.status = 'provisional';
  else if (out.tied.length) out.status = 'needs_lot';
  else out.status = finals === 3 ? 'complete' : 'provisional';
  return out;
}

function standingsIn(c, grp, official) {
  const key = `${grp}|${official}`;
  if (!c.cache.has(key)) c.cache.set(key, computeStandings(c, grp, official));
  return c.cache.get(key);
}

/** Official: status 'complete'. Provisional: all 3 matches counted and no unresolved tie. */
const groupDecided = (st, official) => (official ? st.status === 'complete' : st.counted === 3 && st.tied.length === 0);

/** Winner/loser team ids of a counted, decided match whose teams are known; else null. */
function decide(m, official) {
  if (!m || m.team_a == null || m.team_b == null || !counts(m.status, official)) return null;
  const r = matchResult(m);
  if (!r || !r.winner) return null;
  return r.winner === 'a' ? { winner: m.team_a, loser: m.team_b } : { winner: m.team_b, loser: m.team_a };
}

function resolveIn(c, official) {
  const byNo = new Map();
  const rankTeam = (grp, place) => {
    const st = standingsIn(c, grp, official);
    if (!groupDecided(st, official)) return null;
    const row = st.rows.find((r) => r.rank === place);
    return row ? row.teamId : null;
  };
  const resolveSrc = (src) => {
    const [kind, ref] = typeof src === 'string' ? src.split(':') : [];
    if (!ref) return null;
    if (kind === 'seat') return c.seats && c.seats[ref] != null ? c.seats[ref] : null;
    if (kind === 'rank') return rankTeam(ref.slice(0, 1), Number(ref.slice(1)));
    if (kind === 'W' || kind === 'L') {
      const res = decide(byNo.get(Number(ref)), official);
      return res ? (kind === 'W' ? res.winner : res.loser) : null;
    }
    return null;
  };
  for (const m of c.matches) { // ascending match number: W:/L: sources always point to earlier matches
    m.team_a = resolveSrc(m.src_a);
    m.team_b = resolveSrc(m.src_b);
    byNo.set(m.no, m);
  }
  return c.matches;
}

function teachersOut(c, matches, teachers, official) {
  for (const m of matches) {
    if (m.stage !== 'qf') continue;
    const d = decide(m, official);
    if (d && d.loser === teachers) return true;
  }
  if (!c.seats) return false;
  for (const grp of GROUPS) {
    for (let s = 1; s <= 3; s++) {
      if (c.seats[`${grp}${s}`] !== teachers) continue;
      const st = standingsIn(c, grp, official);
      if (!groupDecided(st, official)) return false;
      const row = st.rows.find((r) => r.teamId === teachers);
      return !!row && row.rank > 2;
    }
  }
  return false;
}

const timeOf = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : Infinity; };
const byTime = (x, y) => (timeOf(x.start) - timeOf(y.start)) || (x.no - y.no);

// ---------------------------------------------------------------- public: standings, bracket, ranking

/**
 * Group table (CONTRACT §3). Counts group matches with status 'final' ({official:true}) or 'reported'|'final'
 * (default: provisional, as the public pages show). Ranking: points 3/1/0 → head-to-head points in the tied block →
 * round difference in the group → rounds won in the group → state.decisions[grp].lot order → else unresolved.
 * Every sub-block that splits restarts from head-to-head.
 * status: 'pending' (no counted match; rows in seat order, rank null) · 'provisional' · 'needs_lot' (all 3 counted, tie
 * left) · 'complete' (3 final matches, no unresolved tie). tied = unresolved blocks of team ids.
 * Extra fields: tiebreaks [{teams, by:'h2h'|'rd'|'rw'|'lot'}] (how each tie was split), counted, approved.
 * Never throws.
 * @param {object|null} state  cs2_public_state result (or the admin overview)
 * @param {'A'|'B'|'V'|'G'} grp
 * @param {{official?: boolean}|boolean} [options]
 * @returns {{grp:string, rows:StandingRow[], status:'pending'|'provisional'|'needs_lot'|'complete', tied:number[][],
 *   tiebreaks:{teams:number[], by:string}[], counted:number, approved:boolean}}
 */
export function groupStandings(state, grp, options) {
  const official = opt(options, 'official', false);
  try {
    return standingsIn(makeCtx(state), grp, official);
  } catch {
    return { grp, rows: [], status: 'pending', tied: [], tiebreaks: [], counted: 0, approved: false };
  }
}

/**
 * All 20 matches (fresh copies, match-number order) with team_a/team_b resolved: group matches from the published
 * seats; 'rank:X1/X2' only when group X is complete; 'W:n'/'L:n' from decided knockout results.
 * Default {official:true}: only 'final' results move teams on. {official:false}: 'reported' results count too and a
 * group counts once all 3 matches are counted with no unresolved tie (admin preview). Unknown → null. Never throws.
 * @param {object|null} state
 * @param {{official?: boolean}|boolean} [options]
 * @returns {Match[]}
 */
export function resolveMatches(state, options) {
  const official = opt(options, 'official', true);
  try {
    return resolveIn(makeCtx(state), official);
  } catch {
    return mergedMatches(null);
  }
}

/**
 * Final ranking and awards (SPEC §4). order = [W19, L19, W20, L20], null where not decided yet.
 * classPlaces = order without «Багш нарын баг», first 3 — filled per place as soon as it is certain:
 * 1st after the final; 2nd after the final (or after the 3rd-place match if the teachers play the final);
 * 3rd after the 3rd-place match, or right after the semifinals when the teachers play the 3rd-place match
 * (their opponent is 3rd regardless). teachersAward: 'honor' if the teachers reached a semifinal, 'special' once they
 * are out earlier, null while unknown. Default {official:true}. Never throws.
 * @param {object|null} state
 * @param {{official?: boolean}|boolean} [options]
 * @returns {{order:(number|null)[], classPlaces:(number|null)[], teachersAward:'honor'|'special'|null}}
 */
export function finalRanking(state, options) {
  const official = opt(options, 'official', true);
  try {
    const c = makeCtx(state);
    const ms = resolveIn(c, official);
    const at = (no) => ms.find((m) => m.no === no);
    const fin = at(19);
    const thr = at(20);
    const f = decide(fin, official);
    const t = decide(thr, official);
    const T = teachersTeamId(state);
    const plays = (m, id) => id != null && !!m && (m.team_a === id || m.team_b === id);
    const tFinal = plays(fin, T);
    const tThird = plays(thr, T);
    const first = f ? (f.winner === T ? f.loser : f.winner) : null;
    const second = tFinal ? (t ? t.winner : null) : f ? f.loser : null;
    let third = null;
    if (tThird) third = thr.team_a === T ? thr.team_b : thr.team_a;
    else if (t) third = tFinal ? t.loser : t.winner;
    let teachersAward = null;
    if (T != null) {
      if (plays(at(17), T) || plays(at(18), T)) teachersAward = 'honor';
      else if (teachersOut(c, ms, T, official)) teachersAward = 'special';
    }
    return {
      order: [f ? f.winner : null, f ? f.loser : null, t ? t.winner : null, t ? t.loser : null],
      classPlaces: [first, second, third],
      teachersAward,
    };
  } catch {
    return { order: [null, null, null, null], classPlaces: [null, null, null], teachersAward: null };
  }
}

/**
 * One team's matches (resolved as in resolveMatches; same options), sorted by start time, then match number.
 * Knockout matches appear once the team is known to play them. Never throws.
 * @param {object|null} state
 * @param {number} teamId
 * @param {{official?: boolean}|boolean} [options]
 * @returns {Match[]}
 */
export function teamSchedule(state, teamId, options) {
  const id = Number(teamId);
  if (teamId == null || teamId === '' || !Number.isFinite(id)) return [];
  return resolveMatches(state, options).filter((m) => m.team_a === id || m.team_b === id).sort(byTime);
}

// ---------------------------------------------------------------- map veto (regulation 02 §7.9, SPEC §3)

const MAP_BY_KEY = new Map(MAPS.map((x) => [x.key, x]));

/**
 * Map pool keys in display order: state.settings.map_pool when it is a list of ≥ 3 known keys, else event.js MAPS.
 * @param {object|null} state
 * @returns {string[]}
 */
export function mapPool(state) {
  const p = state && state.settings && state.settings.map_pool;
  if (Array.isArray(p)) {
    const keys = [...new Set(p.filter((k) => typeof k === 'string' && MAP_BY_KEY.has(k)))];
    if (keys.length >= 3) return keys;
  }
  return MAPS.map((x) => x.key);
}

/**
 * Map metadata by key: {key, name, id}; unknown keys fall back to {key, name: key, id: 'de_' + key}.
 * @param {string} key
 * @returns {{key:string, name:string, id:string}}
 */
export function mapInfo(key) {
  return MAP_BY_KEY.get(key) || { key: String(key), name: String(key), id: `de_${key}` };
}

const otherSide = (s) => (s === 'a' ? 'b' : 'a');

/**
 * Veto state of a match. Bans alternate first, other, first, … (3 + 3 with 7 maps); the one map left is played.
 * first: m.veto_first, else 'a' for group matches (the team listed first bans first); knockout: null until the
 * coin toss is entered. steps: valid bans in order [{side, map}]; next: whose turn ({side, step}) or null when done
 * or first is missing. Never throws.
 * @param {object|null} m  match (state / resolveMatches / referee view)
 * @param {string[]} [pool]  mapPool(state)
 * @returns {{first:'a'|'b'|null, coin:boolean, steps:{side:'a'|'b', map:string}[], banned:string[],
 *   remaining:string[], total:number, done:boolean, map:string|null, next:{side:'a'|'b', step:number}|null,
 *   started:boolean, needsFirst:boolean}}
 */
export function vetoState(m, pool) {
  const keys = Array.isArray(pool) && pool.length >= 2 ? pool : MAPS.map((x) => x.key);
  const first = m && (m.veto_first === 'a' || m.veto_first === 'b') ? m.veto_first : (m && m.stage === 'group' ? 'a' : null);
  const steps = [];
  const seen = new Set();
  for (const s of (m && Array.isArray(m.veto) ? m.veto : [])) {
    if (!s || (s.side !== 'a' && s.side !== 'b') || !keys.includes(s.map) || seen.has(s.map)) continue;
    if (steps.length >= keys.length - 1) break;
    seen.add(s.map);
    steps.push({ side: s.side, map: s.map });
  }
  const remaining = keys.filter((k) => !seen.has(k));
  const done = remaining.length === 1;
  const next = !done && first ? { side: steps.length % 2 === 0 ? first : otherSide(first), step: steps.length } : null;
  return {
    first, coin: !!(m && m.veto_coin), steps, banned: steps.map((s) => s.map), remaining, total: keys.length - 1,
    done, map: done ? remaining[0] : null, next, started: steps.length > 0, needsFirst: !first,
  };
}
