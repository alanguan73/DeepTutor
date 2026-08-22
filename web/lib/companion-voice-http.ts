import { apiFetch, apiUrl } from "@/lib/api";

export async function companionTranscribe(blob: Blob): Promise<string> {
  const form = new FormData();
  const mime = blob.type || "audio/webm";
  const ext = mime.includes("ogg")
    ? "ogg"
    : mime.includes("mp4") || mime.includes("m4a")
      ? "mp4"
      : "webm";
  form.append("file", blob, `companion.${ext}`);
  form.append("language", "zh");
  const resp = await apiFetch(apiUrl("/api/v1/voice/stt"), {
    method: "POST",
    body: form,
  });
  if (!resp.ok) {
    const detail = (await resp.json().catch(() => null)) as {
      detail?: string;
    } | null;
    throw new Error(detail?.detail || `stt ${resp.status}`);
  }
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
