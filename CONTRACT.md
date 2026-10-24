# CONTRACT — «Сургуулийн аварга – CS2 2026» online portal (binding for every builder)

Read this whole file first. Also read `C:\Users\wisez\Cs2event\_build\SPEC.md` (SPEC v6 2026-10-19, tournament facts; «## 0b. v6 changes» overrides everything) — the portal must never contradict it.
v6 (2026-10-19): people — overall lead сургалтын менежер Г.Жаргал; organiser мэдээллийн технологийн багш А.Мөнгөншагай
(утас 60114971, 94741053; receives the team fee); technical team мэдээллийн технологийн багш нар А.Мөнгөншагай, Б.Даваа,
Д.Мажигсүрэн; consent & child protection нийгмийн ажилтан Г.Энхнаран (`config.js` `STAFF`; the director's name is never shown
on public pages). Places — players in the Windows lab, spectators in the Урлагийн заал on an LED screen, teams wait in their own
classrooms and come to the Windows lab entrance 15 min before their slot (`config.js` `PLACES`). The organising body is
«Зохион байгуулагч» (no committee); the fee goes to the organiser (no accountant). Players may bring their own mouse, keyboard,
headset and mousepad (USB plug-and-play, nothing installed, no macros).
v5 (2026-10-15): event name «Сургуулийн аварга – CS2 2026»; team fee 120 000 ₮ per class team and prize fund
1 200 000 ₮ + MVP; new deadlines (below); school Octolearn London School, organiser А.Мөнгөншагай; school logo in the header/favicon.
v7 (2026-10-19, money — overrides v5): all 12 teams pay 120 000 ₮ (the teachers' team too; ≈20 000 ₮ per player), 12 × 120 000 =
1 440 000 ₮ = cash prize fund 800 000 ₮ (MVP included: 360 000 / 240 000 / 120 000 + MVP 80 000) + award items 570 000 + reserve 70 000.
Language of all user-facing text: Mongolian Cyrillic, short plain sentences (≤15 words), students addressed with «-аарай», adults «-на уу».

## 0. Decisions (fixed)
- Hosting: GitHub Pages, repo `SHgge/cs2-2026` (public), site root = `portal/docs/`, URL **https://shgge.github.io/cs2-2026/**. No build step: plain HTML/CSS/ES modules. Hash router.
- Backend: Supabase project `https://wwpxsxikeztvvgryltdp.supabase.co`, **shared with other company apps** → everything lives in schema `cs2` (tables) + `cs2_api` (SECURITY DEFINER functions) + thin `public.cs2_*` SECURITY INVOKER wrappers. NEVER touch other schemas/tables/grants. No Realtime, no Edge Functions, no Supabase Auth.
- Browser → Supabase: plain `fetch` POST to `${SUPABASE_URL}/rest/v1/rpc/<fn>` with header `apikey: <publishable key>` and `Content-Type: application/json` (see `docs/js/api.js`). Publishable key: `sb_publishable_3qVbHvZtEnnXJ_INQTQKjw_MKir4rC8` (public by design). Fallback legacy anon JWT is in `config.js` (also public).
- Access: class team page by secret token in the URL fragment `#/k/<token>`; homeroom teacher confirms with a 4-digit PIN; referees `#/ref/<token>`; organiser `#/admin` (own secret + DB session). Public pages show ONLY team (class) names, schedule, scores, groups, bracket, counts — **never player names, nicknames or SteamIDs**.
- Parental consent stays on paper (form 05/05б); the system only records ticks.
- Deadlines (Asia/Ulaanbaatar = UTC+8, no DST) — SPEC v5, set in `cs2.settings` by **migration 12** (`supabase/migrations/12_v5_name_deadlines.sql`):
  online registration closes = roster freeze **2026-10-23T23:59:59+08:00** (`reg_closes_at` = `roster_freeze_at`); paper consent 05 + 05б, paper form 04 and the team fee **2026-10-23T17:00:00+08:00** (`consent_deadline_at`; the fee has no DB field);
  group draw **2026-10-22T16:00:00+08:00** — a fixed constant (`DRAW_AT` in `event.js`), it does **not** freeze rosters; never derive the draw time from `roster_freeze_at`;
  draw commit published 10.21; tokens valid until **2026-10-25T18:00:00+08:00**. Client-side defaults must equal these values (`event.js` `DATES`).
- One-time admin setup code: SHA-256 hex of the code = `a4c11992d2e41a1ccbaf90b01a4cd0f018884afbe40b82bb9ef65796eca4f8ed` (plaintext is given to the user only; never write it anywhere).

## 1. File ownership (do not edit files you do not own; ask via your final report instead)
| Path (under `portal/`) | Owner |
|---|---|
| `CONTRACT.md`, `docs/index.html`, `docs/404.html`, `docs/.nojekyll`, `docs/js/{config,api,router,ui,store,app}.js`, `docs/css/app.css` (base tokens & components) | lead (already written — do not edit; report needed changes) |
| `supabase/migrations/*.sql`, `supabase/tests/*.sql`, `tests/api.smoke.mjs` | DB builder |
| `docs/js/event.js`, `docs/js/logic.js`, `tests/logic.test.mjs` | Logic builder |
| `docs/js/pages/{home,rules,schedule,groups,bracket,faq,downloads,privacy,draw,tv}.js`, `docs/content/*.html`, `docs/css/public.css` | Public-UI builder |
| `docs/js/pages/{class,ref}.js`, `docs/css/ops.css` | Class/Referee-UI builder |
| `docs/js/pages/screen.js`, `docs/js/phase.js`, `docs/css/screen.css` (loaded by screen.js itself), `docs/fonts/*` (Oswald OFL), `tests/screen.test.mjs` | Lobby-screen builder |
| `docs/js/pages/admin.js`, `docs/js/admin/*.js` (optional sub-modules), `docs/js/print.js`, `docs/css/admin.css`, `docs/css/print.css`, `docs/js/vendor/qrcode.js` | Admin-UI builder |

Public asset file names (produced by the Docs builder; pages must link exactly these):
`docs/assets/img/12_Huvaari.png`, `docs/assets/img/12a_Huvaari_1r_odor.png`, `docs/assets/img/12b_Huvaari_2r_odor.png`,
`docs/assets/docs/02_Udirdamj.docx`, `docs/assets/docs/05_Zovshoorol.docx`, `docs/assets/docs/05b_Nemelt_zovshoorol.docx`,
`docs/assets/docs/06_Durem.docx`, `docs/assets/docs/12_Huvaari.pdf`.
| `docs/assets/**`, `_build/*` changes, Word docs, posters, SPEC, README (project root) | Docs builder |

## 2. Event data (`docs/js/event.js` exports, also mirrored in SQL seed)
Internal keys are Latin; display labels Cyrillic.
```js
// v5 (2026-10-15)
export const EVENT_NAME = 'Сургуулийн аварга – CS2 2026'; export const CUP_NAME = 'Сургуулийн аварга'; export const CHAMPION_TITLE = 'Сургуулийн аварга анги';
export const DATES = { reg_closes_at:'2026-10-23T23:59:59+08:00', roster_freeze_at:'2026-10-23T23:59:59+08:00', consent_deadline_at:'2026-10-23T17:00:00+08:00',
  fee_due_at:'2026-10-23T17:00:00+08:00', drill_from:'2026-10-19T00:00:00+08:00', drill_to:'2026-10-23T18:00:00+08:00',
  draw_commit_on:'2026-10-21T00:00:00+08:00', draw_at:'2026-10-22T16:00:00+08:00', links_expire_at:'2026-10-25T18:00:00+08:00' };
export const DRAW_AT = DATES.draw_at;
export const FEE = { team:120000, per_player:20000, teams:12, total:1440000 };          // v7: all 12 teams pay (teachers' team too)
export const PRIZES = { fund:800000 /* MVP included */, places_total:720000, place:[360000,240000,120000], per_player:[60000,40000,20000],
  mvp_cash:80000, mvp_cup:20000, items:570000, reserve:70000 };                           // 800 000 + 570 000 + 70 000 = 1 440 000
export const GROUPS = ['A','B','V','G'];                       // display: GROUP_LABEL
export const GROUP_LABEL = {A:'А', B:'Б', V:'В', G:'Г'};
export const GROUP_COLOR = {A:'#2563EB', B:'#16A34A', V:'#EA580C', G:'#9333EA'};   // small text on white: B #15803D, V #C2410C
export const STATION_LABEL = {A:'А станц', B:'Б станц'};
export const TEAMS = [ // id, code, name, pot, is_teachers  (pot order = SPEC §3 listing order)
  {id:1,code:'12a',name:'12а',pot:1}, {id:2,code:'11a',name:'11а',pot:1}, {id:3,code:'11b',name:'11б',pot:1},
  {id:4,code:'teachers',name:'Багш нарын баг',pot:1,is_teachers:true},
  {id:5,code:'10a',name:'10а',pot:2}, {id:6,code:'10b',name:'10б',pot:2}, {id:7,code:'10v',name:'10в',pot:2}, {id:8,code:'9a',name:'9а',pot:2},
  {id:9,code:'9b',name:'9б',pot:3}, {id:10,code:'8a',name:'8а',pot:3}, {id:11,code:'8b',name:'8б',pot:3}, {id:12,code:'8v',name:'8в',pot:3},
];  // hidden test team in DB only: id 99, code 'test', name 'ТЕСТ', is_hidden true (never shown publicly)
export const DRAW_ORDER = ['12a','11a','11b','teachers','10a','10b','10v','9a','9b','8a','8b','8v'];
export const MATCHES = [ // no, day, stage, code, grp, station, start, end (local +08), src_a, src_b
  // Day 1 group stage (MR12, no OT, draw allowed) — seats: 'seat:A1' = group A seat 1 (= pot 1 team of group A)
  {no:1, stage:'group',grp:'A',station:'A',start:'2026-10-24T09:45:00+08:00',end:'2026-10-24T10:45:00+08:00',src_a:'seat:A1',src_b:'seat:A2'},
  {no:2, stage:'group',grp:'B',station:'B',start:'…09:45',end:'…10:45',src_a:'seat:B1',src_b:'seat:B2'},
  {no:3, stage:'group',grp:'V',station:'A',start:'…10:45',end:'…11:45',src_a:'seat:V1',src_b:'seat:V2'},
  {no:4, stage:'group',grp:'G',station:'B',start:'…10:45',end:'…11:45',src_a:'seat:G1',src_b:'seat:G2'},
  {no:5, stage:'group',grp:'A',station:'A',start:'…11:45',end:'…12:45',src_a:'seat:A1',src_b:'seat:A3'},
  {no:6, stage:'group',grp:'B',station:'B',start:'…11:45',end:'…12:45',src_a:'seat:B1',src_b:'seat:B3'},
  {no:7, stage:'group',grp:'V',station:'A',start:'…13:45',end:'…14:45',src_a:'seat:V1',src_b:'seat:V3'},
  {no:8, stage:'group',grp:'G',station:'B',start:'…13:45',end:'…14:45',src_a:'seat:G1',src_b:'seat:G3'},
  {no:9, stage:'group',grp:'A',station:'A',start:'…14:45',end:'…15:45',src_a:'seat:A2',src_b:'seat:A3'},
  {no:10,stage:'group',grp:'B',station:'B',start:'…14:45',end:'…15:45',src_a:'seat:B2',src_b:'seat:B3'},
  {no:11,stage:'group',grp:'V',station:'A',start:'…15:45',end:'…16:45',src_a:'seat:V2',src_b:'seat:V3'},
  {no:12,stage:'group',grp:'G',station:'B',start:'…15:45',end:'…16:45',src_a:'seat:G2',src_b:'seat:G3'},
  // Day 2 knockout (MR12 + OT) — 'rank:A1' = group A winner, 'rank:B2' = group B runner-up; 'W:13' winner of match 13
  {no:13,stage:'qf',code:'1/4-1',station:'A',start:'2026-10-25T09:30:00+08:00',end:'…10:45',src_a:'rank:A1',src_b:'rank:B2'},
  {no:14,stage:'qf',code:'1/4-3',station:'B',start:'…09:30',end:'…10:45',src_a:'rank:B1',src_b:'rank:A2'},
  {no:15,stage:'qf',code:'1/4-2',station:'A',start:'…10:45',end:'…12:00',src_a:'rank:V1',src_b:'rank:G2'},
  {no:16,stage:'qf',code:'1/4-4',station:'B',start:'…10:45',end:'…12:00',src_a:'rank:G1',src_b:'rank:V2'},
  {no:17,stage:'sf',code:'1/2-1',station:'A',start:'…13:00',end:'…14:15',src_a:'W:13',src_b:'W:15'},
  {no:18,stage:'sf',code:'1/2-2',station:'B',start:'…13:00',end:'…14:15',src_a:'W:14',src_b:'W:16'},
  {no:19,stage:'final',code:'Финал',station:'A',start:'…14:45',end:'…16:00',src_a:'W:17',src_b:'W:18'},
  {no:20,stage:'third',code:'3-р байр',station:'B',start:'…14:45',end:'…16:00',src_a:'L:17',src_b:'L:18'},
];  // write full ISO timestamps (the '…' above is shorthand: same date as the first item of that day)
export const DAY_INFO = { // fixed non-match blocks for timetables (SPEC §7)
  d1: [['08:30','Бүртгэл'],['09:00','Нээлт'],['09:30','Нэвтрэлт, халаалт'],['12:45','Үдийн цай (13:45 хүртэл)'],['16:45','Нөөц цаг (17:45 хүртэл)']],
  d2: [['08:30','Нөөц ээлж (шаардлагатай бол)'],['08:45','Бүртгэл'],['12:00','Үдийн цай (13:00 хүртэл)'],['14:15','Завсарлага'],['16:15','Шагнал гардуулах, шилжин явах цом']] };
```
Group stage: groups A and V play on station A, B and G on station B. Same-group teams can meet again only in the final or the 3rd-place match.

## 3. Logic (`docs/js/logic.js`, pure ES module, no DOM, runs in browser and Node ≥22; imports `./event.js`)
Required exports (exact names):
- `sha256Hex(str) → Promise<string>` (UTF-8, lowercase hex; uses `globalThis.crypto.subtle`).
- `drawInputsString(nums)` → `"12a=1234,11a=5,…"` in `DRAW_ORDER`, decimal integers 0–9999 without leading zeros.
- `computeDraw(secretHex, nums) → Promise<{inputs, seed, keys:{code:hex}, groups:{A:[code,code,code],B:[…],V:[…],G:[…]}}>`:
  `seed = sha256Hex("cs2draw-v1|" + secretHex.toLowerCase() + "|" + inputs)`; `keys[code] = sha256Hex(seed + "|" + code)`; within each pot (pot order 1,2,3; teams per pot as in TEAMS) sort teams by key ascending (string compare of lowercase hex); position 0→A, 1→B, 2→V, 3→G; seat number = pot.
  **Test vector (must match in JS and SQL):** secret `00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff`, nums `{12a:1234,11a:5,11b:987,teachers:42,10a:0,10b:9999,10v:313,9a:777,9b:2024,8a:8,8b:55,8v:1001}` → inputs exactly `12a=1234,11a=5,11b=987,teachers=42,10a=0,10b=9999,10v=313,9a=777,9b=2024,8a=8,8b=55,8v=1001`, seed `362b441a74ad4f47eb6726b0238f078c114ca567640a5b96ea517dfa3f7d5798`, groups `{"A":["teachers","9a","9b"],"B":["12a","10b","8v"],"V":["11b","10a","8a"],"G":["11a","10v","8b"]}`.
- `validScore(stage, a, b, forfeit)`: group: `{13:0..11}` either way or `12:12`; knockout (qf/sf/final/third): `{13:0..11}` either way, or overtime winner `W = 16+3k (k≥0)` with loser `L ∈ [W-4, W-2]`; forfeit ('a' or 'b' = side that LOST by forfeit) ⇒ 13:0 for the other side.
- `seatMap(state)` → `{'A1':teamId,…}` from `state.draw.groups` (codes) or null before the draw.
- `groupStandings(state, grp, {official})` → `{grp, rows:[{teamId,seat,p,w,d,l,rf,ra,rd,pts,rank}], status:'pending'|'provisional'|'needs_lot'|'complete', tied:[[teamIds]]}`.
  Counts matches with status `final` (official) or `reported|final` (provisional). Ranking: points (3/1/0) → head-to-head points among the tied block → round difference within group → rounds won within group → `state.decisions[grp].lot` order (array of teamIds) → else status `needs_lot`. Re-apply from head-to-head on every sub-block that splits (3-way ties). `complete` = 3 final matches and no unresolved tie.
- `resolveMatches(state, {official})` → copy of matches with `team_a/team_b` filled: group matches from seats; `rank:X1/X2` only if that group is `complete` (official) ; `W:n`/`L:n` from final knockout results. Never throws; unknown → null.
- `finalRanking(state)` → `{order:[teamIds] (W19,L19,W20,L20 when known), classPlaces:[id1,id2,id3] (order without teachers, first 3), teachersAward:'honor'|'special'|null}` (honor if teachers reached a semifinal).
- `teamSchedule(state, teamId)` → that team's matches (resolved) sorted by time.
- `fmtScore(m)` helper → `"13 : 9"` / `"16 : 14 (OT)"` / `"13 : 0 (техникийн)"`; Bo3 (19, 20) → series `"2 : 1"` / `"2 : 0 (техникийн)"`, `''` until decided.
- Bo3 helpers (migration 14): `bestOf(m)` → 1|3 (from `m.best_of`), `vetoSequence(m, pool)` → acts per step (Bo3 `['ban','ban','pick','pick','ban','ban']`), `vetoState` adds `bo, acts, picks, maps, nextAct`, `seriesState(m, pool)` → `{bo, games:[{n,map,a,b,winner,ot}], wonA, wonB, decided, winner, maps, current, currentMap, valid}`, `fmtSeries(m)` → `"13:10 · 8:13 · 13:11"`.
`state` = the object returned by `cs2_public_state` (see §4) or the admin overview (same keys).

## 4. Database API (only these RPCs are callable by anon; all return `jsonb`; errors are returned as `{ok:false,error:<code>,…}` with HTTP 200, never raised, so attempt counters persist)
Error codes (`forbidden` may carry `reason`, e.g. Bo3 `games_started` / `pool_small`; `invalid_score` may carry `game` = the Bo3 game number): `bad_token`, `expired`, `closed`, `locked`, `pin_required`, `pin_wrong` (+`attempts_left`), `pin_locked` (+`until`), `version_conflict` (+current state), `validation` (+`errors:[{slot,field,code}]`), `bad_session`, `bad_credentials`, `throttled` (+`until`), `forbidden`, `not_found`, `invalid_score`, `draw_state`, `bad_commit`, `already_setup`, `bad_code`.

### Public
`cs2_public_state(p_version bigint default null)` →
- if `p_version` equals current: `{ok:true, version, unchanged:true}`
- else `{ok:true, version, now, settings:{reg_closes_at, consent_deadline_at, roster_freeze_at, registration_open, stream_url}, announcements:[{id,text,level,at}], teams:[{id,code,name,pot,is_teachers, reg:{players, confirmed, consents}}] (hidden test team excluded), draw:{status:'none'|'committed'|'computed'|'published', commit, secret, inputs:{code:n}, seed, groups:{A:[code,…],…}, history:[{status,reason,at}]}, matches:[{no,stage,code,grp,station,start,end,status,score_a,score_b,ot,forfeit,team_a,team_b}], decisions:{A:{lot:[ids]|null, approved:bool},…}}`
- Match privacy/spoiler rule: `score_a/score_b/forfeit/ot` are returned only if `status in ('reported','final')` AND `reported_at <= now() - interval '120 seconds'`; otherwise scores null and status downgraded to `'live'` if it was reported less than 120 s ago. `team_a/team_b` are stored for knockout when the admin/referee reports (for audit); clients still resolve via logic.

### Class (token = string from the URL)
- `cs2_class_get(p_token text)` → `{ok:true, team:{id,code,name,is_teachers}, now, window:{editable, needs_pin, reason:'open'|'closed'|'locked'|'frozen'|'confirmed', closes_at}, version, confirmed_at, players:[{slot,first_name,surname_initial,steam_nickname,steam_id64,is_captain,age13,consent_paper}], checks:{complete:bool, errors:[{slot,field,code}]}}`
- `cs2_class_save(p_token text, p_payload jsonb)`; payload `{expected_version:int, pin?:'1234', players:[{slot:1..6, first_name, surname_initial, steam_nickname, steam_id64?, is_captain, age13}]}` (slots 1–5 = starters, 6 = substitute; 5 or 6 players allowed) → same shape as `class_get` or error. If team already confirmed, `pin` is required and a successful save clears `confirmed_at`.
  Validation: first_name 1–30 letters/space/hyphen (Cyrillic or Latin); surname_initial exactly 1 letter; steam_nickname 2–32 chars; steam_id64 empty or `^7656119\d{10}$`; unique slots; ≤1 captain; nickname and steam_id64 unique across all teams (error does not reveal the other team).
- `cs2_class_confirm(p_token text, p_pin text, p_attest jsonb)`; attest `{enrolled:true, age13:true, own_steam:true, rules:true}` → `{ok:true, confirmed_at}` or error. Requires 5–6 players, exactly 1 captain, all `age13`, all 4 attestations. PIN: 5 wrong within 15 min → locked 15 min; 10 wrong total → locked until admin `pin_reset`.

### Referee (token from `#/ref/<token>`; valid 2026-10-24 07:00 → 2026-10-25 20:00 +08 — extended from 18:00 by migration 14 for the Bo3 finals)
- `cs2_ref_get(p_token)` → `{ok, label, station:'A'|'B'|null, chief:bool, matches:[{no,stage,code,grp,station,start,status,score_a,score_b,ot,forfeit,team_a,team_b}]}` (all matches of its station, unfiltered by the 120-s rule; chief = all).
- `cs2_ref_report(p_token, p_no int, p_action text, p_score_a int, p_score_b int, p_forfeit text, p_team_a int, p_team_b int)`; action `'live'` (sets status live) or `'report'` (validates with validScore rules, sets status `reported`, `reported_at=now()`); chief referee may also use `'final'`.
- `cs2_ref_veto(p_token, p_no int, p_action text, p_map text, p_step int, p_side text)` (migration 13, 2026-10-23) — map veto on the referee's device (regulation 02 §7.9): pool `settings.map_pool` (7 Active Duty maps: ancient, anubis, cache, dust2, inferno, mirage, nuke); bans alternate first, other, first, … (3 + 3), the map left is played. `p_action`: `'first'` (`p_side` `'a'|'b'|'coin'` = system coin toss; knockout only, before the first ban; a referee only while none is set, else `forbidden first_set` — the chief resets instead) · `'ban'` (`p_map`; optional `p_side` = the side the caller shows banning — another side → `stale`, nothing written) · `'undo'` (last ban) · `'reset'` (chief only). Group matches: side `a` (listed first) bans first automatically. `p_step` = bans the caller saw, else `{error:'stale', step}`. Station referee: own station while `scheduled`/`live`; nobody after `final`. Errors: `forbidden {reason: final|already_reported|group_fixed|veto_started|first_set (+ veto_first)|chief_only|first_missing|veto_done|veto_empty|other_station}`, `validation {errors:[{field:map|side|action, code:invalid|taken}]}`. → `{ok, match}`.
- Every match (public state, referee view, admin overview) carries `veto_first:'a'|'b'|null`, `veto_coin:bool`, `veto:[{side,map}]`, `map:<key>|null` — public at once (no 120-s hold); `settings.map_pool` is in the public state. Helpers: `event.js` `MAPS`, `logic.js` `mapPool`, `mapInfo`, `vetoState`.
- **Bo3 (migration 14, 2026-10-24; user decision): the final 19 and the 3rd-place match 20 are best of 3, everything else Bo1.** Every match also carries `best_of:1|3`, `maps:[key]|null` (Bo3: [first's pick, other's pick, decider] as the veto goes) and `games:[{a,b,map}]` (Bo3 per-map results; public: only games older than the 120-s hold, as a prefix; referee/admin: + `at`). Bo3 veto: `p_action` `'ban'`/`'pick'` must match `vetoSequence` at that step (ban, ban, pick, pick, ban, ban → decider), else `stale {step, act}`; veto entries add `act`; `map` stays null. Once a Bo3 game is entered, only an admin changes the veto (`forbidden games_started`). Each map = knockout MR12 + OT; first to 2 maps; series score in `score_a/score_b` once decided (2:0 / 2:1), forfeit = 0:2 / 2:0 with no games. Sides (not stored): on a picked map the other team chooses the starting side, decider = knife; the referee/admin pages build the MatchZy lines (`num_maps 3`, `maplist`, `map_sides`, `clinch_series`) with team1 = team_a.
- `cs2_ref_games(p_token, p_no int, p_games jsonb)` (migration 14) — Bo3 only: the FULL list of game results so far `[{a,b}]` (1–3; `[]` clears), idempotent. Undecided → status `live` (no score); decided → `reported` with the series score (120-s hold); the chief then finalises with `cs2_ref_report(…, 'final')`. Errors: `invalid_score {game}` (bad map score or a game after the series was decided), `validation` (not Bo3 / bad shape), `forbidden {reason: chief_only|other_station}`, `bad_token`, `expired`. `cs2_ref_report` on a Bo3 match: `'live'` keeps the games, forfeit → series 2:0, a round score → `invalid_score {reason:'series'}`.

### Admin
- `cs2_admin_setup(p_code text, p_label text, p_secret text)` → one-time: `sha256(p_code)` must equal `cs2.settings.setup_code_hash` and `cs2.settings.setup_used_at` must be null (else `bad_code` / `already_setup`); sets `setup_used_at`; secret ≥ 10 chars; stored bcrypt. (Test admins created directly by SQL during verification do not consume the setup code and must be deleted afterwards.)
- `cs2_admin_login(p_label text, p_secret text)` → `{ok, session, expires_at}` (12 h) | `bad_credentials` | `throttled` (5 fails/10 min per label).
- `cs2_admin_logout(p_session text)`.
- `cs2_admin(p_session text, p_action text, p_args jsonb)` → `{ok:true, …}`. Actions:
  - `overview` → same keys as public state but unfiltered (all scores, reported_at) **plus** `teams[i].players` (full incl. consents/alias), `teams[i].{confirmed_at,locked,unlocked_until,pin_locked_until,version,has_token}`, `referees:[{id,label,station,active}]`, `audit:[last 50]`.
  - `team_save {team_id, players}` (bypasses window; audited) · `team_unconfirm {team_id}` · `confirm_on_behalf {team_id, reason}`
  - `consent_set {player_id, consent_paper?, consent_3a?, consent_3b?, consent_3v?, alias?}`
  - `lock {team_id, locked}` · `unlock_until {team_id, until}` · `settings_set {registration_open?, stream_url?}`
  - `announce {text, level:'info'|'warn'}` · `announce_hide {id}`
  - `tokens_issue {kind:'class', team_id}` → `{token, pin}` · `{kind:'class_all'}` → `{items:[{team_id,code,name,token,pin}]}` (rotates all) · `{kind:'referee', station:'A'|'B'|null, label}` → `{token}` — plaintext returned ONCE, only hashes stored.
  - `pin_reset {team_id}` → `{pin}`
  - `export {kind:'roster'|'consent'|'results'|'matchzy'}` → `{columns, rows}` (matchzy → `{teams:{code:{name, players:{steam_id64: display}}}}`; display = `steam_nickname` only if `consent_3a` AND `consent_3b` are true, else alias, fallback «<анги>-Тоглогч<slot>» / «Багш-Тоглогч<slot>» — migration 11)
  - `draw_commit {commit}` (64 hex) · `draw_compute {secret, inputs:{code:n}}` (verifies sha256(secret)==commit, computes per §3, status `computed`) · `draw_publish {}` (status `published`, writes seats; once) · `draw_void {reason}` (allowed only if no group match reported) · `draw_manual {groups:{A:[code×3],…}, reason}` (physical-lot fallback, published directly)
  - `match_result {no, score_a, score_b, forfeit, ot, team_a, team_b, status:'reported'|'final'}` (Bo3: `{no, games:[{a,b}], forfeit?, team_a?, team_b?, status}`) · `match_update {no, start?, station?, status?}` (Bo3: `scheduled` clears the games) · `match_veto {no, action:'first'|'ban'|'pick'|'undo'|'reset', map?, step?, side?}` (same rules as `cs2_ref_veto`, admin may also reset and change `first` before the first ban)
  - `group_lot {grp, order:[teamIds], reason}` · `group_approve {grp, approved}`
  - `purge {phase:'stream'|'personal', confirm:'УСТГАХ'}` · `sessions_revoke {}`
- Every mutating call bumps `settings.version` and writes `cs2.audit_log` (no player names in audit detail).

## 5. Front-end shell (lead-owned, already present)
- `docs/js/config.js`: `SUPABASE_URL`, `SUPABASE_KEY`, `LEGACY_ANON_KEY`, `SITE_URL`, `BUILD`, `TZ='Asia/Ulaanbaatar'`;
  school facts `SCHOOL='Octolearn London School'`, `FB_PAGE='Octolearn London School'`, `CONTACT_NAME='А.Мөнгөншагай'`,
  `CONTACT_PHONES=['60114971','94741053']`, `CONTACT_PHONE='60114971, 94741053'` (display text only — build one `tel:` link per number from `CONTACT_PHONES`, e.g. `ui.phoneLinks()`; never strip the joined string into one `tel:`);
  v6 `STAFF = {director:'Д.Бямбасамбуу', lead:'Г.Жаргал', organiser:'А.Мөнгөншагай', it:['А.Мөнгөншагай','Б.Даваа','Д.Мажигсүрэн'], social:'Г.Энхнаран'}`,
  `PLACES = {lab:'Windows lab', hall:'Урлагийн заал'}` — pages import these instead of hard-coding names (public pages never show `STAFF.director`).
  Static fragments `content/*.html` use `<span data-cfg="KEY">fallback</span>` filled by `pages/rules.js` `fillConfig` (keys `SCHOOL`, `FB_PAGE`,
  `CONTACT_NAME`, `CONTACT_PHONE`, `EVENT_NAME`, `LEAD`, `ORGANISER`, `IT_TEAM`, `SOCIAL`, `LAB`, `HALL`; case suffixes are written after the span,
  e.g. `<span data-cfg="SOCIAL">Г.Энхнаран</span>д`) and `<span data-tel>` replaced by `ui.phoneLinks()`.
- `docs/js/api.js`: `rpc(fn, args)` → parsed JSON (throws only on network/HTTP errors); helpers `publicState(version)`, `classGet(t)`, `classSave(t,p)`, `classConfirm(t,pin,attest)`, `refGet(t)`, `refReport(t,…)`, `refVeto(t,…)`, `refGames(t, no, games)`, `adminSetup`, `adminLogin`, `adminLogout`, `admin(session, action, args)`.
- `docs/js/store.js`: `store.get()` latest public state; `store.subscribe(fn)`; polling every 20 s (TV/draw pages call `store.setInterval(5000)`), pauses when tab hidden, version short-circuit; `store.refresh()`.
- `docs/js/router.js`: routes `#/`, `#/rules`, `#/schedule`, `#/groups`, `#/bracket`, `#/faq`, `#/downloads`, `#/privacy`, `#/draw`, `#/tv`, `#/screen` (lobby poster, fullscreen), `#/k/<token>`, `#/ref/<token>`, `#/admin`, `#/print/<kind>`; each page module `docs/js/pages/<name>.js` exports `default async function render(root, params)` and may return a cleanup function. Unknown → home. Page modules are lazy-imported.
- `docs/js/ui.js`: `h(tag, attrs, ...children)` (sets text via textContent; attrs `class`, `style`, `on*`, `dataset`); `fmtTime(iso)` → `09:45`; `fmtDate(iso)` → `10.24 (Бямба)`; `fmtCountdown(ms)` → `2 хоног 04:12:09`; `toast(msg, kind)`; `teamName(state,id)`; `groupChip(grp)`; `stationLabel(st)`; `loading(root)`; `errorBox(root, msg)`; `copyText(str)`; `mnt(n)` → `120 000 ₮` (no-break spaces); `phoneLinks()` → organiser phones as separate `tel:` links.
- Header: school logo `docs/assets/img/logo-64.png` (srcset `logo-192.png`) + «Сургуулийн аварга / CS2 2026» + school name; favicon and apple-touch-icon `logo-192.png`. `icon.svg` (trophy) is no longer used by the public shell.
- Never use `innerHTML` with data from the API. `content/*.html` static fragments may be injected with `innerHTML` (they contain no user data).
- Design tokens in `docs/css/app.css`: navy `#1F2A44`, ink `#111827`, muted `#6B7280`, line `#E5E7EB`, gold `#B8860B` / light `#FEF3C7`, group colours above; body 17 px system font stack; tap targets ≥ 44 px; max content width 720 px (TV/draw full width); `lang="mn"`.

## 6. Pages (behaviour summary — details in the builder prompts)
Public: home (venue line, countdown, fee & prize-fund card, 5 steps, registration counts, key dates, format incl. own gear, «Зохион байгуулагч» card: lead, organiser + tel links, technical team, social worker — no director), rules (12 summary cards incl. «Хураамж», «Шагнал», «Өөрийн хэрэгсэл» `#rl-gear`, «Зохион байгуулалт» `#rl-org`; `#/rules/<id>` scrolls to `article#rl-<id>`), schedule (2 days, poster images + live table, opening venue), groups (standings), bracket (tree on desktop, stacked on phone, podium with cash prizes + MVP), faq (15 Q&A incl. fee/consent recipients, own gear, where to watch, where teams wait, whom to ask), downloads, privacy (data controller + organiser + social worker contacts), draw (screen in the Windows lab: commit → numbers → animated reveal → verify panel), tv (Урлагийн заал LED screen: now/next per station, call «… Windows lab-ын үүдэнд ирээрэй», standings/bracket rotation, `?overlay=1` minimal).
Home: the registration steps and counts are hidden after `roster_freeze_at` (10.23 23:59); anything labelled «сугалаа» uses `DRAW_AT`.
Ops: class page (status steps, 6 player cards, autosave draft in localStorage, Steam tips, teacher PIN keypad, print summary, "Манай тоглолтууд" after the draw), referee page, admin (login/setup, dashboard, roster edit, consent grid + auto alias, locks, announcements, token & PIN issue → print QR class cards / PIN slips / site QR poster, draw console, results entry, group lot/approve, exports CSV (UTF-8 BOM, formula-injection safe), purge).

Lobby screen `#/screen` (2026-10-19): a fixed 1920×1080 stage scaled to any 16:9 display; persistent header, phase countdown (`phase.js` `countdownFor`), site QR, ticker; rotating slides from `slidesFor(now, state, {live})` per phase `reg → closed → day1 → night → day2 → over`; from 2026-10-22 a published draw turns `reg`/`closed` into `prep` until 10.24 07:00 (groups, day-1 timetable by class, players' 10 rules, homeroom-teacher duties, own gear, good luck, prizes, watch; countdown to 10.24 09:00). Params: `static=1` (export: no animations, dates instead of ticking), `slide=<id>`, `t=<ISO>`, `rotate=<ms>`, `safe=1`, `debug=1`. DOM signals for the exporter: `html[data-screen-ready="1"]`, `html[data-slides]`, `html[data-phase]`, `.scr-stage[data-slide]`. Exports (PNG/JPG/MP4 for USB TVs) are made outside this repo by `_build/screen_export/` into the project folder `14_Delgets/`. CS2-style HUD without weapons; «Valve-ийн албан ёсны тэмцээн биш» shown once.

## 7. Content facts (must match SPEC v6)
Name «Сургуулийн аварга – CS2 2026» (cup: «Сургуулийн аварга» шилжин явах цом; title «Сургуулийн аварга анги»); school Octolearn London School;
people (v6): overall lead сургалтын менежер Г.Жаргал; organiser («Зохион байгуулагч») мэдээллийн технологийн багш А.Мөнгөншагай, утас 60114971, 94741053 (requests and questions go to the organiser; open issues are decided by the organiser, if needed in agreement with Г.Жаргал); technical team мэдээллийн технологийн багш нар А.Мөнгөншагай, Б.Даваа, Д.Мажигсүрэн; consent & child protection нийгмийн ажилтан Г.Энхнаран (homeroom teachers collect 05/05б and hand them to her); team managers = homeroom teachers; no committee, no accountant, never the director's name on public pages;
places (v6): players in the Windows lab (компьютерийн лаборатори); spectators in the Урлагийн заал on an LED screen (not a projector); teams wait in their own classrooms, managers bring them to the Windows lab entrance 15 min before the slot; opening 10.24 09:00 in the Урлагийн заал; technical meeting + draw in the Windows lab; own gear (mouse, keyboard, headset, mousepad) allowed: USB plug-and-play only, nothing installed on lab PCs, no macros/scripts/turbo (referees may inspect), connect only during login/warm-up, wireless charged (Bluetooth headsets not recommended), labelled with name + class, the player's own responsibility;
12 teams (11 classes + Багш нарын баг), roster 6 (5+1), girls play in class teams;
team fee 120 000 ₮ per team for all 12 teams incl. the teachers' team (≈20 000 ₮ per player; the teachers' team gets no cash prize); paid by the captain or a class representative to the organiser А.Мөнгөншагай (cash, or transfer to the school account; receipt) by 10.23 (Ба) 17:00, the organiser keeps the fee register; homeroom teachers never collect money; unpaid team does not play (0:13 technical losses); full refund only if the tournament is cancelled; paid classes announced on the portal (admin «Зарлал») and in the managers' chat; public report after the event;
cash prize fund 800 000 ₮ incl. MVP (class ranking): 1st 360 000, 2nd 240 000, 3rd 120 000 ₮ (shared equally by 6 players: 60 000 / 40 000 / 20 000 ₮; captain signs the prize register at the closing), in addition to cup/medals/өргөмжлөл; MVP «Тэмцээний шилдэг тоглогч (MVP)» = small cup + 80 000 ₮ + өргөмжлөл, class-team players only, chosen by the chief referee and the organiser from all matches' statistics, announced at the closing; all fees go to the awards (12 × 120 000 = 1 440 000 = cash 800 000 + cup/medals/өргөмжлөл/MVP cup 570 000 + reserve 70 000); no other awards, no participation certificates; «Skin, item, бооцоо байхгүй»;
dates: QR cards + PIN slips 10.15–10.16, Steam drill 10.19–23, draw commit 10.21, draw 10.22 (Пү) 16:00 (each class sends its captain or a representative; does not freeze rosters), consent 05 + 05б, paper form 04 and fee 10.23 (Ба) 17:00, online registration = roster freeze 10.23 (Ба) 23:59, Day 1 10.24 (Бя) group stage 09:45–16:45, Day 2 10.25 (Ня) 09:30 QF, 13:00 SF, 14:30–17:15 final + 3rd (Bo3, migration 14; was 14:45 Bo1), 17:30 awards (was 16:15); ends ≈ 18:00, class/referee links valid until 20:00; MR12 = first to 13; group draw 12:12 allowed (3/1/0); knockout OT; >10 min late → 13:0; phones handed to referees; open Facebook stream on the school's Page «Octolearn London School» with 90 s delay, game feed + casters only, aliases if no online consent, videos removed by 11.01; cup, medals and cash only to class teams (teachers' rule); Valve Limited Game Tournament License — not an official Valve event; law name «Хүний хувийн мэдээлэл хамгаалах тухай хууль». School facts come from `config.js` (`SCHOOL`, `FB_PAGE`, `CONTACT_NAME`, `CONTACT_PHONES`, `STAFF`, `PLACES`); no `[...]` placeholders on the public site.

## 8. Testing duties
- Logic: `node --test portal/tests` (draw vector, scores, standings incl. 12:12 & 3-way ties & lot, bracket resolution, class places for teachers out / win final / lose final / win 3rd / lose 3rd, same-group meeting property).
- DB: SQL tests in `begin … rollback` with ASSERTs (draw vector, validation, PIN lockout, deadlines via settings override, 120-s hold, grants: anon cannot select any `cs2.*`, other schemas' grants unchanged), `get_advisors` clean for cs2, `tests/api.smoke.mjs` hitting the live REST API with the publishable key (public_state OK; direct table read fails; class flow with the hidden test team token).
