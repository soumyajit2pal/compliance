import { has } from '../core/access.ts';
import { button, esc } from './components.ts';

export const canExportObligations = () => has('AUTHOR','REVIEWER','APPROVER','CCO');

export function obligationExportButton(identifier = '') {
  return canExportObligations() ? button('obl-export',identifier ? 'Export obligation' : 'Export',identifier ? `data-id="${esc(identifier)}"` : '') : '';
}
