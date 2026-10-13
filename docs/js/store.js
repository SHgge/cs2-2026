// Нийтийн төлөвийг (cs2_public_state) тогтмол шинэчилж, захиалагчдад мэдэгдэнэ.
import { publicState } from './api.js';

let state = null;
let version = null;
let intervalMs = 20000;
let timer = null;
let lastError = null;
let lastOkAt = 0;
const subs = new Set();

function notify() { for (const fn of subs) { try { fn(state, { error: lastError, lastOkAt }); } catch (e) { console.error(e); } } }

async function poll() {
  try {
    const r = await publicState(version);
    if (r && r.ok) {
      lastError = null;
      lastOkAt = Date.now();
      if (!r.unchanged) { state = r; version = r.version; notify(); }
    } else {
      lastError = (r && r.error) || 'unknown';
      notify();
    }
  } catch (e) {
    lastError = e.message || 'network';
    notify();
  }
}

function schedule() {
  clearTimeout(timer);
  if (document.hidden) return;
  timer = setTimeout(async () => { await poll(); schedule(); }, intervalMs);
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll().then(schedule); } else clearTimeout(timer); });

export const store = {
  get: () => state,
  status: () => ({ error: lastError, lastOkAt, stale: lastOkAt > 0 && Date.now() - lastOkAt > 5 * 60 * 1000 }),
  subscribe(fn) { subs.add(fn); if (state) fn(state, { error: lastError, lastOkAt }); return () => subs.delete(fn); },
  async refresh() { version = null; await poll(); schedule(); return state; },
  async ready() { if (!state) await poll(); schedule(); return state; },
  setInterval(ms) { intervalMs = ms; schedule(); },
};
