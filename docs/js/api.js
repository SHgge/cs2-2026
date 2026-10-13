// Supabase RPC — зөвхөн public.cs2_* функцуудыг fetch-ээр дуудна.
import { SUPABASE_URL, SUPABASE_KEY, LEGACY_ANON_KEY } from './config.js';

let useLegacy = false;

function headers() {
  const key = useLegacy ? LEGACY_ANON_KEY : SUPABASE_KEY;
  const h = { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' };
  if (useLegacy) h.Authorization = `Bearer ${key}`;
  return h;
}

/** Calls public.<fn>(args). Returns parsed JSON. Throws Error('network'|'http_<status>') only on transport errors. */
export async function rpc(fn, args = {}) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: headers(), body: JSON.stringify(args), cache: 'no-store', referrerPolicy: 'no-referrer',
    });
  } catch (e) {
    throw new Error('network');
  }
  if ((res.status === 401 || res.status === 403) && !useLegacy) {
    useLegacy = true;               // publishable түлхүүр ажиллахгүй бол хуучин anon түлхүүрээр дахин оролдоно
    return rpc(fn, args);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch { /* ignore */ }
    const err = new Error(`http_${res.status}`);
    err.detail = detail;
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const publicState = (version = null) => rpc('cs2_public_state', { p_version: version });
export const classGet = (token) => rpc('cs2_class_get', { p_token: token });
export const classSave = (token, payload) => rpc('cs2_class_save', { p_token: token, p_payload: payload });
export const classConfirm = (token, pin, attest) =>
  rpc('cs2_class_confirm', { p_token: token, p_pin: pin, p_attest: attest });
export const refGet = (token) => rpc('cs2_ref_get', { p_token: token });
export const refReport = (token, no, action, scoreA = null, scoreB = null, forfeit = null, teamA = null, teamB = null) =>
  rpc('cs2_ref_report', {
    p_token: token, p_no: no, p_action: action, p_score_a: scoreA, p_score_b: scoreB,
    p_forfeit: forfeit, p_team_a: teamA, p_team_b: teamB,
  });
export const adminSetup = (code, label, secret) => rpc('cs2_admin_setup', { p_code: code, p_label: label, p_secret: secret });
export const adminLogin = (label, secret) => rpc('cs2_admin_login', { p_label: label, p_secret: secret });
export const adminLogout = (session) => rpc('cs2_admin_logout', { p_session: session });
export const admin = (session, action, args = {}) =>
  rpc('cs2_admin', { p_session: session, p_action: action, p_args: args });

/** Mongolian message for an API error code. */
export function errorText(r) {
  const code = r && r.error;
  const map = {
    bad_token: 'Холбоос буруу эсвэл хүчингүй болсон байна. Багшаасаа шинэ QR авна уу.',
    expired: 'Холбоосын хугацаа дууссан байна.',
    closed: 'Бүртгэл хаагдсан. Өөрчлөлтийг зохион байгуулагч багшаар хийлгэнэ үү.',
    locked: 'Бүртгэлийг түгжсэн байна. Зохион байгуулагчид хандана уу.',
    pin_required: 'Багшийн PIN код шаардлагатай.',
    pin_wrong: `PIN буруу.${r && r.attempts_left != null ? ` ${r.attempts_left} оролдлого үлдлээ.` : ''}`,
    pin_locked: 'PIN түр түгжигдсэн. Хэсэг хугацааны дараа дахин оролдоно уу.',
    version_conflict: 'Өөр хүн өөрчлөлт хийсэн байна. Хуудсыг шинэчилнэ үү.',
    validation: 'Мэдээллээ шалгана уу.',
    bad_session: 'Нэвтрэх хугацаа дууссан. Дахин нэвтэрнэ үү.',
    bad_credentials: 'Нэр эсвэл нууц үг буруу.',
    throttled: 'Олон удаа буруу оролдсон. Түр хүлээгээд дахин оролдоно уу.',
    forbidden: 'Энэ үйлдлийг хийх эрхгүй.',
    not_found: 'Олдсонгүй.',
    invalid_score: 'Оноо дүрэмд нийцэхгүй байна.',
    draw_state: 'Сугалааны энэ алхмыг одоо хийх боломжгүй.',
    bad_commit: 'Нууц тоо commit-тэй таарахгүй байна.',
    already_setup: 'Админ аль хэдийн тохируулагдсан.',
    bad_code: 'Тохиргооны код буруу.',
  };
  return map[code] || 'Алдаа гарлаа. Дахин оролдоно уу.';
}
