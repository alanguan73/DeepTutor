"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { Loader2, Send, Square } from "lucide-react";
import { shouldSubmitOnEnter } from "@/lib/composer-keyboard";
import { useImeComposing } from "@/lib/use-ime-composing";

type CompanionComposerProps = {
  draft: string;
  busy: boolean;
  sendDisabled: boolean;
  inputDisabled: boolean;
  interruptEnabled: boolean;
  voiceSlot?: ReactNode;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onInterrupt: () => void;
};

export default function CompanionComposer({
  draft,
  busy,
  sendDisabled,
  inputDisabled,
  interruptEnabled,
  voiceSlot,
  onDraftChange,
  onSend,
  onInterrupt,
}: CompanionComposerProps) {
  const { isComposingRef, onCompositionStart, onCompositionEnd } =
    useImeComposing();

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!shouldSubmitOnEnter(event, isComposingRef.current)) return;
    event.preventDefault();
    if (!sendDisabled) onSend();
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--card)]/40 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        <textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          disabled={inputDisabled}
          rows={2}
          placeholder="继续说，随时可以打断…"
          className="min-h-[2.75rem] flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="Companion message"
        />
        <div className="flex items-center justify-end gap-2">
          {busy && (
            <p className="mr-auto text-[11px] text-[var(--muted-foreground)]">
              Waiting…
            </p>
          )}
          {voiceSlot}
          <button
            type="button"
            onClick={onInterrupt}
            disabled={!interruptEnabled}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--ring)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Square className="h-3.5 w-3.5" />
            Interrupt
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={sendDisabled || !draft.trim()}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3.5 text-sm font-medium text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
