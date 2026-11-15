const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = path.join(__dirname, '../../frontend/src');
const read = (rel) => fs.readFileSync(path.join(src, rel), 'utf8');
const ui = (name, file) => read(`lib/components/ui/${name}/${file}`);

test('page and state components exist with the standard props', () => {
  for (const [name, exportName] of [
    ['page-header', 'PageHeader'], ['error-panel', 'ErrorPanel'], ['loading-block', 'LoadingBlock'],
    ['empty-state', 'EmptyState'], ['form-field', 'FormField'],
  ]) {
    assert.match(ui(name, 'index.ts'), new RegExp(`as ${exportName}\\b`), `${name} export`);
  }
  assert.match(ui('page-container', 'index.ts'), /PageContainer/);
  assert.match(ui('status-badge', 'index.ts'), /StatusBadge/);

  const header = ui('page-header', 'page-header.svelte');
  assert.match(header, /<h1 class="text-xl[^"]*sm:text-2xl/);
  assert.match(header, /actions/);

  const container = ui('page-container', 'page-container.svelte');
  assert.match(container, /narrow: "max-w-xl"/);
  assert.match(container, /default: "max-w-5xl"/);
  assert.match(container, /wide: "max-w-6xl"/);

  const error = ui('error-panel', 'error-panel.svelte');
  assert.match(error, /role="alert"/);
  assert.match(error, /onRetry/);
  assert.match(error, />다시 시도</);

  assert.match(ui('loading-block', 'loading-block.svelte'), /lines/);
  assert.match(ui('empty-state', 'empty-state.svelte'), /border-dashed/);
  const field = ui('form-field', 'form-field.svelte');
  assert.match(field, /<Label for=\{forId\}>/);
  assert.match(field, /hint/);
  assert.match(field, /error/);
});

test('status badge maps every tone to tokens, never raw palette colours', () => {
  const badge = ui('status-badge', 'status-badge.svelte');
  for (const tone of ['neutral', 'success', 'warning', 'danger', 'info']) assert.match(badge, new RegExp(`\\b${tone}\\b`));
  assert.doesNotMatch(badge, /\b(?:bg|text|border)-(?:red|green|amber|yellow|blue|emerald|sky)-\d/);
  const css = read('app.css');
  const root = css.slice(css.indexOf('\n:root {'), css.indexOf('\n.dark {'));
  const dark = css.slice(css.indexOf('\n.dark {'), css.indexOf('@theme'));
  for (const token of ['--success', '--warning']) {
    assert.ok(root.includes(`${token}:`), `${token} light`);
    assert.ok(dark.includes(`${token}:`), `${token} dark`);
  }
  assert.match(css, /--color-success: var\(--success\)/);
  assert.match(css, /--color-warning: var\(--warning\)/);
});

test('pilot screens use the standard error panel and expose an h1', () => {
  const screens = [
    'routes/app/schedule/+page.svelte',
    'routes/app/p/[pid]/manage/settings/+page.svelte',
    'routes/app/p/[pid]/manage/casting/+page.svelte',
  ];
  for (const screen of screens) {
    const text = read(screen);
    assert.match(text, /\$lib\/components\/ui\/error-panel/, screen);
    assert.match(text, /<ErrorPanel/, screen);
  }
  assert.match(read('routes/app/notifications/+page.svelte'), /<h1[^>]*>알림<\/h1>/);
  assert.match(read('routes/admin/members/[id]/+page.svelte'), /<h1[\s>]/);
});
