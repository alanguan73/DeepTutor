"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listExpertPacks, type ExpertPack } from "@/lib/expert-packs-api";

type CompanionExpertPickerProps = {
  personaId: string;
  onPersonaChange: (packId: string) => void;
};

export default function CompanionExpertPicker({
  personaId,
  onPersonaChange,
}: CompanionExpertPickerProps) {
  const [packs, setPacks] = useState<ExpertPack[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listExpertPacks()
      .then((list) => {
        if (!cancelled) setPacks(list);
      })
      .catch(() => {
        if (!cancelled) setPacks([]);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <select
        value={personaId}
        onChange={(e) => onPersonaChange(e.target.value)}
        aria-label="选择专家"
        className="max-w-[14rem] rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[11px] text-[var(--foreground)] outline-none transition-colors hover:border-[var(--ring)] focus:border-[var(--ring)]"
      >
        <option value="" disabled>
          选择专家
        </option>
        {packs.map((pack) => (
          <option key={pack.pack_id} value={pack.pack_id}>
            {pack.display_name || pack.pack_id}
          </option>
        ))}
      </select>
      {loaded && packs.length === 0 ? (
        <p className="text-[11px] text-[var(--muted-foreground)]">
          暂无专家包，请到{" "}
          <Link
            href="/space/skills"
            className="underline hover:text-[var(--foreground)]"
          >
            /space/skills
          </Link>{" "}
          导入技能并注册
        </p>
      ) : null}
    </div>
  );
}
