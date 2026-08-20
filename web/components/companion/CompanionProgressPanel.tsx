"use client";

export type CompanionProgress = {
  phase: string;
  label: string;
  known: string[];
  next_hint: string;
};

type CompanionProgressPanelProps = {
  progress: CompanionProgress | null;
};

export default function CompanionProgressPanel({
  progress,
}: CompanionProgressPanelProps) {
  if (!progress) {
    return (
      <aside className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--background)]/40 px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
        Progress will appear after the next reply.
      </aside>
    );
  }

  return (
    <aside className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-xs">
      <div className="font-medium text-[var(--foreground)]">
        {progress.label || progress.phase}
      </div>
      {progress.known.length > 0 ? (
        <ul className="mt-1.5 list-inside list-disc text-[11px] text-[var(--muted-foreground)]">
          {progress.known.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {progress.next_hint ? (
        <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
          Next: {progress.next_hint}
        </p>
      ) : null}
    </aside>
  );
}
