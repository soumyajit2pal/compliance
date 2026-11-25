import { clauseRelationshipTypes } from '../core/clause-relationships.ts';
import { notificationRelationshipTypes } from '../core/notification-relationships.ts';
import { esc } from './components.ts';

const types = {
  clause: clauseRelationshipTypes,
  notification: notificationRelationshipTypes,
};

function guidance(kind: keyof typeof types, value: string) {
  const relationship = types[kind].find(type => type.id === value);
  return relationship
    ? `${esc(relationship.definition)} <span><strong>Example</strong> ${esc(relationship.example)}</span>`
    : 'Choose a relationship to see what it means and when to use it.';
}

export function relationshipHint(kind: keyof typeof types, id: string, value: string) {
  return `<div class="relationship-guidance" id="${esc(id)}" data-relationship-guidance="${kind}" role="status" aria-atomic="true">${guidance(kind, value)}</div>`;
}

export function updateRelationshipHint(select: HTMLSelectElement) {
  const hint = select.closest('.field')?.querySelector<HTMLElement>('[data-relationship-guidance]');
  const kind = hint?.dataset.relationshipGuidance;
  if (kind === 'clause' || kind === 'notification') {
    hint.innerHTML = guidance(kind, select.value);
  }
}
