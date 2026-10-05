export const CONTACT_TAG_PRESETS = [
  "Needs qualification",
  "Needs follow up",
  "Needs reminder",
  "Awaiting deletion",
] as const;

export type ContactTag = (typeof CONTACT_TAG_PRESETS)[number];

/** Detached by the reply engine when a contact opts out (STOP or "not interested"). */
export const AWAITING_DELETION_TAG = "Awaiting deletion";