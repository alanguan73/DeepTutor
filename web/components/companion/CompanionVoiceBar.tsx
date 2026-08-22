"use client";

import { Mic, MicOff, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  recording: boolean;
  transcribing?: boolean;
  disabled: boolean;
  onHoldStart: () => void;
  onHoldEnd: () => void;
};

export default function CompanionVoiceBar({
  recording,
  transcribing = false,
  disabled,
  onHoldStart,
  onHoldEnd,
}: Props) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      disabled={disabled || transcribing}
      aria-pressed={recording}
      aria-busy={transcribing}
      aria-label={
        transcribing
          ? t("Companion transcribing")
          : recording
            ? t("Companion release to send")
            : t("Companion hold to talk")
      }
      onPointerDown={(e) => {
        if (disabled || transcribing) return;
        e.preventDefault();
        // Keep hold alive even if the pointer slides off the button.
        e.currentTarget.setPointerCapture(e.pointerId);
        onHoldStart();
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        onHoldEnd();
      }}
      onLostPointerCapture={() => {
        if (recording) onHoldEnd();
      }}
      className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 text-sm font-medium disabled:opacity-40"
    >
      {transcribing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : recording ? (
        <MicOff className="h-4 w-4" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
      {transcribing ? "识别中…" : recording ? "松开发送" : "按住说话"}
    </button>
  );
}
