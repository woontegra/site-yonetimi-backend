-- FAZ 20: CANCELLED status + createdByUserId
ALTER TYPE "AnnouncementStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'announcements_createdByUserId_fkey'
  ) THEN
    ALTER TABLE "announcements"
      ADD CONSTRAINT "announcements_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "announcements_createdByUserId_idx" ON "announcements"("createdByUserId");
