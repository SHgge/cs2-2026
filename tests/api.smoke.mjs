// api.smoke.mjs — live smoke test of the Supabase REST API exactly as the browser uses it (CONTRACT §0/§4/§8):
// header `apikey: <publishable key from docs/js/config.js>` only, no Authorization header.
//
//   node tests/api.smoke.mjs                       public checks (read-only, writes nothing)
//   TEST_TOKEN=… TEST_PIN=1234 node tests/api.smoke.mjs
//                                                  + class flow on the HIDDEN test team 99 (get / save / confirm),
//                                                    which ends by saving an EMPTY roster again.
// TEST_TOKEN / TEST_PIN: a temporary link token + PIN for team 99 created by SQL (store only sha256 / bcrypt) and
// cleared afterwards. Secrets are never printed. Exit code 1 if any check fails. Not part of `npm test` (network).
import { SUPABASE_URL, SUPABASE_KEY, LEGACY_ANON_KEY } from '../docs/js/config.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const info = (name, detail) => console.log(`INFO  ${name} — ${detail}`);

async function call(path, { method = 'POST', body, headers = {}, key = SUPABASE_KEY } = {}) {
  try {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      method,
      headers: { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, json, text, applied: res.headers.get('preference-applied') || '' };
  } catch (e) {
    return { status: 0, json: null, text: String(e && e.message), applied: '' };
  }
}
const rpc = (fn, args, opts = {}) => call(`/rest/v1/rpc/${fn}`, { body: args, ...opts });
const why = (r) => `HTTP ${r.status}${r.json && (r.json.code || r.json.error) ? ` ${r.json.code || r.json.error}` : ''}`;
const refused = (r) => r.status >= 400 && r.status < 500;
const sorted = (o) => Object.keys(o || {}).sort().join(',');

// ---------------------------------------------------------------- 1. public state with the publishable key only
const ps = await rpc('cs2_public_state', { p_version: null });
check('cs2_public_state works with ONLY the apikey header (publishable key, no Authorization)',
  ps.status === 200 && ps.json && ps.json.ok === true, why(ps));
const st = (ps.json && ps.json.ok) ? ps.json : { teams: [], matches: [] };
check('public state: top-level keys', sorted(st) === 'announcements,decisions,draw,matches,now,ok,settings,teams,version', sorted(st));
check('public state: 12 teams, hidden test team 99 excluded',
  st.teams.length === 12 && !st.teams.some((t) => t.id === 99 || t.code === 'test'));
check('public state: teams carry class names + counts only',
  st.teams.every((t) => sorted(t) === 'code,id,is_teachers,name,pot,reg' && sorted(t.reg) === 'confirmed,consents,players'));
check('public state: 20 matches without report metadata',
  st.matches.length === 20 && st.matches.every((m) => !('reported_by' in m) && !('reported_at' in m)));
check('public state: no player fields / SteamIDs anywhere',
  !/7656119\d{10}/.test(ps.text) && !/"(first_name|surname_initial|steam_nickname|steam_id64|alias|is_captain|consent_3[abv])"/.test(ps.text));
const ps2 = await rpc('cs2_public_state', { p_version: st.version });
check('public state: version short-circuit', !!(ps2.json && ps2.json.unchanged === true && ps2.json.version === st.version), why(ps2));

// ---------------------------------------------------------------- 2. nothing else is reachable
const deny = [
  ['GET /rest/v1/teams', () => call('/rest/v1/teams?select=*', { method: 'GET' })],
  ['GET /rest/v1/players', () => call('/rest/v1/players?select=*', { method: 'GET' })],
  ['GET teams with Accept-Profile: cs2', () => call('/rest/v1/teams?select=*', { method: 'GET', headers: { 'Accept-Profile': 'cs2' } })],
  ['GET players with Accept-Profile: cs2', () => call('/rest/v1/players?select=*', { method: 'GET', headers: { 'Accept-Profile': 'cs2' } })],
  ['GET admins with Accept-Profile: cs2_api', () => call('/rest/v1/admins?select=*', { method: 'GET', headers: { 'Accept-Profile': 'cs2_api' } })],
  ['POST (insert) teams with Content-Profile: cs2', () => call('/rest/v1/teams', { body: { id: 77, code: 'x', name: 'x' }, headers: { 'Content-Profile': 'cs2' } })],
  ['PATCH settings with Content-Profile: cs2', () => call('/rest/v1/settings?id=eq.1', { method: 'PATCH', body: { version: 1 }, headers: { 'Content-Profile': 'cs2' } })],
  ['RPC cs2_api.public_state (no profile)', () => rpc('public_state', { p_version: null })],
  ['RPC cs2_api.public_state with Content-Profile: cs2_api', () => rpc('public_state', { p_version: null }, { headers: { 'Content-Profile': 'cs2_api' } })],
  ['RPC cs2_api.class_get with Content-Profile: cs2_api', () => rpc('class_get', { p_token: 'x' }, { headers: { 'Content-Profile': 'cs2_api' } })],
  ['RPC cs2.state_json (helper) with Content-Profile: cs2', () => rpc('state_json', { p_admin: true }, { headers: { 'Content-Profile': 'cs2' } })],
  ['RPC cs2.sha256_hex (helper) via public', () => rpc('sha256_hex', { p: 'x' })],
];
for (const [name, fn] of deny) {
  const r = await fn();
  check(`refused: ${name}`, refused(r) && !/7656119\d{10}/.test(r.text), why(r));
}

