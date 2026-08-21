import { apiFetch, apiUrl } from "@/lib/api";

export async function companionTranscribe(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append("file", blob, "companion.webm");
  form.append("language", "zh");
  const resp = await apiFetch(apiUrl("/api/v1/voice/stt"), {
    method: "POST",
    body: form,
  });
  if (!resp.ok) throw new Error(`stt ${resp.status}`);
  const data = (await resp.json()) as { text?: string };
  return (data.text || "").trim();
}

export async function companionSynthesizeAndPlay(
  text: string,
  signal: AbortSignal,
): Promise<void> {
  const resp = await apiFetch(apiUrl("/api/v1/voice/tts"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!resp.ok) throw new Error(`tts ${resp.status}`);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  try {
    const audio = new Audio(url);
    if (signal.aborted) return;
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        audio.pause();
        reject(new DOMException("aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("audio error"));
      void audio.play().catch(reject);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
