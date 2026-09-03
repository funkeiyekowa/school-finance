"use client";

/**
 * SignatureBlock
 *
 * Drop-in replacement for the plain "_______________ / Role" text that
 * every printable letter (payslip, report card, admission letter, ...)
 * used to render unconditionally. Looks up whether the school has
 * configured a default e-signature for this letter type (see
 * supabase/signatures_and_class_teacher_module.sql,
 * get_letter_signature() RPC) and, if so, renders the signature image
 * plus the signatory's printed name/title above the same underline;
 * if not configured, renders exactly the old blank-line placeholder so
 * nothing changes for a school that hasn't set this up.
 *
 * `letterType` must match one of the slugs in
 * signatures-settings-page.tsx's LETTER_TYPES (e.g. "payslip",
 * "report_card", "admission_letter", "enrollment_certificate",
 * "welcome_pack", "expense_voucher").
 * `fallbackLabel` is the role label to print under the blank line when
 * no signature is configured (e.g. "Authorised Signature", "Class
 * Teacher", "Principal") -- matches what each print page already used.
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface SignatureData {
  signature_id: string;
  label: string;
  signatory_name: string | null;
  signatory_title: string | null;
  image_url: string;
}

export function useLetterSignature(letterType: string): SignatureData | null | undefined {
  // undefined = still loading, null = none configured, object = configured
  const [signature, setSignature] = useState<SignatureData | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.rpc("get_letter_signature", { p_letter_type: letterType }).then(({ data }) => {
      if (cancelled) return;
      const row = Array.isArray(data) ? data[0] : data;
      setSignature((row as SignatureData | undefined) ?? null);
    });
    return () => { cancelled = true; };
  }, [letterType]);

  return signature;
}

export function SignatureBlock({
  letterType,
  fallbackLabel,
  align = "right",
}: {
  letterType: string;
  fallbackLabel: string;
  align?: "left" | "right";
}) {
  const signature = useLetterSignature(letterType);
  const alignClass = align === "right" ? "text-right ml-auto" : "";

  if (signature) {
    return (
      <div className={alignClass} style={{ width: "200px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={signature.image_url} alt={signature.signatory_name ?? signature.label} className="h-10 object-contain" style={{ marginLeft: align === "right" ? "auto" : undefined }} />
        <p className="border-t border-gray-400 mt-0.5 pt-0.5 text-[10px] font-semibold text-gray-700">
          {signature.signatory_name || signature.signatory_title || signature.label}
        </p>
        {signature.signatory_title && signature.signatory_name && (
          <p className="text-[9px] text-gray-500">{signature.signatory_title}</p>
        )}
      </div>
    );
  }

  // Not configured (or still loading) -- keep the original placeholder
  // so a school that hasn't set this up sees no visual change.
  return (
    <div className={alignClass}>
      <p>_______________________________</p>
      <p>{fallbackLabel}</p>
    </div>
  );
}
