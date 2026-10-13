// Нэг удаа гарах нууц кодууд (ангийн token, багшийн PIN, шүүгчийн token, сугалааны нууц тоо).
// ЗӨВХӨН энэ цонхны санах ойд хадгална: sessionStorage/localStorage/файлд бичихгүй.
// admin.js болон print.js нэг модулийг (js/admin/vault.js) импортлох тул өгөгдөл хуваалцана.

const classes = new Map(); // team_id → {team_id, code, name, is_teachers, token|null, pin|null, at}
let referees = [];          // [{label, station, token, at}]
let draw = null;            // {secret, commit, at, saved}
const meta = { regClosesAt: null };
const subs = new Set();

// Copy first: a subscriber may re-render and re-subscribe while we iterate (a live Set would loop forever).
function notify() { for (const fn of [...subs]) { try { fn(); } catch (e) { console.error(e); } } }

export const vault = {
  /** token and/or pin for one class team (tokens_issue / pin_reset results). */
  putClass(team, codes = {}) { vault.putClasses([[team, codes]]); },
  /** Several at once (one notification): [[team, {token?, pin?}], …] */
  putClasses(list) {
    for (const [team, { token, pin } = {}] of list) {
      const prev = classes.get(team.id) || {};
      classes.set(team.id, {
        team_id: team.id, code: team.code, name: team.name, is_teachers: !!team.is_teachers, hidden: !!team.is_hidden,
        token: token !== undefined ? token : (prev.token || null),
        pin: pin !== undefined ? pin : (prev.pin || null),
        at: new Date().toISOString(),
      });
    }
    notify();
  },
  classes() { return [...classes.values()].sort((a, b) => a.team_id - b.team_id); },
  classOf(teamId) { return classes.get(teamId) || null; },
  /** Items holding `kind` ('token'|'pin') to print/copy: real classes; the hidden test team only when no real one is held. */
  printable(kind) {
    const all = vault.classes().filter((c) => c[kind]);
    const real = all.filter((c) => !c.hidden);
    return real.length ? real : all;
  },
  addReferee(r) { referees = [...referees, { ...r, at: new Date().toISOString() }]; notify(); },
  referees() { return referees.slice(); },
  setDraw(secret, commit) { draw = { secret, commit, at: new Date().toISOString(), saved: false }; notify(); },
  markDrawSaved() { if (draw) { draw.saved = true; notify(); } },
  draw() { return draw ? { ...draw } : null; },
  setMeta(m) { Object.assign(meta, m || {}); },
  meta() { return { ...meta }; },
  /** plaintext secrets held, by kind: {class, referee, draw (0|1), drawUnsaved (0|1)} */
  counts() {
    let cls = 0;
    for (const c of classes.values()) cls += (c.token ? 1 : 0) + (c.pin ? 1 : 0);
    return { class: cls, referee: referees.length, draw: draw ? 1 : 0, drawUnsaved: draw && !draw.saved ? 1 : 0 };
  },
  /** number of plaintext secrets held */
  count() { const c = vault.counts(); return c.class + c.referee + c.draw; },
  /** secrets that would be lost for good on reload (a draw secret already downloaded/printed does not count) */
  unsaved() { const c = vault.counts(); return c.class + c.referee + c.drawUnsaved; },
  isEmpty() { return vault.count() === 0; },
  clearDraw() { if (draw) { draw = null; notify(); } },
  clearClasses() { classes.clear(); notify(); },
  clearReferees() { referees = []; notify(); },
  clear() { classes.clear(); referees = []; draw = null; notify(); },
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
};

// Хэвлээгүй код алдагдахаас сэрэмжлүүлнэ (F5, цонх хаах).
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (vault.unsaved() > 0) { e.preventDefault(); e.returnValue = ''; }
  });
}
