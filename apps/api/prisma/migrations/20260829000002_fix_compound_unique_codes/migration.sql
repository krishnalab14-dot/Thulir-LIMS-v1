-- Fix: the first compound migration (20260829000001) already added the compound
-- per-org unique constraints, but used DROP CONSTRAINT IF EXISTS to remove the
-- old global indexes. In PostgreSQL, CREATE UNIQUE INDEX (from entity_codes)
-- is NOT a named constraint — DROP CONSTRAINT silently succeeds (IF EXISTS)
-- without removing the index. We must DROP INDEX to remove them.

-- Drop the old global unique indexes that were never actually removed
DROP INDEX IF EXISTS "User_staffCode_key";
DROP INDEX IF EXISTS "Party_doctorCode_key";
