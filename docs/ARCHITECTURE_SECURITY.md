# Zero-Knowledge Architecture & Security Implementation Plan

## 1. Overview
This document outlines a concrete Zero-Knowledge (ZK) architecture implementation plan for Elyra Core. The primary objective is to ensure that workspace secrets and sensitive customer data are fully encrypted at rest so that even system administrators cannot read customer data.

Currently, the `worker/` directory relies on Cloudflare D1 for database storage, alongside integration with Supabase for user authentication (e.g., verifying tokens via `verifySupabaseToken` in `index.ts`). Workspace secrets and user data are stored in plaintext in D1. 

## 2. Current State Analysis
- **Database Connection Logic:** Cloudflare Workers use native D1 bindings (`env.DB.prepare(...)`).
- **Auth Flow:** The worker verifies JWTs against Supabase via `/auth/v1/user`. 
- **Secret Management:** `.dev.vars` contains `TOKEN_ENCRYPTION_KEY`, but there's no widespread usage in the current codebase for encrypting stored secrets at rest before inserting them into D1.

## 3. Zero-Knowledge Implementation Plan

### Step 1: Worker-Level Encryption (Cloudflare Workers)
All sensitive data (e.g., third-party OAuth tokens, API keys) must be encrypted before persisting to D1 and decrypted only in-memory when needed. 

**Actionable Code Steps:**
1. **Define Encryption Utilities:**
   Create `worker/src/encryption.ts` using the Web Crypto API, leveraging `env.TOKEN_ENCRYPTION_KEY` as an AES-GCM master key or a Key Encryption Key (KEK).
   ```typescript
   export async function encryptSecret(plainText: string, hexKey: string): Promise<string> {
     const keyData = hexToBytes(hexKey);
     const key = await crypto.subtle.importKey("raw", keyData, "AES-GCM", false, ["encrypt"]);
     const iv = crypto.getRandomValues(new Uint8Array(12));
     const encodedText = new TextEncoder().encode(plainText);
     const cipherText = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encodedText);
     return bufferToBase64(iv) + ":" + bufferToBase64(cipherText);
   }

   export async function decryptSecret(cipherTextWithIv: string, hexKey: string): Promise<string> {
     const [iv64, cipher64] = cipherTextWithIv.split(':');
     const iv = base64ToBuffer(iv64);
     const cipherText = base64ToBuffer(cipher64);
     const keyData = hexToBytes(hexKey);
     const key = await crypto.subtle.importKey("raw", keyData, "AES-GCM", false, ["decrypt"]);
     const plainTextBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherText);
     return new TextDecoder().decode(plainTextBuffer);
   }
   ```
2. **Implement in DB Access Layers:**
   Modify `worker/src/cloudOs.ts` and `apiServer.ts` wherever secrets are read or written:
   ```typescript
   // On Save
   const encryptedToken = await encryptSecret(rawToken, env.TOKEN_ENCRYPTION_KEY);
   await env.DB.prepare(`INSERT INTO workspace_secrets (key, value) VALUES (?, ?)`).bind('oauth', encryptedToken).run();
   
   // On Load
   const secretRow = await env.DB.prepare(`SELECT value FROM workspace_secrets WHERE key = ?`).bind('oauth').first();
   const rawToken = await decryptSecret(secretRow.value, env.TOKEN_ENCRYPTION_KEY);
   ```

### Step 2: Supabase RLS (Row Level Security) Implementation
If migrating to Supabase PostgreSQL or using it for supplementary storage, enforce Zero-Knowledge through Row Level Security (RLS) policies.

**Actionable Code Steps:**
1. **Enable RLS on Sensitive Tables:**
   ```sql
   ALTER TABLE workspace_secrets ENABLE ROW LEVEL SECURITY;
   ```
2. **Create Restrictive Policies:**
   Ensure only the authenticated user that belongs to a workspace can view their rows. Administrators are explicitly blocked.
   ```sql
   -- Allow users to read secrets for their own workspace
   CREATE POLICY "User can read own workspace secrets"
   ON workspace_secrets
   FOR SELECT
   USING (
     workspace_id IN (
       SELECT workspace_id FROM workspace_members 
       WHERE user_id = auth.uid()
     )
   );

   -- Block generic roles/admins from bypassing
   CREATE POLICY "Strict block for non-workspace members"
   ON workspace_secrets
   FOR ALL
   USING (
     auth.uid() IS NOT NULL AND current_setting('request.jwt.claims', true)::json->>'role' != 'service_role'
   );
   ```
3. **Pgcrypto for Transparent Database Encryption (Optional but Recommended):**
   Combine RLS with `pgcrypto` so that the database strictly stores encrypted blobs that can only be decrypted if the worker passes the correct per-workspace derivation key.

### Step 3: Deployment & Migration Strategy
- **Key Rotation:** Ensure `TOKEN_ENCRYPTION_KEY` rotation mechanisms are built into the worker (supporting multiple active keys using an ID prefix in the ciphertext, e.g., `v1:IV:CIPHER`).
- **Data Migration:** Create a one-off Cloudflare Worker cron job to read plaintext entries, encrypt them with `TOKEN_ENCRYPTION_KEY`, and update the D1 rows.
- **Audit Logs:** Add audit logging for all encryption/decryption events to ensure proper governance without logging the plaintext values.