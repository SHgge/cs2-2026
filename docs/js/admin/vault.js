// Нэг удаа гарах нууц кодууд (ангийн token, багшийн PIN, шүүгчийн token, сугалааны нууц тоо).
// ЗӨВХӨН энэ цонхны санах ойд хадгална: sessionStorage/localStorage/файлд бичихгүй.
// admin.js болон print.js нэг модулийг (js/admin/vault.js) импортлох тул өгөгдөл хуваалцана.

const classes = new Map(); // team_id → {team_id, code, name, is_teachers, token|null, pin|null, at}
let referees = [];          // [{label, station, token, at}]
let draw = null;            // {secret, commit, at, saved}
const meta = { regClosesAt: null };
const subs = new Set();

function notify() { for (const fn of subs) { try { fn(); } catch (e) { console.error(e); } } }

export const vault = {
  /** token and/or pin for one class team (tokens_issue / pin_reset results). */
  putClass(team, { token, pin } = {}) {
    const prev = classes.get(team.id) || {};
    classes.set(team.id, {
      team_id: team.id, code: team.code, name: team.name, is_teachers: !!team.is_teachers, hidden: !!team.is_hidden,
      token: token !== undefined ? token : (prev.token || null),
      pin: pin !== undefined ? pin : (prev.pin || null),
      at: new Date().toISOString(),
    });
    notify();
  },
  classes() { return [...classes.values()].sort((a, b) => a.team_id - b.team_id); },
  classOf(teamId) { return classes.get(teamId) || null; },
  addReferee(r) { referees = [...referees, { ...r, at: new Date().toISOString() }]; notify(); },
  referees() { return referees.slice(); },
  setDraw(secret, commit) { draw = { secret, commit, at: new Date().toISOString(), saved: false }; notify(); },
  markDrawSaved() { if (draw) { draw.saved = true; notify(); } },
  draw() { return draw ? { ...draw } : null; },
  setMeta(m) { Object.assign(meta, m || {}); },
  meta() { return { ...meta }; },
  /** number of plaintext secrets held */
  count() {
    let n = referees.length + (draw ? 1 : 0);
    for (const c of classes.values()) n += (c.token ? 1 : 0) + (c.pin ? 1 : 0);
    return n;
  },
  isEmpty() { return vault.count() === 0; },
  clearClasses() { classes.clear(); notify(); },
  clearReferees() { referees = []; notify(); },
  clear() { classes.clear(); referees = []; draw = null; notify(); },
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
};

// Хэвлээгүй код алдагдахаас сэрэмжлүүлнэ (F5, цонх хаах).
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (!vault.isEmpty()) { e.preventDefault(); e.returnValue = ''; }
  });
}
