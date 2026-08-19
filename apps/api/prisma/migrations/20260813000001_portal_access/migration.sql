-- Stage 8: portal access for referrers
-- Adds portalUsername (globally unique) and portalPasswordHash (bcrypt) to Party.
-- Both nullable — null means portal access has not been set up yet.

ALTER TABLE "Party" ADD COLUMN "portalUsername"     TEXT;
ALTER TABLE "Party" ADD COLUMN "portalPasswordHash" TEXT;

-- Globally unique referrer portal username (same uniqueness model as staff User.username).
CREATE UNIQUE INDEX "Party_portalUsername_key" ON "Party"("portalUsername");
