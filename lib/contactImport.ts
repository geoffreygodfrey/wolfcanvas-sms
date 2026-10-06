import { pool } from "@/lib/db";
import { E164_RE } from "@/lib/phone";

const KNOWN_HEADERS = ["name", "phone", "email", "consent_status", "opted_out"];
const MAX_ROWS = 5000;

export interface ImportError {
  row: number;
  reason: string;
}

export interface ImportResult {
  imported: number;
  duplicates: number;
  errors: ImportError[];
  group_id?: string;
  group_name?: string;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 0 && r.some((c) => c.trim() !== ""));
}

function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-().]/g, "").trim();
  return E164_RE.test(cleaned) ? cleaned : null;
}

/** Parses + inserts a CSV of contacts. Returns a result summary, or throws an
 *  Error with a message suitable for the user when the CSV itself is invalid.
 *  Pass `opts.groupId` to also put every imported contact (including ones that
 *  already existed and were skipped as duplicates) into that group. */
export async function importContactsCsv(
  csv: string,
  opts?: { groupId?: string | null }
): Promise<ImportResult> {
  const trimmed = csv.trim();
  if (!trimmed) throw new Error("No CSV provided.");
  if (trimmed.length > 2_000_000) throw new Error("File is too large (max 2 MB).");

  const groupId = opts?.groupId?.trim();
  let group_name: string | undefined;
  if (groupId) {
    const g = await pool.query(`SELECT id, name FROM contact_groups WHERE id = $1`, [groupId]);
    if (g.rowCount === 0) throw new Error("That contact group doesn’t exist.");
    group_name = g.rows[0].name;
  }

  const rows = parseCsv(trimmed);
  if (rows.length === 0) throw new Error("CSV is empty.");
  if (rows.length > MAX_ROWS) throw new Error(`CSV has too many rows (max ${MAX_ROWS}).`);

  const first = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z_]/g, ""));
  const hasHeader = first.some((h) => KNOWN_HEADERS.includes(h));
  let rowsToImport = rows;
  let col = { name: 0, phone: 1, email: 2, consent: 3, optedOut: 4 };

  if (hasHeader) {
    rowsToImport = rows.slice(1);
    col = {
      name: first.indexOf("name"),
      phone: first.indexOf("phone"),
      email: first.indexOf("email"),
      consent: first.indexOf("consent_status"),
      optedOut: first.indexOf("opted_out"),
    };
  }

  if (col.name < 0 || col.phone < 0) {
    throw new Error("CSV must have name and phone columns.");
  }

  let imported = 0;
  let duplicates = 0;
  const errors: ImportError[] = [];

  for (const [idx, row] of rowsToImport.entries()) {
    const rowNum = hasHeader ? idx + 2 : idx + 1;
    const name = (row[col.name] ?? "").trim();
    const phone = normalizePhone(row[col.phone] ?? "");

    if (!name) {
      errors.push({ row: rowNum, reason: "Missing name." });
      continue;
    }
    if (!phone) {
      errors.push({
        row: rowNum,
        reason: `Invalid phone "${row[col.phone] ?? ""}" — must be E.164, e.g. +14165551234.`,
      });
      continue;
    }

    const email = col.email >= 0 ? (row[col.email] ?? "").trim() || null : null;
    let consent: string | null = col.consent >= 0 ? (row[col.consent] ?? "").trim() || null : null;
    let optedOut = false;

    if (consent) {
      const c = consent.toLowerCase();
      consent = c === "opted_in" || c === "opted-out" || c === "opt-out" ? "opted_in" : "";
      optedOut = c === "opted_out" || c === "opted-out" || c === "opt-out";
    }
    if (col.optedOut >= 0 && /^(true|1|yes|y|opted_out|out)$/i.test(row[col.optedOut] ?? "")) {
      optedOut = true;
      if (!consent) consent = "opted_out";
    }

    const result = await pool.query(
      `INSERT INTO contacts (name, email, phone, consent_status, opted_out)
       VALUES ($1, $2, $3, COALESCE($4, 'unknown'), $5)
       ON CONFLICT (phone) DO NOTHING
       RETURNING id`,
      [name, email, phone, consent, optedOut]
    );

    let contactId: string | null = result.rows[0]?.id ?? null;
    if (result.rowCount === 1) imported++;
    else {
      duplicates++;
      if (groupId) {
        const existing = await pool.query(`SELECT id FROM contacts WHERE phone = $1`, [phone]);
        contactId = existing.rows[0]?.id ?? null;
      }
    }

    if (groupId && contactId) {
      await pool.query(
        `INSERT INTO contact_group_members (group_id, contact_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [groupId, contactId]
      );
    }
  }

  return { imported, duplicates, errors, group_id: groupId || undefined, group_name };
}