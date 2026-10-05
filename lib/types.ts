export type ConsentStatus = "opted_in" | "opted_out" | "unknown";

export interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  consent_status: ConsentStatus;
  opted_out: boolean;
  created_at: string;
  groups?: string[];
  tags?: string[];
}

export interface ContactGroup {
  id: string;
  name: string;
  contact_count: number;
  created_at?: string;
}

export type CampaignStatus = "draft" | "scheduled" | "sending" | "completed" | "paused";

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  scheduled_at: string | null;
  ai_enabled: boolean;
  ai_system_prompt: string | null;
  created_at: string;
  min_delay_seconds: number;
  send_start_hour: number | null;
  send_end_hour: number | null;
  /** IANA timezone the send window refers to (API always returns a real name). */
  timezone: string;
  /** Max outbound messages per contact per day; 0 = unlimited. */
  daily_cap: number;
  /** Max outbound messages per campaign per day; 0 = unlimited (serverless budget cap). */
  daily_budget: number;
  /** Telnyx messaging profile to send from; null = default number. */
  telnyx_profile_id: string | null;
}

export interface CampaignVariant {
  id: string;
  campaign_id: string;
  label: string;
  message_template: string;
  created_at: string;
  contact_count?: number;
}

export interface CampaignContactRow extends Contact {
  variant_id: string | null;
  variant_label: string | null;
}

export type ScenarioAction = "reply" | "book" | "opt_out" | "none";

export interface CampaignScenario {
  id: string;
  campaign_id: string;
  label: string;
  keywords: string;
  reply_template: string;
  action: ScenarioAction;
  priority: number;
  enabled: boolean;
  created_at?: string;
}

export interface CampaignFollowUp {
  id: string;
  campaign_id: string;
  position: number;
  delay_days: number;
  delay_hours: number;
  message_template: string;
  enabled: boolean;
  created_at: string;
}

export interface SendSummary {
  campaign_id: string;
  total?: number;
  sent?: number;
  failed?: number;
  queued?: number;
  min_delay_seconds?: number;
  window?: string;
  first_send_at?: string | null;
  last_send_at?: string | null;
  skippedOptedOut: number;
  skippedNoConsent: number;
  unassigned: number;
}

/** One rendered message from the Send-preview dry run (before anything queues). */
export interface SendPreviewItem {
  contact_id: string;
  contact_name: string;
  phone: string;
  variant_label: string;
  body: string;
  send_at: string;
}

export interface SendPreview {
  dry_run: true;
  campaign_id: string;
  total: number;
  preview: SendPreviewItem[];
  min_delay_seconds?: number;
  window?: string;
  skippedOptedOut: number;
  skippedNoConsent: number;
  unassigned: number;
}

export type ConversationStatus = "ai_active" | "human_takeover" | "closed";

export interface Conversation {
  id: string;
  contact_id: string;
  contact_name: string;
  phone: string;
  opted_out: boolean;
  campaign_id: string | null;
  campaign_name: string | null;
  status: ConversationStatus;
  qualified: boolean;
  qualified_at: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message: string | null;
  last_direction: "inbound" | "outbound" | null;
  last_message_at: string | null;
  appointment_count: number;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  message_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
}

export interface AppointmentRow {
  id: string;
  scheduled_at: string;
  status: string;
}

export interface ConversationDetail extends Conversation {
  messages: ConversationMessage[];
  appointments: AppointmentRow[];
}
