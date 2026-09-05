import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { timingSafeEqual } from 'node:crypto';

const port = Number(process.env.PORT || 3000);
const dataDir = resolve(process.env.DATA_DIR || './data');
const publicDir = resolve('./dist');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, 'verein.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    member_number TEXT NOT NULL UNIQUE,
    salutation TEXT,
    title TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    gender TEXT,
    birth_date TEXT,
    street TEXT,
    postal_code TEXT,
    city TEXT,
    country TEXT NOT NULL DEFAULT 'DE',
    phone_private TEXT,
    phone_mobile TEXT,
    phone_business TEXT,
    email TEXT,
    website TEXT,
    entry_date TEXT NOT NULL,
    exit_date TEXT,
    exit_reason TEXT,
    department TEXT NOT NULL DEFAULT 'Fussball',
    department_entry_date TEXT,
    contribution_type TEXT NOT NULL,
    annual_fee_cents INTEGER NOT NULL DEFAULT 0,
    payment_frequency TEXT NOT NULL DEFAULT 'j',
    payment_method TEXT NOT NULL DEFAULT 's',
    account_holder TEXT,
    iban TEXT,
    bic TEXT,
    mandate_reference TEXT,
    mandate_signed_at TEXT,
    sepa_sequence TEXT NOT NULL DEFAULT 'RCUR',
    function_name TEXT,
    honors TEXT,
    alternate_address TEXT,
    custom_fields TEXT NOT NULL DEFAULT '{}',
    notes TEXT,
    privacy_consent_at TEXT,
    image_consent INTEGER NOT NULL DEFAULT 0,
    email_consent INTEGER NOT NULL DEFAULT 0,
    spg_synced_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS club_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    club_name TEXT NOT NULL,
    creditor_id TEXT,
    iban TEXT,
    bic TEXT,
    sepa_message_prefix TEXT NOT NULL DEFAULT 'GUT-WEB',
    updated_at TEXT NOT NULL
  );
  INSERT OR IGNORE INTO club_settings (id, club_name, sepa_message_prefix, updated_at)
  VALUES (1, 'GUT Verein', 'GUT-WEB', datetime('now'));
