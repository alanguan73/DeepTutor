import { apiFetch, apiUrl } from "@/lib/api";

export interface ExpertPack {
  pack_id: string;
  display_name: string;
  skill_names: string[];
  source?: Record<string, unknown>;
  tags?: string[];
  created_at?: string;
}

async function asJson(response: Response) {
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return response.json();
}

export async function listExpertPacks(): Promise<ExpertPack[]> {
  const response = await apiFetch(apiUrl("/api/v1/expert-packs"), {
    cache: "no-store",
  });
  const data = await asJson(response);
  return Array.isArray(data?.packs) ? data.packs : [];
}

export async function createExpertPack(input: {
  display_name: string;
  skill_names: string[];
  pack_id?: string;
  source?: Record<string, unknown>;
}): Promise<ExpertPack> {
  const response = await apiFetch(apiUrl("/api/v1/expert-packs"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return asJson(response);
}
