-- cs2_09_admin_purge — admin actions 'purge' and 'sessions_revoke' (CONTRACT §4, SPEC §15), cs2 schema only.
-- This migration ONLY DEFINES two functions; it deletes nothing when applied.
-- They run only when a logged-in organiser calls cs2_admin(session, 'purge', {phase, confirm:'УСТГАХ'})
-- (data-retention duty: stream data by 2026.11.01, personal data by 2026.12.31) or 'sessions_revoke'.
-- p_current = sha256 of the caller's session token (passed by cs2_api.admin).

-- purge {phase:'stream'|'personal', confirm:'УСТГАХ'}
--   stream   (11.01): aliases, consent rows 3а/3б/3в, stream link.
--   personal (12.31): everything of 'stream' + all players, class tokens/PINs/attestations/confirmations,
--                     referee links, throttle rows, other admin sessions; person labels in audit_log,
--                     matches.reported_by and announcements.created_by are reduced to the role ('ref', 'admin').
--   Kept: teams, schedule, scores, draw, group decisions, announcements text, the organiser login.
create or replace function cs2.adm_purge(p_actor text, p_args jsonb, p_current text) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_phase    text := p_args ->> 'phase';
  v_players  integer := 0;
  v_ticks    integer := 0;
  v_refs     integer := 0;
  v_sessions integer := 0;
begin
  if btrim(coalesce(p_args ->> 'confirm', '')) <> 'УСТГАХ' then
    return cs2.validation(jsonb_build_array(cs2.verr('confirm', 'required')));
  end if;
  if v_phase is null or v_phase not in ('stream', 'personal') then
    return cs2.validation(jsonb_build_array(cs2.verr('phase', 'invalid')));
  end if;

  update cs2.players
     set alias = null, consent_3a = null, consent_3b = null, consent_3v = null, updated_at = now()
   where alias is not null or consent_3a is not null or consent_3b is not null or consent_3v is not null;
  get diagnostics v_ticks = row_count;
  update cs2.settings set stream_url = null, updated_at = now() where id = 1;

  if v_phase = 'personal' then
    delete from cs2.players where team_id is not null;
    get diagnostics v_players = row_count;
    update cs2.team_access
       set token_sha256 = null, token_issued_at = null, pin_bcrypt = null, pin_issued_at = null,
           pin_fails = 0, pin_fail_times = '{}', pin_fails_total = 0, pin_locked_until = null, pin_hard_locked = false,
           confirmed_at = null, confirmed_by = null, confirm_attest = null, confirm_reason = null,
           unlocked_until = null, version = version + 1, updated_at = now()
     where team_id is not null;
    delete from cs2.referee_access where id is not null;
    get diagnostics v_refs = row_count;
    delete from cs2.throttle where key is not null;
    delete from cs2.admin_sessions where token_sha256 is distinct from p_current;
    get diagnostics v_sessions = row_count;
    update cs2.audit_log set actor = split_part(actor, ':', 1)
     where actor like 'ref:%' or actor like 'admin:%';
    update cs2.matches set reported_by = split_part(reported_by, ':', 1)
     where reported_by like 'ref:%' or reported_by like 'admin:%';
    update cs2.announcements set created_by = split_part(created_by, ':', 1)
     where created_by like 'admin:%';
  end if;

  perform cs2.bump_version();
  perform cs2.audit(case when v_phase = 'personal' then split_part(p_actor, ':', 1) else p_actor end, 'purge', null, null,
                    jsonb_build_object('phase', v_phase, 'players', v_players, 'ticks', v_ticks,
                                       'referees', v_refs, 'sessions', v_sessions));
  return jsonb_build_object('ok', true, 'phase', v_phase, 'players', v_players, 'ticks', v_ticks,
                            'referees', v_refs, 'sessions', v_sessions);
end $$;

-- sessions_revoke {keep_current?} — ends ALL organiser sessions incl. the caller's (UI: «Бүх сессийг хаах»);
-- keep_current:true ends only the other sessions.
create or replace function cs2.adm_sessions_revoke(p_actor text, p_args jsonb, p_current text) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_keep boolean := coalesce(cs2.jbool(p_args -> 'keep_current'), false);
  v_n    integer;
begin
  if v_keep then
    delete from cs2.admin_sessions where token_sha256 is distinct from p_current;
  else
    delete from cs2.admin_sessions where token_sha256 is not null;
  end if;
  get diagnostics v_n = row_count;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'sessions_revoke', null, null, jsonb_build_object('revoked', v_n, 'keep_current', v_keep));
  return jsonb_build_object('ok', true, 'revoked', v_n, 'keep_current', v_keep);
end $$;

revoke all on all functions in schema cs2 from public, anon, authenticated;
