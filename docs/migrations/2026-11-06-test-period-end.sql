-- Two back-to-back periods for one test (Mr. Ko, 2026-11-06).
--
-- test_period stays the first period; test_period_end is the second, or
-- NULL for a one-period test. Nullable on purpose: every existing row is a
-- one-period (or untimed) test and keeps NULL.

alter table proposals
  add column if not exists test_period_end smallint;

alter table proposals
  drop constraint if exists proposals_test_period_end_check;

alter table proposals
  add constraint proposals_test_period_end_check
  check (test_period_end is null
         or (test_period is not null and test_period_end = test_period + 1));
