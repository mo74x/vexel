-- Add per-tenant encrypted WhatsApp Access Token
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "whatsappAccessToken" TEXT;

ALTER TABLE "Tenant"
ADD CONSTRAINT "tenant_whatsapp_access_token_encrypted_chk"
CHECK (
  "whatsappAccessToken" IS NULL
  OR "whatsappAccessToken" LIKE 'vexel:enc:v%'
);

