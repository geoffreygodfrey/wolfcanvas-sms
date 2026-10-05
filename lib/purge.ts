import type { PoolClient, QueryResultRow } from "pg";

const DEFAULT_PURGE_DAYS = 30;
const DEFAULT_PURGE_BATCH = 200;

export interface OptOutStats {
  opted_out: number;
  purge_days: number;
  eligible_contacts: number;
  eligible_messages: number;
  eligible_conversations: number;
  eligible_appointments: number;
}

export interface PurgeResult {
  contacts: number;
  messages: number;
  conversations: number;
  appointments: number;
}

function asPositiveInt(v: string | undefined, fallback: number): number {
  const n = Number.parseInt(v ?? "", 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return n;
}

/** Retention window (days) before an opted-out contact is eligible for deletion. */
export function getPurgeDays(): number {
  return asPositiveInt(process.env.OPT_OUT_PURGE_DAYS, DEFAULT_PURGE_DAYS);
}

/** Counts of opted-out contacts and how many are past the retention window. */
export async function getOptOutStats(db: PoolClient): Promise<OptOutStats> {
  const res = await db.query(
    `WITH eligible AS (
       SELECT id FROM contacts
       WHERE opted_out AND opted_out_at IS NOT NULL
         AND opted_out_at <= now() - (interval '1 day' * $1::int)
     )
     SELECT
       (SELECT COUNT(*)::int FROM contacts WHERE opted_out)                                 AS opted_out,
       (SELECT COUNT(*)::int FROM eligible)                                                 AS eligible_contacts,
       (SELECT COUNT(*)::int FROM messages      WHERE contact_id IN (SELECT id FROM eligible)) AS eligible_messages,
       (SELECT COUNT(*)::int FROM conversations WHERE contact_id IN (SELECT id FROM eligible)) AS eligible_conversations,
       (SELECT COUNT(*)::int FROM appointments  WHERE contact_id IN (SELECT id FROM eligible)) AS eligible_appointments`,
    [getPurgeDays()]
  );
  const row: QueryResultRow = res.rows[0] ?? {};
  return {
    opted_out: row.opted_out ?? 0,
    purge_days: getPurgeDays(),
    eligible_contacts: row.eligible_contacts ?? 0,
    eligible_messages: row.eligible_messages ?? 0,
    eligible_conversations: row.eligible_conversations ?? 0,
    eligible_appointments: row.eligible_appointments ?? 0,
  };
}

/** Deletes opted-out contacts past the retention window (and all their data).
 *  Child rows go first since the FKs have no ON DELETE CASCADE. Transactional. */
export async function purgeOptedOut(db: PoolClient, batchLimit = DEFAULT_PURGE_BATCH): Promise<PurgeResult> {
  const empty: PurgeResult = { contacts: 0, messages: 0, conversations: 0, appointments: 0 };

  await db.query("BEGIN");
  try {
    const ids = await db.query(
      `SELECT id FROM contacts
       WHERE opted_out AND opted_out_at IS NOT NULL
         AND opted_out_at <= now() - (interval '1 day' * $1::int)
       LIMIT $2`,
      [getPurgeDays(), batchLimit]
    );
    const contactIds = ids.rows.map((r) => r.id as string);
    if (contactIds.length === 0) {
      await db.query("ROLLBACK");
      return empty;
    }

    const appt = await db.query(`DELETE FROM appointments WHERE contact_id = ANY($1)`, [contactIds]);
    const conv = await db.query(`DELETE FROM conversations WHERE contact_id = ANY($1)`, [contactIds]);
    const msg = await db.query(`DELETE FROM messages WHERE contact_id = ANY($1)`, [contactIds]);
    const con = await db.query(`DELETE FROM contacts WHERE id = ANY($1)`, [contactIds]);
    await db.query("COMMIT");

    return {
      contacts: con.rowCount ?? 0,
      messages: msg.rowCount ?? 0,
      conversations: conv.rowCount ?? 0,
      appointments: appt.rowCount ?? 0,
    };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}