`);

const columns = `
  id, member_number AS memberNumber, salutation, title,
  first_name AS firstName, last_name AS lastName, gender, birth_date AS birthDate,
  street, postal_code AS postalCode, city, country,
  phone_private AS phonePrivate, phone_mobile AS phoneMobile, phone_business AS phoneBusiness,
  email, website, entry_date AS entryDate, exit_date AS exitDate, exit_reason AS exitReason,
  department, department_entry_date AS departmentEntryDate,
  contribution_type AS contributionType, annual_fee_cents AS annualFeeCents,
  payment_frequency AS paymentFrequency, payment_method AS paymentMethod,
  account_holder AS accountHolder, iban, bic, mandate_reference AS mandateReference,
  mandate_signed_at AS mandateSignedAt, sepa_sequence AS sepaSequence,
  function_name AS functionName, honors, alternate_address AS alternateAddress,
  custom_fields AS customFields, notes, privacy_consent_at AS privacyConsentAt,
  image_consent AS imageConsent, email_consent AS emailConsent,
  spg_synced_at AS spgSyncedAt, created_at AS createdAt, updated_at AS updatedAt`;

const memberFields = [
  ['salutation', 'salutation', 15], ['title', 'title', 20],
  ['firstName', 'first_name', 35], ['lastName', 'last_name', 35],
  ['gender', 'gender', 1], ['birthDate', 'birth_date', 10],
  ['street', 'street', 70], ['postalCode', 'postal_code', 10],
  ['city', 'city', 50], ['country', 'country', 5],
  ['phonePrivate', 'phone_private', 30], ['phoneMobile', 'phone_mobile', 30],
  ['phoneBusiness', 'phone_business', 30], ['email', 'email', 100],
  ['website', 'website', 150], ['entryDate', 'entry_date', 10],
  ['exitDate', 'exit_date', 10], ['exitReason', 'exit_reason', 100],
  ['department', 'department', 50], ['departmentEntryDate', 'department_entry_date', 10],
  ['contributionType', 'contribution_type', 70], ['paymentFrequency', 'payment_frequency', 1],
  ['paymentMethod', 'payment_method', 1], ['accountHolder', 'account_holder', 70],
  ['iban', 'iban', 34], ['bic', 'bic', 11],
  ['mandateReference', 'mandate_reference', 35], ['mandateSignedAt', 'mandate_signed_at', 10],
  ['sepaSequence', 'sepa_sequence', 4], ['functionName', 'function_name', 100],
  ['honors', 'honors', 2000], ['alternateAddress', 'alternate_address', 2000],
  ['customFields', 'custom_fields', 8000], ['notes', 'notes', 8000],
  ['privacyConsentAt', 'privacy_consent_at', 10],
];

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/api/health') return json(response, 200, { ok: true });
    if (!authorized(request)) return unauthorized(response);
    if (url.pathname === '/api/members' && request.method === 'GET') return listMembers(response);
    if (url.pathname === '/api/members' && request.method === 'POST') return createMember(request, response);
    if (url.pathname.startsWith('/api/members/') && request.method === 'PUT') {
      return updateMember(url.pathname.slice('/api/members/'.length), request, response);
    }
    if (url.pathname === '/api/settings' && request.method === 'GET') return getSettings(response);
    if (url.pathname === '/api/settings' && request.method === 'PUT') return putSettings(request, response);
    if (url.pathname === '/api/export/sepa' && request.method === 'POST') return exportSepa(request, response);
    if (url.pathname === '/api/spg/status' && request.method === 'GET') return spgStatus(response);
    if (url.pathname === '/api/spg/import' && request.method === 'POST') return importSpgMembers(response);
    if (url.pathname === '/api/export/spg-backup' && request.method === 'POST') return exportSpgBackup(response);
    if (url.pathname.startsWith('/api/')) return json(response, 404, { error: 'Nicht gefunden.' });
    return staticFile(url.pathname, response);
  } catch (error) {
    console.error(error);
    return json(response, 500, { error: 'Interner Fehler.' });
  }
});

server.listen(port, '0.0.0.0', () => console.log(`GUT Vereinsverwaltung listening on :${port}`));

function listMembers(response) {
  const members = db.prepare(`SELECT ${columns} FROM members ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE`).all().map(normalizeMember);
  return json(response, 200, { members });
}

async function createMember(request, response) {
  const body = await bodyJson(request);
  const firstName = text(body.firstName, 35);
  const lastName = text(body.lastName, 35);
  const entryDate = date(body.entryDate);
  if (!firstName || !lastName || !entryDate) return json(response, 400, { error: 'Vorname, Nachname und Eintrittsdatum sind erforderlich.' });
  const annualFeeCents = integer(body.annualFeeCents, 0, 10_000_000);
  if (annualFeeCents === null) return json(response, 400, { error: 'Der Beitrag ist ungültig.' });
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const memberNumber = text(body.memberNumber, 20) || `W${Date.now().toString(36).toUpperCase().slice(-9)}`;
  const values = memberRecord(body, { id, memberNumber, annualFeeCents, now });
  try {
    db.prepare(`INSERT INTO members (${values.columns.join(', ')}) VALUES (${values.columns.map(() => '?').join(', ')})`).run(...values.values);
  } catch (error) {
    return json(response, 400, { error: String(error).includes('UNIQUE') ? 'Diese Mitgliedsnummer ist bereits vergeben.' : 'Das Mitglied konnte nicht gespeichert werden.' });
  }
  const member = normalizeMember(db.prepare(`SELECT ${columns} FROM members WHERE id = ?`).get(id));
  return json(response, 201, { member });
}

async function updateMember(id, request, response) {
  const existing = db.prepare('SELECT id FROM members WHERE id = ?').get(id);
  if (!existing) return json(response, 404, { error: 'Mitglied nicht gefunden.' });
  const body = await bodyJson(request);
  const firstName = text(body.firstName, 35);
  const lastName = text(body.lastName, 35);
  const entryDate = date(body.entryDate);
  const annualFeeCents = integer(body.annualFeeCents, 0, 10_000_000);
  if (!firstName || !lastName || !entryDate || annualFeeCents === null) return json(response, 400, { error: 'Pflichtfelder sind unvollständig oder ungültig.' });
  const pairs = memberFields.map(([api, column, max]) => [column, text(body[api], max)]);
  pairs.push(['annual_fee_cents', annualFeeCents]);
  pairs.push(['image_consent', body.imageConsent ? 1 : 0]);
  pairs.push(['email_consent', body.emailConsent ? 1 : 0]);
  pairs.push(['spg_synced_at', null]);
  pairs.push(['updated_at', new Date().toISOString()]);
  db.prepare(`UPDATE members SET ${pairs.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`).run(...pairs.map(([, value]) => value), id);
  return json(response, 200, { member: normalizeMember(db.prepare(`SELECT ${columns} FROM members WHERE id = ?`).get(id)) });
}

function memberRecord(body, meta) {
  const record = Object.fromEntries(memberFields.map(([api, column, max]) => [column, text(body[api], max)]));
  Object.assign(record, {
    id: meta.id, member_number: meta.memberNumber,
    first_name: text(body.firstName, 35), last_name: text(body.lastName, 35),
    entry_date: date(body.entryDate), country: text(body.country, 5) || 'DE',
    department: text(body.department, 50) || 'Fussball',
    department_entry_date: date(body.departmentEntryDate) || date(body.entryDate),
    contribution_type: text(body.contributionType, 70) || 'Erwachsene aktive Mitglieder',
    annual_fee_cents: meta.annualFeeCents,
    payment_frequency: text(body.paymentFrequency, 1) || 'j',
    payment_method: text(body.paymentMethod, 1) || 's',
    sepa_sequence: text(body.sepaSequence, 4) || 'RCUR',
    custom_fields: typeof body.customFields === 'string' ? body.customFields : '{}',
    image_consent: body.imageConsent ? 1 : 0, email_consent: body.emailConsent ? 1 : 0,
    created_at: meta.now, updated_at: meta.now,
  });
  return { columns: Object.keys(record), values: Object.values(record) };
}

function getSettings(response) {
  const row = db.prepare('SELECT club_name AS clubName, creditor_id AS creditorId, iban, bic, sepa_message_prefix AS sepaMessagePrefix FROM club_settings WHERE id = 1').get();
  return json(response, 200, { settings: row });
}

async function putSettings(request, response) {
  const body = await bodyJson(request);
  const clubName = text(body.clubName, 70);
  if (!clubName) return json(response, 400, { error: 'Der Vereinsname fehlt.' });
  db.prepare(`UPDATE club_settings SET club_name=?, creditor_id=?, iban=?, bic=?, sepa_message_prefix=?, updated_at=? WHERE id=1`).run(
    clubName, text(body.creditorId, 35), iban(body.iban), text(body.bic, 11)?.toUpperCase(), text(body.sepaMessagePrefix, 20) || 'GUT-WEB', new Date().toISOString(),
  );
  return json(response, 200, { ok: true });
}

async function exportSepa(request, response) {
  const body = await bodyJson(request);
  const collectionDate = date(body.collectionDate);
  const format = body.format === 'pain.008.001.02' ? body.format : 'pain.008.001.08';
  if (!collectionDate) return json(response, 400, { error: 'Einzugsdatum fehlt oder ist ungültig.' });
  const settings = db.prepare('SELECT club_name AS clubName, creditor_id AS creditorId, iban, bic, sepa_message_prefix AS prefix FROM club_settings WHERE id=1').get();
  const members = db.prepare(`SELECT member_number AS memberNumber, first_name AS firstName, last_name AS lastName, annual_fee_cents AS annualFeeCents, account_holder AS accountHolder, iban, bic, mandate_reference AS mandateReference, mandate_signed_at AS mandateSignedAt FROM members WHERE payment_method='s' AND exit_date IS NULL AND annual_fee_cents > 0`).all();
  try {
    const output = createSepaXml({ members, settings, collectionDate, format });
    response.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="${output.messageId}.xml"`, 'Content-Length': Buffer.byteLength(output.xml) });
    response.end(output.xml);
  } catch (error) {
    return json(response, 400, { error: error instanceof Error ? error.message : 'SEPA-Export fehlgeschlagen.' });
  }
}

