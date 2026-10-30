import { esc } from './components.ts';

// Domain setup controls submission readiness, not whether a Draft may be saved.
export function domainReadiness(domain) {
  if (!domain) return null;
  if (!domain.domain_owner_unit_id)
    return {
      ready: false,
      label: 'Draft only',
      reason: 'Owner department not assigned',
      detail:
        'You can save a Draft in this domain. Before you submit for Compliance review, ask an Admin to assign the bank-approved owning department and allow review submissions in Administration → Master data → Regulatory domains → Set owner.',
    };
  if (!domain.active_flag)
    return {
      ready: false,
      label: 'Draft only',
      reason: 'Review submissions not enabled',
      detail:
        'An owning department is assigned. You can save a Draft, but an Admin must allow review submissions in Administration → Master data → Regulatory domains → Set owner before you submit for Compliance review.',
    };
  return {
    ready: true,
    label: 'Ready for review',
    reason: 'Domain setup complete',
    detail:
      'The owning department is assigned and review submissions are enabled. Complete the source, clauses / paras and independent reviewer/approver assignments before submitting. This status does not approve your notification.',
  };
}

export const domainChoices = (rows) =>
  rows.map((domain) => ({ ...domain, option_status: domainReadiness(domain).label }));

export function domainGuidance(domain) {
  const status = domainReadiness(domain);
  if (!status)
    return '<div class="domain-guidance"><strong>Draft or ready for review?</strong><p>Choose a domain to see its setup status. You can save a Draft in any listed domain. Domains marked “Draft only” need Admin setup before review submission.</p></div>';
  return `<div class="domain-guidance ${status.ready ? 'ready' : 'pending'}"><strong>${esc(status.label)} · ${esc(status.reason)}</strong><p>${esc(status.detail)}</p></div>`;
}

export function domainStatus(domain) {
  const status = domainReadiness(domain);
  return `<span class="tag ${status.ready ? 'green' : 'amber'}">${esc(status.label)}</span><small>${esc(status.reason)}</small>`;
}

export function secondaryDomainPicker(rows, selectedIds = [], primaryId = '') {
  const selected = new Set(selectedIds);
  const choices = rows.filter((domain) => domain.id !== primaryId);
  const count = choices.filter((domain) => selected.has(domain.id)).length;
  return `<fieldset class="domain-picker full" data-secondary-domain-picker>
    <legend>Additional affected domains</legend>
    <p id="secondary-domain-help">Select every other subject area this instrument affects. The required primary domain is assigned separately.</p>
    <details>
      <summary><span data-domain-picker-summary>${count ? `${count} additional domain${count === 1 ? '' : 's'} selected` : 'Choose additional domains'}</span></summary>
      <div class="domain-picker-options" role="group" aria-describedby="secondary-domain-help">
        ${choices.map((domain) => `<label><input type="checkbox" name="secondary_domain_ids" value="${esc(domain.id)}" ${selected.has(domain.id) ? 'checked' : ''}> <span>${esc(domain.name)}</span></label>`).join('') || '<p class="small muted">No other domains are available.</p>'}
      </div>
    </details>
  </fieldset>`;
}

export function syncSecondaryDomainPicker(form) {
  const picker = form?.querySelector('[data-secondary-domain-picker]');
  if (!picker) return;
  const primaryId = form.querySelector('[name="primary_domain_id"]')?.value || '';
  let count = 0;
  for (const checkbox of picker.querySelectorAll('input[name="secondary_domain_ids"]')) {
    const isPrimary = checkbox.value === primaryId;
    if (isPrimary) checkbox.checked = false;
    checkbox.disabled = isPrimary;
    checkbox.closest('label').hidden = isPrimary;
    if (checkbox.checked) count += 1;
  }
  const summary = picker.querySelector('[data-domain-picker-summary]');
  if (summary)
    summary.textContent = count
      ? `${count} additional domain${count === 1 ? '' : 's'} selected`
      : 'Choose additional domains';
}
