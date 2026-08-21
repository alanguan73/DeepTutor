"use client";

import { Mic, MicOff } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  recording: boolean;
  disabled: boolean;
  onHoldStart: () => void;
  onHoldEnd: () => void;
};

export default function CompanionVoiceBar({
  recording,
  disabled,
  onHoldStart,
  onHoldEnd,
}: Props) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={recording}
      aria-label={
        recording
          ? t("Companion release to send")
          : t("Companion hold to talk")
      }
      onPointerDown={(e) => {
        e.preventDefault();
        onHoldStart();
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        onHoldEnd();
      }}
      onPointerLeave={() => {
        if (recording) onHoldEnd();
      }}
      className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 text-sm font-medium disabled:opacity-40"
    >
      {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      {recording ? "松开发送" : "按住说话"}
    </button>
  );
}
