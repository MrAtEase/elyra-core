-- migrations/0002_workspace_branding.sql
-- No-op migration.
-- Reason: previous versions attempted to use a guard table (_migrations_guard) and/or add columns that
-- may already exist. In D1/SQLite, ALTER TABLE ADD COLUMN is not idempotent without extra logic.
-- We keep this migration as a harmless placeholder so the migration sequence remains consistent.

SELECT 1;