-- =====================================================================
-- TRIGGER: Auto-sync website logo → school_settings + organizations
-- =====================================================================
-- Whenever a school updates their website logo in Website Studio,
-- automatically cascade it to BOTH school_settings.logo_url (read by
-- useBranding() for every printable: payslips, report cards, receipts,
-- letterheads) AND organizations.logo_url (read by AuthContext for the
-- sidebar org switcher + login screen fallback).
--
-- ONE SOURCE OF TRUTH: the website logo, synced everywhere it's shown.
-- =====================================================================

CREATE OR REPLACE FUNCTION sync_website_logo_to_school_settings()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.logo_url IS DISTINCT FROM OLD.logo_url THEN
    UPDATE school_settings
    SET logo_url = NEW.logo_url,
        updated_at = now()
    WHERE organization_id = NEW.organization_id;

    UPDATE organizations
    SET logo_url = NEW.logo_url
    WHERE id = NEW.organization_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS websites_logo_sync_trigger ON websites;

CREATE TRIGGER websites_logo_sync_trigger
AFTER UPDATE ON websites
FOR EACH ROW
EXECUTE FUNCTION sync_website_logo_to_school_settings();

-- Also sync on INSERT (in case school_settings/organizations exist but logo_url is null)
CREATE OR REPLACE FUNCTION sync_website_logo_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.logo_url IS NOT NULL THEN
    UPDATE school_settings
    SET logo_url = NEW.logo_url
    WHERE organization_id = NEW.organization_id
      AND (logo_url IS NULL OR logo_url = '');

    UPDATE organizations
    SET logo_url = NEW.logo_url
    WHERE id = NEW.organization_id
      AND (logo_url IS NULL OR logo_url = '');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS websites_logo_insert_trigger ON websites;

CREATE TRIGGER websites_logo_insert_trigger
AFTER INSERT ON websites
FOR EACH ROW
EXECUTE FUNCTION sync_website_logo_on_insert();

-- Verify the trigger is installed and report current sync coverage
SELECT
  'Triggers installed' AS status,
  (SELECT COUNT(*) FROM school_settings WHERE logo_url IS NOT NULL) AS schools_with_logo_in_settings,
  (SELECT COUNT(*) FROM organizations WHERE logo_url IS NOT NULL) AS orgs_with_logo,
  (SELECT COUNT(*) FROM websites WHERE logo_url IS NOT NULL) AS websites_with_logo;
