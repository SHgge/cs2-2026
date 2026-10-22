// Нийтийн тохиргоо. Энд НУУЦ мэдээлэл байхгүй (publishable түлхүүр нь зориудаар нийтэд нээлттэй).
export const SUPABASE_URL = 'https://wwpxsxikeztvvgryltdp.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_3qVbHvZtEnnXJ_INQTQKjw_MKir4rC8';
export const LEGACY_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3cHhzeGlrZXp0dnZncnlsdGRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4Njc4NjAsImV4cCI6MjA5NTQ0Mzg2MH0.1SP8RRWZphN4fhHmL9lccRw6CF4Jj7Dthb6ia9lALJw';
export const SITE_URL = 'https://shgge.github.io/cs2-2026/';
export const BUILD = '20261022-1743';
export const TZ = 'Asia/Ulaanbaatar';

// Сургуулийн мэдээлэл (SPEC v5, 2026-10-15).
export const SCHOOL = 'Octolearn London School';
export const FB_PAGE = 'Octolearn London School';            // сургуулийн албан ёсны Facebook хуудас
export const CONTACT_NAME = 'А.Мөнгөншагай';                  // зохион байгуулагч (мэдээллийн технологийн багш)
/** Утасны дугаарууд тус бүрдээ (tel: холбоос дугаар бүрд тусдаа). */
export const CONTACT_PHONES = Object.freeze(['60114971', '94741053']);
/** Харуулах текст: «60114971, 94741053». tel: холбоосыг CONTACT_PHONES-оос үүсгэнэ. */
export const CONTACT_PHONE = CONTACT_PHONES.join(', ');

/** SPEC v6 (2026-10-19): people and places. There is no committee and no accountant — the organiser collects the fee. */
export const STAFF = Object.freeze({
  director: 'Д.Бямбасамбуу',                                   // захирал (удирдамж, тушаал батална)
  lead: 'Г.Жаргал',                                            // сургалтын менежер — ерөнхий удирдлага
  organiser: CONTACT_NAME,                                      // зохион байгуулагч, хураамж хүлээн авна
  it: Object.freeze(['А.Мөнгөншагай', 'Б.Даваа', 'Д.Мажигсүрэн']),  // мэдээллийн технологийн багш нар — техникийн баг
  social: 'Г.Энхнаран',                                         // нийгмийн ажилтан — зөвшөөрөл, хүүхэд хамгаалал
});
export const PLACES = Object.freeze({
  lab: 'Windows lab',          // тоглолт (компьютерийн лаборатори)
  hall: 'Урлагийн заал',       // үзэгчид, LED дэлгэц
});
