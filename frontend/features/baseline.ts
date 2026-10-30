import { api } from '../core/api.ts';
import { esc } from '../ui/components.ts';
import { heading } from '../ui/layout.ts';
import { panel, table, tablePanel, tabs, note } from '../ui/widgets.ts';
export async function baselinePage(_id, query = new URLSearchParams()) {
  const data = await api('/baseline'),
    tab = query.get('tab') || 'outcomes';
  let body = '';
  if (tab === 'scope')
    body = `<div class="grid-equal">${panel('Release 1 scope', '<ul class="role-list">' + data.scope.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>')}${panel('Deferred scope', '<ul class="role-list">' + data.deferred.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>')}</div><div class="mt24">${tablePanel(
      table(
        ['Workstream', 'Accountable', 'Responsible', 'Approval'],
        data.raci.map((r) => r.map(esc)),
        { summary: false },
      ),
      'Governance and responsibilities',
    )}</div><div class="mt16">${note(esc(data.cadence))}</div>`;
  else if (tab === 'dependencies')
    body = `<div class="grid-equal">${data.dependencies.map((r) => panel(r.item, `<p class="small">${esc(r.treatment)}</p><div class="mt16"><span class="tag amber">${esc(r.status)}</span><p class="small muted mt8">Owner: ${esc(r.owner)}</p></div>`)).join('')}</div>`;
  else if (tab === 'metrics')
    body = tablePanel(
      table(
        ['Measure', 'Definition / exclusions', 'Owner', 'Drill-down'],
        data.metrics.map((r) => [esc(r.name), esc(r.definition), esc(r.owner), esc(r.destination)]),
      ),
      'Metric catalogue',
    );
  else
    body = `<div class="grid-3">${data.weeks.map((w) => panel('Week ' + w.week + ' · ' + w.outcome, `<p class="small">${esc(w.implemented)}</p><div class="divider"></div><p class="small muted"><strong>Acceptance gate</strong><br>${esc(w.gate)}</p>`)).join('')}</div><div class="mt24">${note('Formal bank acceptance is tracked separately from technical readiness. Sponsor, Compliance, Information Security and content-owner sign-offs remain bank decisions.')}</div>`;
  return (
    heading(
      'Release baseline',
      'Track the agreed scope, responsibilities, acceptance gates and open dependencies.',
    ) +
    tabs(
      [
        ['outcomes', 'Week 1–3 outcomes'],
        ['scope', 'Scope & responsibilities'],
        ['dependencies', 'Open dependencies', data.dependencies.length],
        ['metrics', 'Metric catalogue', data.metrics.length],
      ],
      tab,
      'baseline',
      query,
    ) +
    body
  );
}
