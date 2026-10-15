-- cs2_12_v5_name_deadlines — SPEC v5 (2026-10-15).
-- 1) New deadlines: online registration = roster freeze 2026-10-23 23:59:59 +08; paper consent 2026-10-23 17:00 +08.
-- 2) Event renamed «Сургуулийн аварга – CS2 2026» (object comments only; no behaviour change).
-- Touches only the cs2.settings row and comments on schemas cs2 / cs2_api and the public.cs2_* wrappers.

update cs2.settings
   set reg_closes_at       = '2026-10-23T23:59:59+08:00',
       consent_deadline_at = '2026-10-23T17:00:00+08:00',
       roster_freeze_at    = '2026-10-23T23:59:59+08:00',
       version             = version + 1,
       updated_at          = now()
 where id = 1;

comment on schema cs2 is 'Сургуулийн аварга – CS2 2026: private tables and helpers (no API access).';
comment on schema cs2_api is 'Сургуулийн аварга – CS2 2026: SECURITY DEFINER API, called via public.cs2_* wrappers.';
comment on function public.cs2_public_state(bigint) is 'Сургуулийн аварга – CS2 2026: public state (no player data).';
comment on function public.cs2_class_get(text) is 'Сургуулийн аварга – CS2 2026: class roster by secret link token.';
comment on function public.cs2_class_save(text, jsonb) is 'Сургуулийн аварга – CS2 2026: save class roster.';
comment on function public.cs2_class_confirm(text, text, jsonb) is 'Сургуулийн аварга – CS2 2026: homeroom teacher confirmation (PIN).';
comment on function public.cs2_ref_get(text) is 'Сургуулийн аварга – CS2 2026: referee view by secret link token.';
comment on function public.cs2_ref_report(text, integer, text, integer, integer, text, integer, integer)
  is 'Сургуулийн аварга – CS2 2026: referee live/report/final.';
comment on function public.cs2_admin_setup(text, text, text) is 'Сургуулийн аварга – CS2 2026: one-time organiser setup.';
comment on function public.cs2_admin_login(text, text) is 'Сургуулийн аварга – CS2 2026: organiser login (12 h session).';
comment on function public.cs2_admin_logout(text) is 'Сургуулийн аварга – CS2 2026: organiser logout.';
comment on function public.cs2_admin(text, text, jsonb) is 'Сургуулийн аварга – CS2 2026: organiser actions.';
