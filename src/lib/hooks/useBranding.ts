"use client";

/**
 * useBranding
 *
 * One source of truth for a school's brand-facing details, used by
 * every printable document (payslips, report cards, clinic summaries,
 * overdue notices, receipts, ID cards). Combines the auth-context
 * organisation with school_settings so a caller does not have to
 * juggle two queries.
 *
 * Returns null while loading so a print page can render a "please
 * wait" state and never flash "your school" placeholders.
 */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";

export interface Branding {
  schoolName: string;
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  currencySymbol: string;
  receiptFooter: string | null;
  /** Primary brand navy — always present, comes from the design system. */
  primaryColor: string;
  /** Gold accent — always present. */
  accentColor: string;
}

const DEFAULTS = {
  primaryColor: "#0F2A47",
  accentColor: "#C9A227",
};

export function useBranding(): Branding | null {
  const supabase = useMemo(() => createClient(), []);
  const { org, orgId } = useAuth();
  const [settings, setSettings] = useState<{
    school_name: string; address: string | null; phone: string | null;
    email: string | null; logo_url: string | null; currency_symbol: string;
    receipt_footer: string | null;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const { data } = await supabase
        .from("school_settings")
        .select("school_name, address, phone, email, logo_url, currency_symbol, receipt_footer")
        .maybeSingle();
      setSettings(data as typeof settings ?? null);
      setLoaded(true);
    })();
  }, [supabase, orgId]);

  if (!loaded) return null;

  return {
    schoolName: settings?.school_name || org?.name || "School",
    logoUrl: settings?.logo_url || org?.logo_url || null,
    address: settings?.address || null,
    phone: settings?.phone || null,
    email: settings?.email || null,
    currencySymbol: settings?.currency_symbol || "₦",
    receiptFooter: settings?.receipt_footer || null,
    primaryColor: DEFAULTS.primaryColor,
    accentColor: DEFAULTS.accentColor,
  };
}
