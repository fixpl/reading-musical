/* Explicit, additive site setup only. Never run automatically on API startup. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const root = path.resolve(__dirname, '..');
const allowed = new Set(['20261011150000_site_support', '20261012000000_site_initial_policies', '20261012040000_production_lifecycle_inquiry_portal']);
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const allowRemote = args.has('--allow-remote-dev');
for (const arg of args) if (!['--apply', '--allow-remote-dev'].includes(arg)) throw new Error('Unknown setup option');

function configuration() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
  const url = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Only PostgreSQL is supported.');
  const schema = url.searchParams.get('schema') || 'public';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error('Unsupported schema name.');
  const remote = !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (apply && /^(production|prod|staging)$/i.test(process.env.NODE_ENV || '')) throw new Error('This helper is for the approved development DB, not production/staging.');
  if (apply && remote && !allowRemote) throw new Error('Remote DB: inspect site:status, then explicitly choose site:setup:dev for the approved development database.');
  return { schema, remote, host: url.hostname, database: decodeURIComponent(url.pathname.slice(1)) };
}
function cli(task) {
  const entry = path.join(root, 'node_modules/prisma/build/index.js');
  if (!fs.existsSync(entry)) throw new Error('Installed Prisma CLI is missing.');
  console.log(JSON.stringify({ event: 'site_setup_step', task: task.join(' ') }));
  const result = spawnSync(process.execPath, [entry, ...task], { cwd: root, stdio: 'inherit', shell: false, timeout: 120000 });
  if (result.error || result.signal || result.status !== 0) throw new Error(`Prisma ${task.join(' ')} failed; inspect its output. No later step was run.`);
}
function connect() {
  return new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
}
async function inspect(client, config) {
  const table = `"${config.schema}"."_prisma_migrations"`;
  const exists = await client.query('SELECT to_regclass($1) IS NOT NULL AS present', [table]);
  if (!exists.rows[0].present) throw new Error('No Prisma migration history found. Initialize the development database separately; this helper will not run unrelated migrations.');
  const history = await client.query(`SELECT migration_name, finished_at, rolled_back_at FROM ${table}`);
  const failed = history.rows.filter((row) => !row.finished_at && !row.rolled_back_at).map((row) => row.migration_name);
  if (failed.length) throw new Error(`Unresolved migration failure: ${failed.join(', ')}. No automatic reset or resolve is allowed.`);
  const completed = new Set(history.rows.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => row.migration_name));
  const pending = fs.readdirSync(path.join(root, 'prisma/migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, 'prisma/migrations', entry.name, 'migration.sql')))
    .map((entry) => entry.name).filter((name) => !completed.has(name)).sort();
  console.log(JSON.stringify({ event: 'site_database_status', target: { host: config.host, database: config.database, schema: config.schema, remote: config.remote }, pending, applyRequested: apply }));
  return pending;
}
async function verify(client, schema) {
  const expected = {
    legal_documents: ['id', 'kind', 'version', 'body', 'published_at'],
    consent_events: ['user_id', 'document_id', 'granted', 'created_at'],
    faq_categories: ['name', 'order', 'active', 'revision'],
    faq_questions: ['category_id', 'title', 'body', 'active', 'revision'],
    support_tickets: ['guest_key_hash', 'privacy_document_id', 'expires_at', 'revision'],
    users: ['marketing_privacy', 'marketing_email', 'marketing_revision', 'marketing_updated_at'],
    inquiries: ['privacy_document_id', 'privacy_consented_at', 'revision', 'source', 'production_snapshot'],
    inquiry_messages: ['inquiry_id', 'author_kind', 'body', 'public'],
    inquiry_accesses: ['inquiry_id', 'code_hash', 'expires_at', 'attempts', 'session_hash', 'session_expires_at'],
    system_settings: ['key', 'value']
  };
  const columns = await client.query('SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = ANY($2::text[])', [schema, Object.keys(expected)]);
  const present = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = Object.entries(expected).flatMap(([table, names]) => names.map((name) => `${table}.${name}`)).filter((column) => !present.has(column));
  if (missing.length) throw new Error(`Site schema is incomplete: ${missing.join(', ')}`);
  const docs = await client.query(`SELECT kind, count(*)::int AS versions, count(published_at)::int AS published FROM "${schema}"."legal_documents" GROUP BY kind ORDER BY kind`);
  const faq = await client.query(`SELECT (SELECT count(*)::int FROM "${schema}"."faq_categories") AS categories, (SELECT count(*)::int FROM "${schema}"."faq_questions") AS questions`);
  console.log(JSON.stringify({ event: 'site_setup_verified', columnsChecked: present.size, documents: docs.rows, faq: faq.rows[0], note: 'Initial policy texts are drafts; existing documents and consent events are preserved. Publish reviewed documents in admin settings.' }));
}
async function main() {
  const config = configuration();
  let client = connect();
  await client.connect();
  try {
    const pending = await inspect(client, config);
    if (!apply) {
      if (!pending.some((name) => allowed.has(name))) await verify(client, config.schema);
      return;
    }
    const unrelated = pending.filter((name) => !allowed.has(name));
    if (unrelated.length) throw new Error(`Unrelated migrations are pending; stopped before writes: ${unrelated.join(', ')}`);
    await client.end(); client = null;
    cli(['validate']);
    cli(['generate']);
    cli(['migrate', 'deploy']);
    client = connect(); await client.connect();
    await inspect(client, config);
    await verify(client, config.schema);
    console.log('Site setup completed. Restart the existing backend through its normal launcher to use the regenerated Prisma Client.');
  } finally { if (client) await client.end(); }
}
main().catch((error) => {
  // Avoid dumping a connection URL, password, SQL arguments, or query contents.
  const safe = String(error.message || 'Setup failed').replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database URL redacted]');
  console.error(`Site setup stopped: ${safe}`);
  process.exitCode = 1;
});
