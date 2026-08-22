"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listExpertPacks, type ExpertPack } from "@/lib/expert-packs-api";
import { listSkills, type SkillInfo } from "@/lib/skills-api";

type CompanionExpertPickerProps = {
  personaId: string;
  onPersonaChange: (personaRef: string) => void;
};

function isPsychSkill(skill: SkillInfo): boolean {
  return skill.tags.some((tag) => tag === "psych" || tag === "distilled");
}

export default function CompanionExpertPicker({
  personaId,
  onPersonaChange,
}: CompanionExpertPickerProps) {
  const [packs, setPacks] = useState<ExpertPack[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listExpertPacks().catch(() => [] as ExpertPack[]),
      listSkills({ force: true }).catch(() => [] as SkillInfo[]),
    ]).then(([packList, skillList]) => {
      if (cancelled) return;
      setPacks(packList);
      setSkills(
        skillList
          .filter(isPsychSkill)
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const empty = loaded && packs.length === 0 && skills.length === 0;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <select
        value={personaId}
        onChange={(e) => onPersonaChange(e.target.value)}
        aria-label="选择专家"
        className="max-w-[16rem] rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[11px] text-[var(--foreground)] outline-none transition-colors hover:border-[var(--ring)] focus:border-[var(--ring)]"
      >
        <option value="" disabled>
          选择专家
        </option>
        {packs.length > 0 ? (
          <optgroup label="专家包">
            {packs.map((pack) => (
              <option key={`pack:${pack.pack_id}`} value={`pack:${pack.pack_id}`}>
                {pack.display_name || pack.pack_id}
              </option>
            ))}
          </optgroup>
        ) : null}
        {skills.length > 0 ? (
          <optgroup label="单条技能">
            {skills.map((skill) => (
              <option key={`skill:${skill.name}`} value={`skill:${skill.name}`}>
                {skill.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      {empty ? (
        <p className="text-[11px] text-[var(--muted-foreground)]">
          暂无专家，请到{" "}
          <Link
            href="/space/skills"
            className="underline hover:text-[var(--foreground)]"
          >
            /space/skills
          </Link>{" "}
          导入或到{" "}
          <Link
            href="/distill"
            className="underline hover:text-[var(--foreground)]"
          >
            /distill
          </Link>{" "}
          蒸馏
        </p>
      ) : null}
    </div>
  );
}
