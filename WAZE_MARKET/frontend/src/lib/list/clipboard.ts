/** The clipboard's text, or null when it's empty or the browser won't hand it over. */
export async function readClipboard(): Promise<string | null> {
  try {
    const text = await navigator.clipboard?.readText();
    return text?.trim() ? text : null;
  } catch {
    return null;
  }
}
