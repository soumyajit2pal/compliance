import test from 'node:test';
import assert from 'node:assert/strict';
import {field, select, input, area} from '../ui/components.ts';

const marker = '<span aria-hidden="true">*</span>';

test('optional filters remain optional when an option says approval required', () => {
  const html = field('Finding', select('exception', [
    {id:'approval', name:'Source approval required'},
  ], '', 'name', '', 'All findings'));
  assert(!html.includes(marker));
  assert(html.includes('Source approval required'));
});

test('wording and similarly named attributes do not make a field required', () => {
  for (const control of [
    input('note', 'Evidence required for review'),
    input('note', '', 'text', 'placeholder="Evidence required > before review" data-required="true"'),
    '<input name="note" title=\'Evidence required before review\' aria-required="false">',
    area('note', 'Evidence required before review'),
  ]) assert(!field('Note', control).includes(marker));
});

test('native required attributes keep the marker on inputs, selects and textareas', () => {
  for (const control of [
    input('name', '', 'text', 'required'),
    select('stage', [], '', 'name', 'required="required"'),
    area('statement', '', 'required'),
    // A boolean HTML attribute is enabled even when its assigned value is false.
    '<input name="name" required="false">',
    '<input name="name" REQUIRED />',
  ]) assert(field('Required field', control).includes(marker));
});
