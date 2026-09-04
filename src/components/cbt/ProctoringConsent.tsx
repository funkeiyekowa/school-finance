"use client";

/**
 * ProctoringConsent — shown BEFORE the exam starts, explaining what will be
 * recorded and requesting camera/screen permission. Only renders when the exam
 * is proctored with recording enabled.
 *
 * The student must accept (and grant permissions) or decline. What happens on
 * decline is controlled by the admin's `block_on_denial` setting: if true, the
 * exam cannot start; if false, the exam proceeds without recording.
 */

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Camera, Monitor, AlertTriangle, Shield } from "lucide-react";

interface Props {
  examTitle: string;
  cameraRequired: boolean;
  screenRequired: boolean;
  blockOnDenial: boolean;
  guardianConsentGiven: boolean;
  guardianConsentRequired: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export function ProctoringConsent({
  examTitle,
  cameraRequired,
  screenRequired,
  blockOnDenial,
  guardianConsentGiven,
  guardianConsentRequired,
  onAccept,
  onDecline,
}: Props) {
  const [declining, setDeclining] = useState(false);

  const needsGuardianConsent = guardianConsentRequired && !guardianConsentGiven;

  return (
    <div className="min-h-screen bg-[#F7F5F0] flex items-center justify-center p-6">
      <Card className="max-w-lg w-full">
        <CardContent className="py-8 space-y-5">
          <div className="text-center">
            <Shield size={40} className="mx-auto text-[#0F2A47] mb-3" />
            <h1 className="text-xl font-bold text-[#0F2A47]">Proctored Exam</h1>
            <p className="text-sm text-gray-600 mt-1">{examTitle}</p>
          </div>

          <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 text-sm text-blue-900 space-y-2">
            <p className="font-semibold">This exam is proctored. Before you begin:</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              {cameraRequired && (
                <li className="flex items-start gap-2">
                  <Camera size={14} className="shrink-0 mt-0.5" />
                  <span>Your <strong>camera and microphone</strong> will be recorded throughout the exam.</span>
                </li>
              )}
              {screenRequired && (
                <li className="flex items-start gap-2">
                  <Monitor size={14} className="shrink-0 mt-0.5" />
                  <span>Your <strong>screen</strong> will be recorded throughout the exam.</span>
                </li>
              )}
              <li>Recordings are stored securely and reviewed only by authorized school staff.</li>
              <li>Recordings are automatically deleted after the school&apos;s retention period.</li>
              <li>Switching tabs, leaving fullscreen, or stopping a recording will be recorded as a violation.</li>
            </ul>
          </div>

          {needsGuardianConsent && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Guardian consent required</p>
                  <p className="text-xs mt-1">
                    Your school requires a parent or guardian to consent to exam recording before you can proceed.
                    Please ask your parent or a school administrator to enable this on your student profile.
                  </p>
                </div>
              </div>
            </div>
          )}

          {declining && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-900">
              <p className="font-semibold">You declined recording.</p>
              {blockOnDenial ? (
                <p className="text-xs mt-1">
                  Your school requires recording for this exam. You cannot start the exam without accepting.
                  Please speak to your teacher if you have concerns.
                </p>
              ) : (
                <p className="text-xs mt-1">
                  The exam will proceed without recording. Your teacher may review this decision.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-3 justify-center pt-2">
            {!declining ? (
              <>
                <Button
                  variant="gold"
                  disabled={needsGuardianConsent}
                  onClick={onAccept}
                >
                  I understand — start exam
                </Button>
                <Button variant="secondary" onClick={() => {
                  setDeclining(true);
                  if (!blockOnDenial) {
                    // Allow proceeding without recording after a brief delay
                    setTimeout(onDecline, 1500);
                  }
                }}>
                  Decline recording
                </Button>
              </>
            ) : (
              <>
                {!blockOnDenial && (
                  <Button variant="secondary" onClick={onDecline}>
                    Continue without recording
                  </Button>
                )}
                <Button variant="gold" onClick={() => { setDeclining(false); onAccept(); }}>
                  Go back and accept
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