// ---------------------------------------------------------------- 3. the other wrappers answer with error codes, never data
const cg = await rpc('cs2_class_get', { p_token: 'smoke-no-such-token-0000000' });
check('cs2_class_get with an unknown token → bad_token', !!(cg.json && cg.json.ok === false && cg.json.error === 'bad_token'), why(cg));
const cgi = await rpc('cs2_class_get', { p_token: "x' or 1=1 --" });
check('cs2_class_get with an injection string → bad_token', !!(cgi.json && cgi.json.error === 'bad_token'), why(cgi));
const rg = await rpc('cs2_ref_get', { p_token: 'smoke-no-such-token-0000000' });
check('cs2_ref_get with an unknown token → bad_token', !!(rg.json && rg.json.error === 'bad_token'), why(rg));
const ad = await rpc('cs2_admin', { p_session: 'smoke-no-such-session-00000', p_action: 'overview', p_args: {} });
check('cs2_admin with an unknown session → bad_session (migration cs2_08 deployed)',
  !!(ad.json && ad.json.ok === false && ad.json.error === 'bad_session'), why(ad));

// ---------------------------------------------------------------- 3b. transport-level abuse (no token needed)
// `Prefer: tx=rollback` must be ignored, else wrong PINs / failed logins could be rolled back (unlimited guessing).
const txr = await rpc('cs2_public_state', { p_version: st.version || null }, { headers: { Prefer: 'tx=rollback' } });
check('Prefer: tx=rollback is not honoured (attempt counters cannot be rolled back)',
  txr.status === 200 && !/tx=/.test(txr.applied), `${why(txr)} applied="${txr.applied}"`);
const gv = await call('/rest/v1/rpc/cs2_class_save?p_token=smoke-no-such-token-0000000&p_payload=%7B%7D', { method: 'GET' });
check('GET on a volatile wrapper returns no data', !(gv.json && gv.json.ok === true), why(gv));
const big = await rpc('cs2_class_get', { p_token: 'A'.repeat(2_000_000) });
check('2 MB token → bad_token or 413 (no 5xx, no data)',
  (big.status === 200 && big.json && big.json.error === 'bad_token') || big.status === 413, why(big));

// ---------------------------------------------------------------- 4. key variants (informational)
const bearer = await rpc('cs2_public_state', { p_version: st.version || null }, { headers: { Authorization: `Bearer ${SUPABASE_KEY}` } });
info('publishable key also sent as Authorization: Bearer', why(bearer));
const legacy = await rpc('cs2_public_state', { p_version: st.version || null },
  { key: LEGACY_ANON_KEY, headers: { Authorization: `Bearer ${LEGACY_ANON_KEY}` } });
info('legacy anon JWT fallback (apikey + Authorization)', why(legacy));

