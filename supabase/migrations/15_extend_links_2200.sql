-- «Сургуулийн аварга – CS2 2026» — финал (Bo3) хоцорсон тул анги, шүүгчийн линкийг 2026-10-25 22:00 хүртэл сунгана.
-- 14_bo3.sql 20:00 болгосон; хэрэглэгчийн шийдвэр 2026-10-25 17:40. Бусад өгөгдөл хөндөхгүй.
update cs2.settings set tokens_valid_until = '2026-10-25 22:00:00+08' where id = 1 and tokens_valid_until < '2026-10-25 22:00:00+08';
update cs2.referee_access set valid_until = '2026-10-25 22:00:00+08' where valid_until = '2026-10-25 20:00:00+08';
alter table cs2.referee_access alter column valid_until set default '2026-10-25 22:00:00+08';
