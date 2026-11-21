import { esc } from './components.ts';
import { icon } from './icons.ts';

const appearances = {
  REVIEW: ['review', 'checkSquare'],
  APPROVE: ['confirm', 'check'],
  ACCEPT: ['confirm', 'check'],
  COMPLETE: ['confirm', 'check'],
  RETURN: ['return', 'back'],
  OBJECT: ['return', 'message'],
  REJECT: ['reject', 'x'],
  WITHDRAW: ['secondary', 'back'],
  CANCEL: ['reject', 'x'],
  REVOKE: ['reject', 'x'],
  DELEGATE: ['secondary', 'users'],
  OPEN: ['review', 'arrow'],
} as const;

export function workflowSubmit(label: string, choice: string) {
  const [tone, symbol] = appearances[choice as keyof typeof appearances] ?? appearances.REVIEW;
  return { label, className: 'workflow-control workflow-' + tone, icon: symbol };
}

export function workflowButton(action: string, label: string, choice: string, attributes = '') {
  const appearance = workflowSubmit(label, choice);
  return `<button type="button" class="btn ${appearance.className}" data-action="${esc(action)}" ${attributes}>${icon(appearance.icon)}<span>${esc(label)}</span></button>`;
}

export function workflowLink(path: string, label: string) {
  return `<a class="btn workflow-control workflow-review" href="#${esc(path)}">${icon('arrow')}<span>${esc(label)}</span></a>`;
}

export function workflowActionGroup(buttons: string, label = 'Decision required', compact = false) {
  if (!buttons) return '';
  return `<div class="workflow-action-group${compact ? ' workflow-action-group-compact' : ''}" role="group" aria-label="${esc(label)}"><span class="workflow-action-label">${icon('clock')}${esc(label)}</span><div class="workflow-action-buttons">${buttons}</div></div>`;
}