// ---------------------------------------------------------------- 5. class flow on the hidden test team (optional)
const TOKEN = process.env.TEST_TOKEN || '';
const PIN = process.env.TEST_PIN || '';
if (TOKEN) {
  const MARK = 'Smokemarker';
  const players = [1, 2, 3, 4, 5].map((slot) => ({
    slot, first_name: `${MARK}`, surname_initial: 'Т', steam_nickname: `ТЕСТ | smoke${slot}`,
    steam_id64: slot === 1 ? '76561190000009991' : '', is_captain: slot === 1, age13: true,
  }));
  const save = (version, list, pin) => rpc('cs2_class_save', {
    p_token: TOKEN, p_payload: { expected_version: version, ...(pin ? { pin } : {}), players: list },
  });

  let g = await rpc('cs2_class_get', { p_token: TOKEN });
  check('class_get with TEST_TOKEN → the hidden test team', !!(g.json && g.json.ok && g.json.team && g.json.team.code === 'test'), why(g));
  const keys = g.json && g.json.ok ? sorted(g.json) : '';
  check('class_get: response keys', keys === 'checks,confirmed_at,deadlines,now,ok,players,team,version,window', keys);
  check('class_get: window open before the deadline',
    !!(g.json && g.json.window && g.json.window.editable === true), JSON.stringify(g.json && g.json.window));
  const v0 = g.json && g.json.version;

  const bad = await save(v0, [{ ...players[0], steam_id64: '123' }]);
  check('class_save: invalid SteamID64 → validation error for that slot',
    !!(bad.json && bad.json.error === 'validation'
      && bad.json.errors.some((e) => e.slot === 1 && e.field === 'steam_id64' && e.code === 'invalid')), why(bad));

  const huge = await save(v0, Array.from({ length: 3000 }, (_, i) => ({ slot: 100 + i, first_name: 'Bat' })));
  check('class_save: 3000 cards rejected at once (too_many)',
    !!(huge.json && huge.json.error === 'validation' && huge.json.errors.length === 1 && huge.json.errors[0].code === 'too_many'), why(huge));

  // isolation: a team id smuggled into the payload is ignored — the link token alone decides the team
  const regBefore = JSON.stringify((st.teams || []).map((t) => [t.id, t.reg]));
  const s1 = await rpc('cs2_class_save', { p_token: TOKEN, p_payload: {
    expected_version: v0, team_id: 1, players: players.map((p) => ({ ...p, team_id: 1, id: 1 })) } });
  check('class_save: 5 players saved, version + 1, roster complete',
    !!(s1.json && s1.json.ok && s1.json.version === v0 + 1 && s1.json.players.length === 5 && s1.json.checks.complete), why(s1));
  const pubIso = await rpc('cs2_public_state', { p_version: null });
  check('class_save with a smuggled team_id changes no other team',
    JSON.stringify(((pubIso.json && pubIso.json.teams) || []).map((t) => [t.id, t.reg])) === regBefore);
  const s2 = await save(v0, players);
  check('class_save: stale expected_version → version_conflict', !!(s2.json && s2.json.error === 'version_conflict'), why(s2));

  const pub = await rpc('cs2_public_state', { p_version: null });
  check('public state after a class save: still no test players / SteamIDs',
    pub.status === 200 && !pub.text.includes(MARK) && !pub.text.includes('smoke1') && !/7656119\d{10}/.test(pub.text)
    && !(pub.json.teams || []).some((t) => t.id === 99));

  let version = s1.json && s1.json.version;
  if (PIN) {
    const attest = { enrolled: true, age13: true, own_steam: true, rules: true };
    const badPin = PIN === '0000' ? '1111' : '0000';
    const wrong = await rpc('cs2_class_confirm', { p_token: TOKEN, p_pin: badPin, p_attest: attest });
    check('class_confirm: wrong PIN → pin_wrong with attempts_left', !!(wrong.json && wrong.json.error === 'pin_wrong'
      && typeof wrong.json.attempts_left === 'number'), why(wrong));
    const left1 = wrong.json && wrong.json.attempts_left;
    const wrong2 = await rpc('cs2_class_confirm', { p_token: TOKEN, p_pin: badPin, p_attest: attest }, { headers: { Prefer: 'tx=rollback' } });
    check('wrong PIN sent with Prefer: tx=rollback is still counted',
      !!(wrong2.json && wrong2.json.error === 'pin_wrong' && wrong2.json.attempts_left === left1 - 1), `${why(wrong2)} left=${wrong2.json && wrong2.json.attempts_left}`);
    const qs = new URLSearchParams({ p_token: TOKEN, p_pin: badPin, p_attest: JSON.stringify(attest) });
    const wrongGet = await call(`/rest/v1/rpc/cs2_class_confirm?${qs}`, { method: 'GET' });
    check('wrong PIN via GET → refused (never confirms, never resets the counter)', !(wrongGet.json && wrongGet.json.ok === true), why(wrongGet));
    const after = await rpc('cs2_class_confirm', { p_token: TOKEN, p_pin: '12', p_attest: attest });   // malformed: not counted
    check('attempt counter persisted (no rollback, no reset)',
      !!(after.json && after.json.error === 'pin_wrong' && after.json.attempts_left <= left1 - 1), `${why(after)} left=${after.json && after.json.attempts_left}`);
    const c1 = await rpc('cs2_class_confirm', { p_token: TOKEN, p_pin: PIN, p_attest: attest });
    check('class_confirm: right PIN + 4 attestations → confirmed', !!(c1.json && c1.json.ok && c1.json.confirmed_at), why(c1));
    g = await rpc('cs2_class_get', { p_token: TOKEN });
    check('class_get after confirm: reason confirmed, PIN needed to edit',
      !!(g.json && g.json.window.reason === 'confirmed' && g.json.window.needs_pin === true), JSON.stringify(g.json && g.json.window));
    version = g.json && g.json.version;
    const np = await save(version, players);
    check('class_save on a confirmed roster without PIN → pin_required', !!(np.json && np.json.error === 'pin_required'), why(np));
  }

  // cleanup: leave the test team with an empty roster (and no confirmation)
  g = await rpc('cs2_class_get', { p_token: TOKEN });
  const clean = await save(g.json && g.json.version, [], PIN || undefined);
  check('cleanup: empty roster saved, confirmation cleared',
    !!(clean.json && clean.json.ok && clean.json.players.length === 0 && clean.json.confirmed_at === null), why(clean));
} else {
  info('class flow', 'skipped (set TEST_TOKEN and TEST_PIN for the hidden test team 99)');
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exitCode = failed ? 1 : 0;
