-- cs2_03_seed — settings (CONTRACT §0), 12 teams + hidden test team, 20 matches (CONTRACT §2), group decisions.

insert into cs2.settings (id, version, reg_closes_at, consent_deadline_at, roster_freeze_at, tokens_valid_until,
                          registration_open, stream_url, setup_code_hash, setup_used_at)
values (1, 1,
        '2026-10-16T17:00:00+08:00', '2026-10-21T17:00:00+08:00',
        '2026-10-22T16:00:00+08:00', '2026-10-25T18:00:00+08:00',
        true, null,
        'a4c11992d2e41a1ccbaf90b01a4cd0f018884afbe40b82bb9ef65796eca4f8ed', null);

-- id order = DRAW_ORDER; pot order = SPEC §3 listing order
insert into cs2.teams (id, code, name, pot, is_teachers, is_hidden) values
  ( 1, '12a',      '12а',            1, false, false),
  ( 2, '11a',      '11а',            1, false, false),
  ( 3, '11b',      '11б',            1, false, false),
  ( 4, 'teachers', 'Багш нарын баг', 1, true,  false),
  ( 5, '10a',      '10а',            2, false, false),
  ( 6, '10b',      '10б',            2, false, false),
  ( 7, '10v',      '10в',            2, false, false),
  ( 8, '9a',       '9а',             2, false, false),
  ( 9, '9b',       '9б',             3, false, false),
  (10, '8a',       '8а',             3, false, false),
  (11, '8b',       '8б',             3, false, false),
  (12, '8v',       '8в',             3, false, false),
  (99, 'test',     'ТЕСТ',           null, false, true);   -- hidden test team (never public)

insert into cs2.team_access (team_id) select id from cs2.teams order by id;

insert into cs2.group_decisions (grp) values ('A'), ('B'), ('V'), ('G');

insert into cs2.matches (no, day, stage, code, grp, station, start_at, end_at, src_a, src_b) values
  -- Day 1 group stage (MR12, no OT, 12:12 draw allowed)
  ( 1, 1, 'group', null, 'A', 'A', '2026-10-24T09:45:00+08:00', '2026-10-24T10:45:00+08:00', 'seat:A1', 'seat:A2'),
  ( 2, 1, 'group', null, 'B', 'B', '2026-10-24T09:45:00+08:00', '2026-10-24T10:45:00+08:00', 'seat:B1', 'seat:B2'),
  ( 3, 1, 'group', null, 'V', 'A', '2026-10-24T10:45:00+08:00', '2026-10-24T11:45:00+08:00', 'seat:V1', 'seat:V2'),
  ( 4, 1, 'group', null, 'G', 'B', '2026-10-24T10:45:00+08:00', '2026-10-24T11:45:00+08:00', 'seat:G1', 'seat:G2'),
  ( 5, 1, 'group', null, 'A', 'A', '2026-10-24T11:45:00+08:00', '2026-10-24T12:45:00+08:00', 'seat:A1', 'seat:A3'),
  ( 6, 1, 'group', null, 'B', 'B', '2026-10-24T11:45:00+08:00', '2026-10-24T12:45:00+08:00', 'seat:B1', 'seat:B3'),
  ( 7, 1, 'group', null, 'V', 'A', '2026-10-24T13:45:00+08:00', '2026-10-24T14:45:00+08:00', 'seat:V1', 'seat:V3'),
  ( 8, 1, 'group', null, 'G', 'B', '2026-10-24T13:45:00+08:00', '2026-10-24T14:45:00+08:00', 'seat:G1', 'seat:G3'),
  ( 9, 1, 'group', null, 'A', 'A', '2026-10-24T14:45:00+08:00', '2026-10-24T15:45:00+08:00', 'seat:A2', 'seat:A3'),
  (10, 1, 'group', null, 'B', 'B', '2026-10-24T14:45:00+08:00', '2026-10-24T15:45:00+08:00', 'seat:B2', 'seat:B3'),
  (11, 1, 'group', null, 'V', 'A', '2026-10-24T15:45:00+08:00', '2026-10-24T16:45:00+08:00', 'seat:V2', 'seat:V3'),
  (12, 1, 'group', null, 'G', 'B', '2026-10-24T15:45:00+08:00', '2026-10-24T16:45:00+08:00', 'seat:G2', 'seat:G3'),
  -- Day 2 knockout (MR12 + OT)
  (13, 2, 'qf',    '1/4-1',    null, 'A', '2026-10-25T09:30:00+08:00', '2026-10-25T10:45:00+08:00', 'rank:A1', 'rank:B2'),
  (14, 2, 'qf',    '1/4-3',    null, 'B', '2026-10-25T09:30:00+08:00', '2026-10-25T10:45:00+08:00', 'rank:B1', 'rank:A2'),
  (15, 2, 'qf',    '1/4-2',    null, 'A', '2026-10-25T10:45:00+08:00', '2026-10-25T12:00:00+08:00', 'rank:V1', 'rank:G2'),
  (16, 2, 'qf',    '1/4-4',    null, 'B', '2026-10-25T10:45:00+08:00', '2026-10-25T12:00:00+08:00', 'rank:G1', 'rank:V2'),
  (17, 2, 'sf',    '1/2-1',    null, 'A', '2026-10-25T13:00:00+08:00', '2026-10-25T14:15:00+08:00', 'W:13',    'W:15'),
  (18, 2, 'sf',    '1/2-2',    null, 'B', '2026-10-25T13:00:00+08:00', '2026-10-25T14:15:00+08:00', 'W:14',    'W:16'),
  (19, 2, 'final', 'Финал',    null, 'A', '2026-10-25T14:45:00+08:00', '2026-10-25T16:00:00+08:00', 'W:17',    'W:18'),
  (20, 2, 'third', '3-р байр', null, 'B', '2026-10-25T14:45:00+08:00', '2026-10-25T16:00:00+08:00', 'L:17',    'L:18');
