const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lib = path.join(__dirname, '../../frontend/src/lib/components');
const read = (file) => fs.readFileSync(path.join(lib, file), 'utf8');

test('confirm dialog keeps the boolean ask API and adds the reason option', () => {
  const dialog = read('ui/confirm-dialog/confirm-dialog.svelte');
  assert.match(dialog, /export function ask\(message: string, heading\?: string, acceptLabel\?: string\): Promise<boolean>/);
  assert.match(dialog, /export function ask\(options: ConfirmOptions\): Promise<ConfirmResult>/);
  assert.match(dialog, /Textarea/);
  assert.match(dialog, /reasonOptions\?\.required/);
  assert.match(dialog, /data-confirm-action/);
  const index = read('ui/confirm-dialog/index.ts');
  for (const name of ['ConfirmDialog', 'ConfirmOptions', 'ConfirmResult', 'ConfirmReasonOptions', 'ConfirmAsk']) assert.match(index, new RegExp(name));
  assert.match(index, /reason\?: ConfirmReasonOptions/);
  assert.match(index, /destructive\?: boolean/);
});
test('admin ConfirmAction is a thin wrapper over the shared dialog', () => {
  const wrapper = read('admin/ConfirmAction.svelte');
  assert.match(wrapper, /\$lib\/components\/ui\/confirm-dialog/);
  assert.match(wrapper, /export const ask/);
  assert.doesNotMatch(wrapper, /bits-ui/);
});
test('button offers touch sizes without changing the default', () => {
  const button = read('ui/button/button.svelte');
  assert.match(button, /touch: "h-11 [^"]*px-4 text-sm/);
  assert.match(button, /"icon-touch": "size-11"/);
  assert.match(button, /size: "default"/);
  assert.match(button, /icon: "size-8"/);
});
test('checklist asks for reasons with the dialog instead of window.prompt', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../frontend/src/routes/app/p/[pid]/checklist/+page.svelte'), 'utf8');
  assert.doesNotMatch(page, /window\.prompt/);
  assert.equal((page.match(/required: true/g) || []).length, 2);
  assert.match(page, /<ConfirmDialog bind:this=\{confirmation\}/);
});