async function bridgeStatus() {
  const base = process.env.SPG_BRIDGE_URL?.replace(/\/$/, '');
  const token = process.env.SPG_BRIDGE_TOKEN;
  if (!base || !token) return { connected: false, compatible: false, reason: 'Die Windows-SPG-Brücke ist noch nicht konfiguriert.' };
  try {
    const result = await fetch(`${base}/api/health`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    if (!result.ok) return { connected: false, compatible: false, reason: `Brücke antwortet mit HTTP ${result.status}.` };
    const data = await result.json();
    const compatible = data.compatible === true
      && data.sqlServerMajor === data.expectedSqlServerMajor
      && data.databaseVersion === data.expectedDatabaseVersion
      && data.mandant === 'GUT';
    return { ...data, connected: true, compatible, writeCompatible: Boolean(compatible && data.writeCompatible), reason: compatible ? null : 'SQL-Server-Version, Datenbankformat oder Mandant stimmen nicht mit der geprüften SPG-Sicherung überein.' };
  } catch {
    return { connected: false, compatible: false, reason: 'Die Windows-SPG-Brücke ist nicht erreichbar.' };
  }
}

async function spgStatus(response) {
  const status = await bridgeStatus();
  return json(response, status.compatible ? 200 : 503, status);
}

async function importSpgMembers(response) {
  const status = await bridgeStatus();
  if (!status.compatible) return json(response, 503, { error: status.reason, status });
  const bridge = process.env.SPG_BRIDGE_URL.replace(/\/$/, '');
  const result = await fetch(`${bridge}/api/members`, {
    headers: { Authorization: `Bearer ${process.env.SPG_BRIDGE_TOKEN}` },
    signal: AbortSignal.timeout(120000),
  });
  if (!result.ok) return json(response, 502, { error: `Die SPG-Brücke antwortet mit HTTP ${result.status}.` });
  const payload = await result.json();
  if (!Array.isArray(payload.members)) return json(response, 502, { error: 'Die SPG-Brücke hat keinen gültigen Mitgliederbestand geliefert.' });
  const findExisting = db.prepare('SELECT id, spg_synced_at AS spgSyncedAt FROM members WHERE member_number = ?');
  const now = new Date().toISOString();
  let imported = 0; let updated = 0; let skipped = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const raw of payload.members) {
      const memberNumber = text(raw.memberNumber, 20);
      const firstName = text(raw.firstName, 35) || '';
      const lastName = text(raw.lastName, 35) || '';
      const entryDate = date(raw.entryDate);
      if (!memberNumber || !entryDate) { skipped += 1; continue; }
      const input = { ...raw, firstName, lastName, entryDate, annualFeeCents: integer(raw.annualFeeCents, 0, 10_000_000) ?? 0 };
      const existing = findExisting.get(memberNumber);
      if (existing && !existing.spgSyncedAt) { skipped += 1; continue; }
      if (!existing) {
        const record = memberRecord(input, { id: `spg:${memberNumber}`, memberNumber, annualFeeCents: input.annualFeeCents, now });
        record.columns.push('spg_synced_at'); record.values.push(now);
        db.prepare(`INSERT INTO members (${record.columns.join(', ')}) VALUES (${record.columns.map(() => '?').join(', ')})`).run(...record.values);
        imported += 1;
      } else {
        const pairs = memberFields.map(([api, column, max]) => [column, text(input[api], max)]);
        pairs.push(['annual_fee_cents', input.annualFeeCents]);
        pairs.push(['image_consent', input.imageConsent ? 1 : 0]);
        pairs.push(['email_consent', input.emailConsent ? 1 : 0]);
        pairs.push(['spg_synced_at', now]); pairs.push(['updated_at', now]);
        db.prepare(`UPDATE members SET ${pairs.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`).run(...pairs.map(([, value]) => value), existing.id);
        updated += 1;
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return json(response, 200, { ok: true, imported, updated, skipped, total: payload.members.length });
}

async function exportSpgBackup(response) {
  const status = await bridgeStatus();
  if (!status.compatible) return json(response, 503, { error: status.reason, status });
  const pendingMembers = db.prepare(`SELECT ${columns} FROM members WHERE spg_synced_at IS NULL ORDER BY created_at`).all().map(normalizeMember);
  if (pendingMembers.length > 0 && !status.writeCompatible) {
    return json(response, 409, {
      error: `Die Sicherung ist gesperrt: ${pendingMembers.length} Webapp-Datensätze warten auf den vollständigen SPG-Roundtrip und die Schreibfreigabe.`,
    });
  }
  const bridge = process.env.SPG_BRIDGE_URL.replace(/\/$/, '');
  if (pendingMembers.length > 0) {
    const syncResult = await fetch(`${bridge}/api/members/sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.SPG_BRIDGE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: pendingMembers }),
      signal: AbortSignal.timeout(120000),
    });
    const syncBody = await syncResult.json();
    if (!syncResult.ok || !syncBody.ok || !Array.isArray(syncBody.mappings)) {
      return json(response, 502, { error: syncBody.error || 'Die SPG-Brücke konnte die Änderungen nicht speichern.' });
    }
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      const mark = db.prepare('UPDATE members SET member_number=?, spg_synced_at=?, updated_at=? WHERE member_number=? AND spg_synced_at IS NULL');
      for (const mapping of syncBody.mappings) mark.run(mapping.memberNumber, now, now, mapping.localMemberNumber);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const result = await fetch(`${bridge}/api/backups`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.SPG_BRIDGE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ mandant: 'GUT', expectedSqlServerMajor: status.expectedSqlServerMajor, expectedDatabaseVersion: status.expectedDatabaseVersion }) });
  if (!result.ok) return json(response, 502, { error: 'Die SPG-Brücke konnte keine geprüfte Sicherung erstellen.' });
  response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': result.headers.get('content-disposition') || `attachment; filename="GUT_${timestampCompact()}.zip"` });
  const buffer = Buffer.from(await result.arrayBuffer());
  response.end(buffer);
}

function createSepaXml({ members, settings, collectionDate, format }) {
  if (!members.length) throw new Error('Keine beitragsbereiten SEPA-Mitglieder gefunden.');
  if (!validIban(settings.iban)) throw new Error('Die Vereins-IBAN ist ungültig.');
  if (!settings.creditorId || !settings.bic) throw new Error('Gläubiger-ID oder Vereins-BIC fehlt.');
  const invalid = members.find((m) => !validIban(m.iban) || !m.mandateReference || !m.mandateSignedAt);
  if (invalid) throw new Error(`SEPA-Angaben bei ${invalid.memberNumber} sind unvollständig oder ungültig.`);
  const now = new Date();
  const messageId = `${safe(settings.prefix)}-${timestampCompact(now)}`.slice(0, 35);
  const total = members.reduce((sum, m) => sum + m.annualFeeCents, 0);
  const bicTag = format.endsWith('.08') ? 'BICFI' : 'BIC';
  const transactions = members.map((m, index) => `<DrctDbtTxInf><PmtId><EndToEndId>${xml(`${m.memberNumber}-${collectionDate.replaceAll('-', '')}-${index + 1}`.slice(0, 35))}</EndToEndId></PmtId><InstdAmt Ccy="EUR">${money(m.annualFeeCents)}</InstdAmt><DrctDbtTx><MndtRltdInf><MndtId>${xml(m.mandateReference)}</MndtId><DtOfSgntr>${xml(m.mandateSignedAt)}</DtOfSgntr></MndtRltdInf></DrctDbtTx><DbtrAgt><FinInstnId>${m.bic ? `<${bicTag}>${xml(m.bic)}</${bicTag}>` : '<Othr><Id>NOTPROVIDED</Id></Othr>'}</FinInstnId></DbtrAgt><Dbtr><Nm>${xml(m.accountHolder || `${m.firstName} ${m.lastName}`)}</Nm></Dbtr><DbtrAcct><Id><IBAN>${xml(iban(m.iban))}</IBAN></Id></DbtrAcct><RmtInf><Ustrd>${xml(`Mitgliedsbeitrag ${m.memberNumber}`)}</Ustrd></RmtInf></DrctDbtTxInf>`).join('');
  const content = `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:${format}"><CstmrDrctDbtInitn><GrpHdr><MsgId>${xml(messageId)}</MsgId><CreDtTm>${now.toISOString()}</CreDtTm><NbOfTxs>${members.length}</NbOfTxs><CtrlSum>${money(total)}</CtrlSum><InitgPty><Nm>${xml(settings.clubName)}</Nm></InitgPty></GrpHdr><PmtInf><PmtInfId>${xml(messageId)}</PmtInfId><PmtMtd>DD</PmtMtd><BtchBookg>true</BtchBookg><NbOfTxs>${members.length}</NbOfTxs><CtrlSum>${money(total)}</CtrlSum><PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Cd>CORE</Cd></LclInstrm><SeqTp>RCUR</SeqTp></PmtTpInf><ReqdColltnDt>${collectionDate}</ReqdColltnDt><Cdtr><Nm>${xml(settings.clubName)}</Nm></Cdtr><CdtrAcct><Id><IBAN>${xml(iban(settings.iban))}</IBAN></Id></CdtrAcct><CdtrAgt><FinInstnId><${bicTag}>${xml(settings.bic)}</${bicTag}></FinInstnId></CdtrAgt><ChrgBr>SLEV</ChrgBr><CdtrSchmeId><Id><PrvtId><Othr><Id>${xml(settings.creditorId)}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>${transactions}</PmtInf></CstmrDrctDbtInitn></Document>`;
  return { xml: content, messageId };
}

function normalizeMember(row) {
  return { ...row, customFields: safeJson(row.customFields), imageConsent: Boolean(row.imageConsent), emailConsent: Boolean(row.emailConsent) };
}
function safeJson(value) { try { return JSON.parse(value || '{}'); } catch { return {}; } }
function text(value, max) { if (value === null || value === undefined) return null; const result = String(value).trim(); return result ? result.slice(0, max) : null; }
function date(value) { const result = text(value, 10); return result && /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null; }
function integer(value, min, max) { const result = Number(value); return Number.isInteger(result) && result >= min && result <= max ? result : null; }
function iban(value) { return text(value, 34)?.replace(/\s+/g, '').toUpperCase() || ''; }
function validIban(value) { const valueNormalized = iban(value); if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(valueNormalized)) return false; const rearranged = valueNormalized.slice(4) + valueNormalized.slice(0, 4); let remainder = 0; for (const char of rearranged) { const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55); for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97; } return remainder === 1; }
function xml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;'); }
function money(cents) { return (cents / 100).toFixed(2); }
function safe(value) { return String(value || 'GUT-WEB').replace(/[^A-Za-z0-9+?/:().,'-]/g, '-').slice(0, 20); }
function timestampCompact(dateValue = new Date()) { return dateValue.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14); }

async function bodyJson(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 1_000_000) throw new Error('Request too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function json(response, status, value) { const body = JSON.stringify(value); response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }); response.end(body); }
function authorized(request) {
  const expectedUser = process.env.ADMIN_USER; const expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedUser || !expectedPassword) return true;
  const [scheme, token] = (request.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !token) return false;
  const provided = Buffer.from(token, 'base64').toString('utf8');
  return safeEqual(provided, `${expectedUser}:${expectedPassword}`);
}
function safeEqual(a, b) { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
function unauthorized(response) { response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="GUT Vereinsverwaltung", charset="UTF-8"' }); response.end('Anmeldung erforderlich'); }
function staticFile(pathname, response) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = normalize(join(publicDir, requested));
  const file = candidate.startsWith(publicDir) && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(publicDir, 'index.html');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
  response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
  createReadStream(file).pipe(response);
}
