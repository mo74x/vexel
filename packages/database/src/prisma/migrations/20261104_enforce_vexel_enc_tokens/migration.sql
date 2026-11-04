ALTER TABLE "Tenant"
ADD CONSTRAINT "tenant_hubspot_access_token_encrypted_chk"
CHECK (
  "hubspotAccessToken" IS NULL
  OR "hubspotAccessToken" LIKE 'vexel:enc:v%'
);

ALTER TABLE "Tenant"
ADD CONSTRAINT "tenant_hubspot_refresh_token_encrypted_chk"
CHECK (
  "hubspotRefreshToken" IS NULL
  OR "hubspotRefreshToken" LIKE 'vexel:enc:v%'
);