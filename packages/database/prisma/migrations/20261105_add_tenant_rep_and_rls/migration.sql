-- 1. Add fallbackApprovalPhone to Tenant
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "fallbackApprovalPhone" TEXT;

-- 2. Create TenantRep table for HubSpot Owner -> WhatsApp E.164 routing
CREATE TABLE IF NOT EXISTS "TenantRep" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hubspotOwnerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "whatsappPhone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantRep_pkey" PRIMARY KEY ("id")
);

-- 3. Create Unique & Lookup Indexes on TenantRep
CREATE UNIQUE INDEX IF NOT EXISTS "TenantRep_tenantId_hubspotOwnerId_key" ON "TenantRep"("tenantId", "hubspotOwnerId");
CREATE UNIQUE INDEX IF NOT EXISTS "TenantRep_tenantId_email_key" ON "TenantRep"("tenantId", "email");
CREATE INDEX IF NOT EXISTS "TenantRep_tenantId_whatsappPhone_idx" ON "TenantRep"("tenantId", "whatsappPhone");

-- 4. Add Foreign Key to Tenant
ALTER TABLE "TenantRep"
  ADD CONSTRAINT "TenantRep_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Enable and FORCE Row-Level Security on TenantRep
ALTER TABLE "TenantRep" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantRep" FORCE ROW LEVEL SECURITY;

CREATE POLICY "vexel_tenant_rep_isolation" ON "TenantRep"
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.bypass_rls', true), '') = 'on'
    OR "tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')
  )
  WITH CHECK (
    NULLIF(current_setting('app.bypass_rls', true), '') = 'on'
    OR "tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')
  );
