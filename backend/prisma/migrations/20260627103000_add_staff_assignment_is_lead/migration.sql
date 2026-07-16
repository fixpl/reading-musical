ALTER TABLE "StaffAssignment" ADD COLUMN "isLead" BOOLEAN NOT NULL DEFAULT false;

UPDATE "StaffAssignment"
SET "isLead" = true
WHERE "note" = 'lead';
