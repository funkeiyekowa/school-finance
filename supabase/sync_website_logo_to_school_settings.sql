-- =====================================================================
-- SYNC: websites.logo_url → school_settings.logo_url + organizations.logo_url
-- =====================================================================
-- useBranding() reads school_settings.logo_url, falling back to
-- organizations.logo_url (via AuthContext). Both are still NULL for
-- schools that only set their logo in Website Studio, so this syncs
-- the Website Studio logo into BOTH so every code path (printables,
-- sidebar org switcher, login screen) shows the real logo instead of
-- the "GS"/single-letter monogram fallback.
--
-- SAFE TO RE-RUN (idempotent UPDATE, only fills NULL/empty values).
-- =====================================================================

UPDATE school_settings ss
SET logo_url = w.logo_url
FROM websites w
WHERE ss.organization_id = w.organization_id
  AND w.logo_url IS NOT NULL
  AND (ss.logo_url IS NULL OR ss.logo_url = '');

UPDATE organizations o
SET logo_url = w.logo_url
FROM websites w
WHERE o.id = w.organization_id
  AND w.logo_url IS NOT NULL
  AND (o.logo_url IS NULL OR o.logo_url = '');

-- Verify the sync
SELECT ss.organization_id, ss.school_name, ss.logo_url AS school_settings_logo, o.logo_url AS org_logo
FROM school_settings ss
JOIN organizations o ON o.id = ss.organization_id
ORDER BY ss.created_at DESC
LIMIT 10;
