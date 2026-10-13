# CONTRACT — «Ангийн аварга – CS2 2026» online portal (binding for every builder)

Read this whole file first. Also read `C:\Users\wisez\Cs2event\_build\SPEC.md` (SPEC v4, tournament facts) — the portal must never contradict it.
Language of all user-facing text: Mongolian Cyrillic, short plain sentences (≤15 words), students addressed with «-аарай», adults «-на уу».

## 0. Decisions (fixed)
- Hosting: GitHub Pages, repo `SHgge/cs2-2026` (public), site root = `portal/docs/`, URL **https://shgge.github.io/cs2-2026/**. No build step: plain HTML/CSS/ES modules. Hash router.
- Backend: Supabase project `https://wwpxsxikeztvvgryltdp.supabase.co`, **shared with other company apps** → everything lives in schema `cs2` (tables) + `cs2_api` (SECURITY DEFINER functions) + thin `public.cs2_*` SECURITY INVOKER wrappers. NEVER touch other schemas/tables/grants. No Realtime, no Edge Functions, no Supabase Auth.
- Browser → Supabase: plain `fetch` POST to `${SUPABASE_URL}/rest/v1/rpc/<fn>` with header `apikey: <publishable key>` and `Content-Type: application/json` (see `docs/js/api.js`). Publishable key: `sb_publishable_3qVbHvZtEnnXJ_INQTQKjw_MKir4rC8` (public by design). Fallback legacy anon JWT is in `config.js` (also public).
- Access: class team page by secret token in the URL fragment `#/k/<token>`; homeroom teacher confirms with a 4-digit PIN; referees `#/ref/<token>`; organiser `#/admin` (own secret + DB session). Public pages show ONLY team (class) names, schedule, scores, groups, bracket, counts — **never player names, nicknames or SteamIDs**.
- Parental consent stays on paper (form 05/05б); the system only records ticks.
- Deadlines (Asia/Ulaanbaatar = UTC+8, no DST): registration closes **2026-10-16T17:00:00+08:00**; consents **2026-10-21T17:00:00+08:00**; roster freeze (draw) **2026-10-22T16:00:00+08:00**; tokens valid until **2026-10-25T18:00:00+08:00**.
- One-time admin setup code: SHA-256 hex of the code = `a4c11992d2e41a1ccbaf90b01a4cd0f018884afbe40b82bb9ef65796eca4f8ed` (plaintext is given to the user only; never write it anywhere).

## 1. File ownership (do not edit files you do not own; ask via your final report instead)
| Path (under `portal/`) | Owner |
|---|---|
| `CONTRACT.md`, `docs/index.html`, `docs/404.html`, `docs/.nojekyll`, `docs/js/{config,api,router,ui,store,app}.js`, `docs/css/app.css` (base tokens & components) | lead (already written — do not edit; report needed changes) |
| `supabase/migrations/*.sql`, `supabase/tests/*.sql`, `tests/api.smoke.mjs` | DB builder |
| `docs/js/event.js`, `docs/js/logic.js`, `tests/logic.test.mjs` | Logic builder |
| `docs/js/pages/{home,rules,schedule,groups,bracket,faq,downloads,privacy,draw,tv}.js`, `docs/content/*.html`, `docs/css/public.css` | Public-UI builder |
| `docs/js/pages/{class,ref}.js`, `docs/css/ops.css` | Class/Referee-UI builder |
| `docs/js/pages/admin.js`, `docs/js/admin/*.js` (optional sub-modules), `docs/js/print.js`, `docs/css/admin.css`, `docs/css/print.css`, `docs/js/vendor/qrcode.js` | Admin-UI builder |

