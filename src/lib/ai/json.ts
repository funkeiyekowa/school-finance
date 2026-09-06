/** Parse a provider response that should contain one JSON object. */
export function parseAiJsonObject<T>(output: string): T | null {
  const trimmed = output.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(withoutFence) as T;
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(withoutFence.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}
