/** Parse fetch responses safely — avoids "Unexpected end of JSON input" on empty bodies. */
export async function readResponseJson<T = Record<string, unknown>>(
  res: Response
): Promise<T> {
  const raw = await res.text();
  if (!raw.trim()) {
    if (!res.ok) {
      throw new Error(`Request failed (HTTP ${res.status}) with an empty response.`);
    }
    return {} as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `Server returned non-JSON (HTTP ${res.status}): ${raw.slice(0, 180)}`
    );
  }
}

export async function fetchJson<T = Record<string, unknown>>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{ res: Response; data: T }> {
  const res = await fetch(input, init);
  const data = await readResponseJson<T>(res);
  return { res, data };
}