Public asset file names (produced by the Docs builder; pages must link exactly these):
`docs/assets/img/12_Huvaari.png`, `docs/assets/img/12a_Huvaari_1r_odor.png`, `docs/assets/img/12b_Huvaari_2r_odor.png`,
`docs/assets/docs/02_Udirdamj.docx`, `docs/assets/docs/05_Zovshoorol.docx`, `docs/assets/docs/05b_Nemelt_zovshoorol.docx`,
`docs/assets/docs/06_Durem.docx`, `docs/assets/docs/12_Huvaari.pdf`.
| `docs/assets/**`, `_build/*` changes, Word docs, posters, SPEC, README (project root) | Docs builder |

## 2. Event data (`docs/js/event.js` exports, also mirrored in SQL seed)
Internal keys are Latin; display labels Cyrillic.
```js
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
- `fmtScore(m)` helper → `"13 : 9"` / `"16 : 14 (OT)"` / `"13 : 0 (техникийн)"`.
`state` = the object returned by `cs2_public_state` (see §4) or the admin overview (same keys).

## 4. Database API (only these RPCs are callable by anon; all return `jsonb`; errors are returned as `{ok:false,error:<code>,…}` with HTTP 200, never raised, so attempt counters persist)
Error codes: `bad_token`, `expired`, `closed`, `locked`, `pin_required`, `pin_wrong` (+`attempts_left`), `pin_locked` (+`until`), `version_conflict` (+current state), `validation` (+`errors:[{slot,field,code}]`), `bad_session`, `bad_credentials`, `throttled` (+`until`), `forbidden`, `not_found`, `invalid_score`, `draw_state`, `bad_commit`, `already_setup`, `bad_code`.

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

### Referee (token from `#/ref/<token>`; valid 2026-10-24 07:00 → 2026-10-25 18:00 +08)
- `cs2_ref_get(p_token)` → `{ok, label, station:'A'|'B'|null, chief:bool, matches:[{no,stage,code,grp,station,start,status,score_a,score_b,ot,forfeit,team_a,team_b}]}` (all matches of its station, unfiltered by the 120-s rule; chief = all).
- `cs2_ref_report(p_token, p_no int, p_action text, p_score_a int, p_score_b int, p_forfeit text, p_team_a int, p_team_b int)`; action `'live'` (sets status live) or `'report'` (validates with validScore rules, sets status `reported`, `reported_at=now()`); chief referee may also use `'final'`.

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
  - `match_result {no, score_a, score_b, forfeit, ot, team_a, team_b, status:'reported'|'final'}` · `match_update {no, start?, station?, status?}`
  - `group_lot {grp, order:[teamIds], reason}` · `group_approve {grp, approved}`
  - `purge {phase:'stream'|'personal', confirm:'УСТГАХ'}` · `sessions_revoke {}`
- Every mutating call bumps `settings.version` and writes `cs2.audit_log` (no player names in audit detail).

## 5. Front-end shell (lead-owned, already present)
- `docs/js/config.js`: `SUPABASE_URL`, `SUPABASE_KEY`, `LEGACY_ANON_KEY`, `SITE_URL`, `BUILD`, `TZ='Asia/Ulaanbaatar'`.
- `docs/js/api.js`: `rpc(fn, args)` → parsed JSON (throws only on network/HTTP errors); helpers `publicState(version)`, `classGet(t)`, `classSave(t,p)`, `classConfirm(t,pin,attest)`, `refGet(t)`, `refReport(t,…)`, `adminSetup`, `adminLogin`, `adminLogout`, `admin(session, action, args)`.
- `docs/js/store.js`: `store.get()` latest public state; `store.subscribe(fn)`; polling every 20 s (TV/draw pages call `store.setInterval(5000)`), pauses when tab hidden, version short-circuit; `store.refresh()`.
- `docs/js/router.js`: routes `#/`, `#/rules`, `#/schedule`, `#/groups`, `#/bracket`, `#/faq`, `#/downloads`, `#/privacy`, `#/draw`, `#/tv`, `#/k/<token>`, `#/ref/<token>`, `#/admin`, `#/print/<kind>`; each page module `docs/js/pages/<name>.js` exports `default async function render(root, params)` and may return a cleanup function. Unknown → home. Page modules are lazy-imported.
- `docs/js/ui.js`: `h(tag, attrs, ...children)` (sets text via textContent; attrs `class`, `style`, `on*`, `dataset`); `fmtTime(iso)` → `09:45`; `fmtDate(iso)` → `10.24 (Бямба)`; `fmtCountdown(ms)` → `2 хоног 04:12:09`; `toast(msg, kind)`; `teamName(state,id)`; `groupChip(grp)`; `stationLabel(st)`; `loading(root)`; `errorBox(root, msg)`; `copyText(str)`.
- Never use `innerHTML` with data from the API. `content/*.html` static fragments may be injected with `innerHTML` (they contain no user data).
- Design tokens in `docs/css/app.css`: navy `#1F2A44`, ink `#111827`, muted `#6B7280`, line `#E5E7EB`, gold `#B8860B` / light `#FEF3C7`, group colours above; body 17 px system font stack; tap targets ≥ 44 px; max content width 720 px (TV/draw full width); `lang="mn"`.

