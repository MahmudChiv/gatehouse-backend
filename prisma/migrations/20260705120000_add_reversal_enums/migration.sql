-- AlterEnum
-- Adds the values needed for inbound payment reversals (payment_reversal webhook).
-- `IF NOT EXISTS` makes this safe to re-run and safe if the value was already
-- applied via `prisma db push` (the migration history has drifted from the DB,
-- so these enums were not created by an earlier migration).
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REVERSED';

-- AlterEnum
ALTER TYPE "ExceptionType" ADD VALUE IF NOT EXISTS 'REVERSAL';
