// QR код — vendor/qrcode.js (qrcode-generator 1.4.4, MIT)-ийг <script> таг-аар ачаална. Онлайн QR үйлчилгээ ашиглахгүй.
import { BUILD } from '../config.js';

let pending = null;

/** Loads js/vendor/qrcode.js once; resolves to the global `qrcode` factory. */
export function loadQr() {
  if (typeof window.qrcode === 'function') return Promise.resolve(window.qrcode);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `js/vendor/qrcode.js?v=${BUILD}`;
      s.async = true;
      s.onload = () => (typeof window.qrcode === 'function' ? resolve(window.qrcode) : reject(new Error('qr_missing')));
      s.onerror = () => { pending = null; s.remove(); reject(new Error('qr_load')); };
      document.head.appendChild(s);
    });
  }
  return pending;
}

/** SVG markup generated locally by the library (no text from the API inside the markup). */
export function qrSvgMarkup(qrcode, text, ecl = 'M') {
  const q = qrcode(0, ecl);
  q.addData(String(text));
  q.make();
  // margin = 2 modules (cellSize 4 → 8); the white card around adds the rest of the quiet zone.
  return { svg: q.createSvgTag({ cellSize: 4, margin: 8, scalable: true }), modules: q.getModuleCount() };
}

/** <div class="qr …"> with the QR as inline SVG. */
export function qrNode(qrcode, text, cls = '') {
  const { svg, modules } = qrSvgMarkup(qrcode, text);
  const box = document.createElement('div');
  box.className = `qr ${cls}`.trim();
  box.dataset.modules = String(modules);
  box.innerHTML = svg; // generated SVG only (allowed by CONTRACT §5)
  const el = box.firstElementChild;
  if (el) { el.setAttribute('aria-hidden', 'true'); el.setAttribute('focusable', 'false'); }
  return box;
}
