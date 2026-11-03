-- Run with psql after applying migrations:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/prisma/verify-segment-constraint.sql
-- Everything is rolled back. A successful run proves adjacency is allowed and
-- an overlapping active segment is rejected by PostgreSQL (SQLSTATE 23P01).
BEGIN;

INSERT INTO users (id, email, password_hash, name, updated_at)
VALUES ('constraint-check-user', 'constraint-check@railgrid.invalid', 'unused', 'Constraint Check', now());
INSERT INTO stations (code, name, city) VALUES ('ZZT', 'Constraint Test', 'Test City');
INSERT INTO trains (number, name, type, updated_at) VALUES ('ZZT', 'Constraint Test Train', 'TEST', now());
INSERT INTO train_stops (train_number, stop_idx, station_code, distance_km)
VALUES ('ZZT', 0, 'ZZT', 0), ('ZZT', 1, 'ZZT', 100), ('ZZT', 2, 'ZZT', 200), ('ZZT', 3, 'ZZT', 300), ('ZZT', 4, 'ZZT', 400), ('ZZT', 5, 'ZZT', 500);
INSERT INTO runs (train_number, journey_date, updated_at) VALUES ('ZZT', CURRENT_DATE, now());
INSERT INTO seats (train_number, class_code, coach, seat_no, berth_type)
VALUES ('ZZT', 'SL', 'S1', 1, 'LB');

INSERT INTO bookings (id, pnr, user_id, run_id, from_idx, to_idx, class_code, status, total_paise, updated_at)
SELECT '00000000-0000-0000-0000-000000000001', '0000000001', 'constraint-check-user', id, 0, 3, 'SL', 'SEATS_HELD', 10000, now() FROM runs WHERE train_number = 'ZZT';
INSERT INTO bookings (id, pnr, user_id, run_id, from_idx, to_idx, class_code, status, total_paise, updated_at)
SELECT '00000000-0000-0000-0000-000000000002', '0000000002', 'constraint-check-user', id, 3, 5, 'SL', 'SEATS_HELD', 10000, now() FROM runs WHERE train_number = 'ZZT';
INSERT INTO bookings (id, pnr, user_id, run_id, from_idx, to_idx, class_code, status, total_paise, updated_at)
SELECT '00000000-0000-0000-0000-000000000003', '0000000003', 'constraint-check-user', id, 2, 4, 'SL', 'SEATS_HELD', 10000, now() FROM runs WHERE train_number = 'ZZT';

INSERT INTO seat_allocations (run_id, seat_id, booking_id, from_idx, to_idx, status, updated_at)
SELECT r.id, s.id, '00000000-0000-0000-0000-000000000001', 0, 3, 'CONFIRMED', now()
FROM runs r CROSS JOIN seats s WHERE r.train_number = 'ZZT' AND s.train_number = 'ZZT';
INSERT INTO seat_allocations (run_id, seat_id, booking_id, from_idx, to_idx, status, updated_at)
SELECT r.id, s.id, '00000000-0000-0000-0000-000000000002', 3, 5, 'CONFIRMED', now()
FROM runs r CROSS JOIN seats s WHERE r.train_number = 'ZZT' AND s.train_number = 'ZZT';

DO $$
DECLARE
  v_run_id BIGINT;
  v_seat_id BIGINT;
  overlap_rejected BOOLEAN := FALSE;
BEGIN
  SELECT id INTO v_run_id FROM runs WHERE train_number = 'ZZT';
  SELECT id INTO v_seat_id FROM seats WHERE train_number = 'ZZT';
  BEGIN
    INSERT INTO seat_allocations (run_id, seat_id, booking_id, from_idx, to_idx, status, updated_at)
    VALUES (v_run_id, v_seat_id, '00000000-0000-0000-0000-000000000003', 2, 4, 'CONFIRMED', now());
  EXCEPTION WHEN exclusion_violation THEN
    overlap_rejected := TRUE;
  END;
  IF NOT overlap_rejected THEN
    RAISE EXCEPTION 'Expected overlapping active segment to fail with exclusion_violation';
  END IF;
  RAISE NOTICE 'PASS: adjacent segments share a seat; overlapping segment rejected with SQLSTATE 23P01';
END $$;

ROLLBACK;
