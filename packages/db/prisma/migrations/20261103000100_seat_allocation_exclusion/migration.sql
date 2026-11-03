-- PostgreSQL is the final authority for segment inventory. Ranges are half-open,
-- so adjacent journeys (0..3 and 3..5) may use the same seat.
ALTER TABLE "seat_allocations"
  ADD CONSTRAINT "seat_allocations_segment_check" CHECK ("from_idx" < "to_idx"),
  ADD CONSTRAINT "seat_allocations_status_check" CHECK ("status" IN ('HELD', 'CONFIRMED', 'RELEASED', 'EXPIRED')),
  ADD CONSTRAINT "seat_allocations_held_expiry_check" CHECK ("status" <> 'HELD' OR "hold_expires_at" IS NOT NULL);

DROP INDEX "seat_allocations_status_hold_expires_at_idx";
CREATE INDEX "seat_allocations_status_hold_expires_at_idx"
  ON "seat_allocations"("status", "hold_expires_at") WHERE "status" = 'HELD';
ALTER TABLE "seat_allocations"
  ADD CONSTRAINT "seat_allocations_no_active_overlap"
  EXCLUDE USING GIST (
    "run_id" WITH =,
    "seat_id" WITH =,
    int4range("from_idx", "to_idx") WITH &&
  ) WHERE ("status" IN ('HELD', 'CONFIRMED'));
