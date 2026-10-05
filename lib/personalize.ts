/** Extract the first name from a full name. Falls back to the original
 *  string when there's nothing splittable (empty, single word, initials…). */
export function firstName(fullName: string): string {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return fullName ?? "";
  const first = trimmed.split(/\s+/)[0];
  return first || trimmed;
}