-- Forward Migration for PV-F3: Persistent Mission Payee Root & Signed Payees Set
ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "payeesJson" TEXT;
ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "payeeRoot" TEXT;