## 6. Pages (behaviour summary — details in the builder prompts)
Public: home, rules (10 summary cards), schedule (2 days, poster images + live table), groups (standings), bracket (tree on desktop, stacked on phone, podium), faq (12 Q&A), downloads, privacy, draw (projector: commit → numbers → animated reveal → verify panel), tv (now/next per station, standings/bracket rotation, `?overlay=1` minimal).
Ops: class page (status steps, 6 player cards, autosave draft in localStorage, Steam tips, teacher PIN keypad, print summary, "Манай тоглолтууд" after the draw), referee page, admin (login/setup, dashboard, roster edit, consent grid + auto alias, locks, announcements, token & PIN issue → print QR class cards / PIN slips / site QR poster, draw console, results entry, group lot/approve, exports CSV (UTF-8 BOM, formula-injection safe), purge).

## 7. Content facts (must match SPEC v4)
12 teams (11 classes + Багш нарын баг), roster 6 (5+1), girls play in class teams, no fees; dates: registration 10.16 (Ба) 17:00, Steam drill 10.19–21, consent 10.21 (Лх) 17:00, draw 10.22 (Пү) 16:00, Day 1 10.24 (Бя) group stage 09:45–16:45, Day 2 10.25 (Ня) 09:30 QF, 13:00 SF, 14:45 final + 3rd, 16:15 awards; nothing after 18:00; MR12 = first to 13; group draw 12:12 allowed (3/1/0); knockout OT; >10 min late → 13:0; phones handed to referees; open Facebook stream «[Facebook хуудасны нэр]» with 90 s delay, game feed + casters only, aliases if no online consent, videos removed by 11.01; cup only to class teams (teachers' rule); awards: champion cup + gold medals + өргөмжлөл, 2nd silver + өргөмжлөл, 3rd bronze + өргөмжлөл; Valve Limited Game Tournament License — not an official Valve event; law name «Хүний хувийн мэдээлэл хамгаалах тухай хууль»; placeholders shown literally as `[Сургуулийн нэр]`, `[Facebook хуудасны нэр]`, `[Зохион байгуулагч багшийн нэр]`, `[Утас]` (configured in `config.js` → `SCHOOL`, `FB_PAGE`, `CONTACT_NAME`, `CONTACT_PHONE`).

## 8. Testing duties
- Logic: `node --test portal/tests` (draw vector, scores, standings incl. 12:12 & 3-way ties & lot, bracket resolution, class places for teachers out / win final / lose final / win 3rd / lose 3rd, same-group meeting property).
- DB: SQL tests in `begin … rollback` with ASSERTs (draw vector, validation, PIN lockout, deadlines via settings override, 120-s hold, grants: anon cannot select any `cs2.*`, other schemas' grants unchanged), `get_advisors` clean for cs2, `tests/api.smoke.mjs` hitting the live REST API with the publishable key (public_state OK; direct table read fails; class flow with the hidden test team token).
