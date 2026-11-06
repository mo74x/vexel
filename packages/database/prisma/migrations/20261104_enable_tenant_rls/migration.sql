-- 1. Add denormalized tenantId to WorkflowStep for zero-join RLS index scans
ALTER TABLE "WorkflowStep" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
CREATE INDEX IF NOT EXISTS "WorkflowStep_tenantId_runId_idx" ON "WorkflowStep"("tenantId", "runId");

-- 2. Enable and FORCE Row-Level Security on all tenant-scoped tables
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;

ALTER TABLE "WorkflowRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkflowRun" FORCE ROW LEVEL SECURITY;

ALTER TABLE "WorkflowStep" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkflowStep" FORCE ROW LEVEL SECURITY;

ALTER TABLE "UsageLedger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageLedger" FORCE ROW LEVEL SECURITY;

-- 3. Create Tenant Isolation Policies (Applies to SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY "vexel_tenant_self_isolation" ON "Tenant"
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.bypass_rls', true), '') = 'on'
    OR "id" = NULLIF(current_setting('app.current_tenant_id', true), '')
  )
  WITH CHECK (
    NULLIF(current_setting('app.bypass_rls', true), '') = 'on'
    OR "id" = NULLIF(current_setting('app.current_tenant_id', true), '')
  );

CREATE POLICY "vexel_workflow_run_isolation" ON "WorkflowRun"
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.bypass_rls', true), '') = 'on'
    OR "tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')
  )
  WITH CHECK (
    NULLIF(current_setting('app.bypass_rls', true), '') = 'on'
    OR "tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')
  );

CREATE POLICY "vexel_workflow_step_isolation" ON "WorkflowStep"
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.bypass_rls', true), '') = 'on'
    OR "tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')
  )
  WITH CHECK (
    NULLIF(current_setting('app.bypass_rls', true), '') = 'on'
    OR "tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')
  );

CREATE POLICY "vexel_usage_ledger_isolation" ON "UsageLedger"
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.bypass_rls', true), '') = 'on'
    OR "tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')
  )
  WITH CHECK (
    NULLIF(current_setting('app.bypass_rls', true), '') = 'on'
    OR "tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')
  );