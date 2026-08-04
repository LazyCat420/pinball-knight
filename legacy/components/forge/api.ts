/** Tiny fetch layer — every server error becomes a thrown message. */

export async function postJSON(url: string, body: unknown): Promise<any> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

export async function del(url: string): Promise<any> {
  const r = await fetch(url, { method: "DELETE" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

/** An image URL (same origin) → bare base64 PNG, for feeding back as an init. */
export async function urlToB64(src: string): Promise<string> {
  const blob = await (await fetch(src)).blob();
  return await new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onload = () => res(String(rd.result));
    rd.onerror = rej;
    rd.readAsDataURL(blob);
  });
}

export function fileToB64(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onload = () => res(String(rd.result));
    rd.onerror = rej;
    rd.readAsDataURL(f);
  });
}
