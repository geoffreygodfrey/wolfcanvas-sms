/** This machine's IANA timezone (e.g. "Europe/London"). */
export const LOCAL_TZ: string =
  (typeof Intl !== "undefined" && Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC";

/** Map a stored value to a real IANA timezone. "LOCAL" / empty means the
 *  machine the app runs on. Also used by the DB default for legacy rows. */
export function resolveTimezone(tz?: string | null): string {
  const t = (tz ?? "").trim();
  if (t && t !== "LOCAL") return t;
  return LOCAL_TZ;
}

/** Short offset label like "GMT+1" or "GMT-4" for a timezone at a given moment. */
export function tzAbbrev(tz: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(at);
    const name = parts.find((p) => p.type === "timeZoneName")?.value;
    if (name) return name;
  } catch {
    /* fall through to raw name */
  }
  return tz === "LOCAL" ? LOCAL_TZ : tz;
}

export interface TimezoneOption {
  /** IANA name — what actually gets stored and used for scheduling. */
  value: string;
  /** Friendly label for the dropdown, e.g. "Eastern · NY, Toronto, Miami". */
  label: string;
}

/** Curated timezones for the campaign scheduler — grouped by business zone
 *  with representative cities, with full Canadian coverage. Keep it small. */
export const TIMEZONES: TimezoneOption[] = [
  { value: "UTC", label: "UTC (GMT) · London winter" },
  { value: "America/New_York", label: "Eastern · NY, Toronto, Miami, Atlanta, Montreal" },
  { value: "America/Chicago", label: "Central · Chicago, Winnipeg, Dallas, Mexico City" },
  { value: "America/Regina", label: "Central (no DST) · Regina, Saskatoon" },
  { value: "America/Denver", label: "Mountain · Denver, Calgary, Edmonton" },
  { value: "America/Los_Angeles", label: "Pacific · Vancouver, LA, Seattle" },
  { value: "America/Halifax", label: "Atlantic · Halifax, Puerto Rico" },
  { value: "America/St_Johns", label: "Newfoundland · St. John's (+3:30)" },
  { value: "Europe/London", label: "UK & Ireland · London, Dublin" },
  { value: "Europe/Paris", label: "Western Europe · Paris, Berlin, Madrid, Rome" },
  { value: "Europe/Helsinki", label: "Eastern Europe · Helsinki, Athens, Bucharest" },
  { value: "Africa/Lagos", label: "West Africa · Lagos, Accra" },
  { value: "Africa/Nairobi", label: "East Africa · Nairobi, Kampala" },
  { value: "Asia/Dubai", label: "Gulf · Dubai, Riyadh" },
  { value: "Asia/Calcutta", label: "India · Mumbai, Delhi, Kolkata" },
  { value: "Asia/Singapore", label: "SE Asia · Singapore, Kuala Lumpur" },
  { value: "Asia/Shanghai", label: "China · Beijing, Shanghai, Hong Kong" },
  { value: "Asia/Tokyo", label: "Japan · Tokyo, Osaka" },
  { value: "Australia/Sydney", label: "Australia East · Sydney, Melbourne" },
  { value: "Australia/Perth", label: "Australia West · Perth" },
  { value: "Pacific/Auckland", label: "New Zealand · Auckland" },
  { value: "America/Sao_Paulo", label: "South America · São Paulo, Rio" },
];