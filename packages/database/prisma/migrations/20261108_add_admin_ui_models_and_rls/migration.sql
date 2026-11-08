-- 1. Create Enums for Admin UI & Workflow Outcomes
CREATE TYPE "MembershipRole" AS ENUM ('ADMIN', 'MANAGER', 'SUPPORT');

CREATE TYPE "RunOutcome" AS ENUM (
  'AUTO_SYNCED',
  'APPROVED_AS_IS',
  'APPROVED_WITH_OVERRIDE',
  'REJECTED',
  'EXPIRED',
  'UNDONE',
  'FAILED'
);

-- 2. Add Admin UI configuration fields to Tenant
ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "manualMinutesPerUpdate" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'Africa/Cairo';

-- 3. Add outcome & decision audit fields to WorkflowRun
ALTER TABLE "WorkflowRun"
  ADD COLUMN IF NOT EXISTS "outcome" "RunOutcome",
  ADD COLUMN IF NOT EXISTS "overriddenFields" JSONB,
  ADD COLUMN IF NOT EXISTS "decidedByRepId" TEXT,
  ADD COLUMN IF NOT EXISTS "decidedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "undoneAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 4. Create global User table (not tenant-scoped)
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "isOperator" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

-- 5. Create tenant-scoped Membership table
CREATE TABLE IF NOT EXISTS "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Membership_userId_tenantId_key" ON "Membership"("userId", "tenantId");
CREATE INDEX IF NOT EXISTS "Membership_tenantId_idx" ON "Membership"("tenantId");

-- 6. Create tenant-scoped append-only AuditLog table
CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- 7. Create WorkflowRun composite indexes for Admin UI queries
CREATE INDEX IF NOT EXISTS "WorkflowRun_tenantId_createdAt_idx" ON "WorkflowRun"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "WorkflowRun_tenantId_outcome_idx" ON "WorkflowRun"("tenantId", "outcome");

-- 8. Add Foreign Keys
ALTER TABLE "Membership"
  ADD CONSTRAINT "Membership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Membership"
  ADD CONSTRAINT "Membership_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkflowRun"
  ADD CONSTRAINT "WorkflowRun_decidedByRepId_fkey"
  FOREIGN KEY ("decidedByRepId") REFERENCES "TenantRep"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 9. Enable and FORCE Row-Level Security on Membership and AuditLog
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;

CREATE POLICY "vexel_membership_isolation" ON "Membership"
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.bypass_rls', true), '') = 'on'
    OR "tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')
  )
  WITH CHECK (
    NULLIF(current_setting('app.bypass_rls', true), '') = 'on'
    OR "tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')
  );

CREATE POLICY "vexel_audit_log_isolation" ON "AuditLog"
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.bypass_rls', true), '') = 'on'
    OR "tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')
  )
  WITH CHECK (
    NULLIF(current_setting('app.bypass_rls', true), '') = 'on'
    OR "tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')
  );

-- 10. Enforce append-only immutability on AuditLog
CREATE OR REPLACE FUNCTION vexel_prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '[AUDIT_LOG_IMMUTABLE] AuditLog is append-only; % operations are prohibited.', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_append_only ON "AuditLog";
CREATE TRIGGER trg_audit_log_append_only
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION vexel_prevent_audit_log_mutation();

