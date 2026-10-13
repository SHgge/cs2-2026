-- cs2_10_lint_fixes — Supabase advisor findings on cs2 objects (nothing outside schema cs2 is touched).
-- 1) 0008 "RLS enabled, no policy": an explicit RESTRICTIVE deny-all policy on every cs2 table.
--    Behaviour is unchanged: anon/authenticated have no table grants and no USAGE on schema cs2;
--    the SECURITY DEFINER API runs as the table owner (postgres, no FORCE RLS) and is not affected.
-- 2) 0005 "unused index": audit_log_at_idx is dropped (the overview reads the audit log by id);
--    the foreign-key indexes become UNIQUE composites (trivially unique: the 2nd column is the primary key),
--    so the foreign keys stay indexed (0001) without plain never-used indexes.

create policy cs2_deny_all on cs2.settings        as restrictive for all to public using (false) with check (false);
create policy cs2_deny_all on cs2.teams           as restrictive for all to public using (false) with check (false);
create policy cs2_deny_all on cs2.team_access     as restrictive for all to public using (false) with check (false);
create policy cs2_deny_all on cs2.players         as restrictive for all to public using (false) with check (false);
create policy cs2_deny_all on cs2.matches         as restrictive for all to public using (false) with check (false);
create policy cs2_deny_all on cs2.draws           as restrictive for all to public using (false) with check (false);
create policy cs2_deny_all on cs2.group_decisions as restrictive for all to public using (false) with check (false);
create policy cs2_deny_all on cs2.referee_access  as restrictive for all to public using (false) with check (false);
create policy cs2_deny_all on cs2.admins          as restrictive for all to public using (false) with check (false);
create policy cs2_deny_all on cs2.admin_sessions  as restrictive for all to public using (false) with check (false);
create policy cs2_deny_all on cs2.announcements   as restrictive for all to public using (false) with check (false);
create policy cs2_deny_all on cs2.audit_log       as restrictive for all to public using (false) with check (false);
create policy cs2_deny_all on cs2.throttle        as restrictive for all to public using (false) with check (false);

drop index if exists cs2.audit_log_at_idx;

drop index if exists cs2.matches_team_a_idx;
drop index if exists cs2.matches_team_b_idx;
create unique index matches_team_a_no_uq on cs2.matches (team_a, no);
create unique index matches_team_b_no_uq on cs2.matches (team_b, no);

drop index if exists cs2.admin_sessions_admin_id_idx;
create unique index admin_sessions_admin_token_uq on cs2.admin_sessions (admin_id, token_sha256);
