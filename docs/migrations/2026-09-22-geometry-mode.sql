-- Geometry test format, chosen by the student on the proposal.
--
-- Geometry runs two test formats and the desktop queue refuses to build
-- until it knows which one ('Choose BJU or six demonstrated chapter proofs
-- for this Geometry test.'). Before this column that choice lived nowhere,
-- so every Geometry reservation stalled.
--
-- Nullable on purpose: only Geometry proposals carry a value, and existing
-- rows keep NULL rather than being guessed into a format nobody picked.

alter table proposals
  add column if not exists geometry_mode text;

alter table proposals
  drop constraint if exists proposals_geometry_mode_check;

alter table proposals
  add constraint proposals_geometry_mode_check
  check (geometry_mode is null or geometry_mode in ('bju', 'proofs'));
