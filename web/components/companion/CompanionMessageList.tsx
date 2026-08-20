"use client";

export type CompanionMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  stage?: string;
};

type CompanionMessageListProps = {
  messages: CompanionMessage[];
};

function stageLabel(stage?: string): string | null {
  if (!stage) return null;
  if (stage === "safety_scan") return "Safety";
  if (stage === "responding" || stage === "support") return null;
  if (stage === "companion_progress") return null;
  return stage;
}

export default function CompanionMessageList({
  messages,
}: CompanionMessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--background)]/50 p-4 text-xs leading-6 text-[var(--muted-foreground)]">
        <p className="mb-2 font-medium text-[var(--foreground)]">陪聊 Companion</p>
        <p>
          Long-term companion chat (了解 → 分析 → 解决). You can interrupt a
          reply anytime. Optional progress UI stays off by default.
        </p>
        <p className="mt-2 text-[11px] opacity-80">
          Crisis language triggers a referral only — no counseling advice. For
          short structured sessions use Counsel instead.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {messages.map((msg) => {
        const isUser = msg.role === "user";
        const isSystem = msg.role === "system";
        const label = stageLabel(msg.stage);
        return (
          <div
            key={msg.id}
            className={`flex ${isUser ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 whitespace-pre-wrap ${
                isSystem
                  ? "border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100"
                  : isUser
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : msg.stage === "safety_scan"
                      ? "border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100"
                      : "border border-[var(--border)] bg-[var(--card)]"
              }`}
            >
              {label && !isUser && !isSystem ? (
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                  {label}
                </div>
              ) : null}
              {msg.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}
