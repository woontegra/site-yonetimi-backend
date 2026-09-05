-- User-scoped admin notes (subjectUserId).
-- Prisma/Postgres kolonları bu projede camelCase (createdAt, tenantId, ...).

-- Önceki başarısız denemeden kalan snake_case kalıntıyı temizle
DROP INDEX IF EXISTS "admin_notes_subject_user_id_created_at_idx";
ALTER TABLE "admin_notes" DROP CONSTRAINT IF EXISTS "admin_notes_subject_user_id_fkey";
ALTER TABLE "admin_notes" DROP COLUMN IF EXISTS "subject_user_id";

ALTER TABLE "admin_notes" ADD COLUMN IF NOT EXISTS "subjectUserId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_notes_subjectUserId_fkey'
  ) THEN
    ALTER TABLE "admin_notes"
      ADD CONSTRAINT "admin_notes_subjectUserId_fkey"
      FOREIGN KEY ("subjectUserId") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "admin_notes_subjectUserId_createdAt_idx"
  ON "admin_notes" ("subjectUserId", "createdAt");
