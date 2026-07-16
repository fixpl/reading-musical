-- Availability is also used as a private personal calendar entry.
-- Its time range participates in production schedule conflict checks.
ALTER TABLE "availabilities" ADD COLUMN "title" TEXT;
