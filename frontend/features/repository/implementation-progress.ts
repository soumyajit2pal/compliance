import { state } from '../../core/state.ts';
import { ownerRoles, stageLabel } from '../../core/obligation-detail.ts';
import { instrumentWorkspacePath } from '../../core/source-navigation.ts';
import { date, esc, ref, statusTag, title, versionLabel } from '../../ui/components.ts';
import { modal } from '../../ui/dialog.ts';
import { icon } from '../../ui/icons.ts';
import { canNavigate } from '../../ui/layout.ts';
import { panel, table } from '../../ui/widgets.ts';

const stages = [
  ['editions', 'Registered and approved', 'source editions approved', 'No source editions to approve'],
  ['clauses', 'Clauses interpreted', 'clauses with approved interpretation', 'No clauses in the effective approved edition'],
  ['obligations', 'Obligations active', 'linked obligations active', 'No current linked obligations'],
  ['owners', 'Department delivery', 'owner assignments accepted', 'No current owner assignments'],
  ['applicability', 'Independent decisions', 'applicability decisions approved', 'No current applicability assessments'],
  ['evidence', 'Period evidence', 'evidence items accepted', 'No evidence items for current or past periods'],
] as const;

type Progress = Partial<Record<(typeof stages)[number][0], { completed: number; total: number }>>;
type Stage = (typeof stages)[number][0];
type ProgressRecord = {
  id: string;
  status: string;
  completed: boolean;
  code?: string;
  title?: string;
  heading?: string;
  version_number?: string | number;
  instrument_version_id?: string;
  source_clause_reference?: string;
  effective_from?: string;
  period_from?: string;
  period_to?: string;
  obligation_id?: string;
  org_unit_id?: string;
  legal_entity_id?: string;
  user_id?: string;
  owner_role?: string;
  applicability_status?: string;
  instrument_id?: string;
  description?: string;
  current_due_date?: string;
  owner_unit_id?: string;
  overdue?: boolean;
};
type ProgressData = {
  implementation_progress?: Progress;
  implementation_progress_records?: Partial<Record<Stage, ProgressRecord[]>>;
  instrument?: {id: string};
  members?: Array<{id: string; code: string}>;
  open_actions?: ProgressRecord[];
};

const summaryStages = {
  open_actions: ['Open actions', 'No open actions for current or past periods'],
  overdue_actions: ['Overdue actions', 'No overdue actions for current or past periods'],
  evidence_accepted: ['Evidence accepted', 'No accepted evidence for current or past periods'],
};

function progressDescription(completed: number, total: number, label: string, empty: string) {
  return total > 0 ? `${completed} of ${total} ${label}` : empty;
}

function recordCell(label: string, detail: string, path?: string) {
  const name = path ? `<a href="#${esc(path)}" class="text-link" data-action="close">${esc(label)}</a>` : `<strong>${esc(label)}</strong>`;
  return name + (detail ? `<small>${esc(detail)}</small>` : '');
}

function renderStageRecord(stage: Stage | 'actions', row: ProgressRecord, data: ProgressData,
  obligations: Map<string, ProgressRecord>, members: Map<string, string>) {
  const instrumentId = row.instrument_id || data.instrument?.id;
  const source = members.get(instrumentId);
  const obligation = obligations.get(row.obligation_id);
  const relatedRecord = obligation ? `${obligation.code} · ${obligation.title}` : '';
  const department = row.org_unit_id ? ref('organisational_unit', row.org_unit_id) : '';
  const canOpenObligation = canNavigate('obligations');

  switch (stage) {
    case 'editions':
      return recordCell([source, 'Version ' + versionLabel(row.version_number)].filter(Boolean).join(' · '), 'Effective from ' + date(row.effective_from),
        instrumentWorkspacePath(instrumentId, row.id, new URLSearchParams({tab: 'workflow'})));
    case 'clauses':
      return recordCell(`${row.code} · ${row.heading}`, [source, row.source_clause_reference].filter(Boolean).join(' · '),
        instrumentWorkspacePath(instrumentId, row.instrument_version_id, new URLSearchParams({tab: 'clauses', clause: row.id})));
    case 'obligations':
      return recordCell(`${row.code} · ${row.title}`, 'Revision ' + row.version_number,
        canOpenObligation ? 'obligations/' + row.id : undefined);
    case 'owners': {
      const person = state.masters?.user?.find(user => user.id === row.user_id)?.full_name || 'Assigned owner';
      const role = ownerRoles[row.owner_role] || title(row.owner_role);
      return recordCell(`${person} · ${role}`, [department, relatedRecord].filter(Boolean).join(' · '),
        canOpenObligation ? 'obligations/' + row.obligation_id + '?tab=owners' : undefined);
    }
    case 'applicability': {
      const entity = row.legal_entity_id ? ref('legal_entity', row.legal_entity_id) : '';
      return recordCell(title(row.applicability_status),
        [department, entity, relatedRecord, 'Effective from ' + date(row.effective_from)].filter(Boolean).join(' · '),
        canOpenObligation ? 'obligations/' + row.obligation_id + '?tab=applicability' : undefined);
    }
    case 'evidence':
      return recordCell(`${row.code} · ${row.title}`, `${date(row.period_from)} – ${date(row.period_to)}`,
        canNavigate('evidence') ? 'evidence/' + row.id : undefined);
    case 'actions':
      return recordCell(`${row.code} · ${row.description}`,
        'Due ' + date(row.current_due_date) + ' · ' + ref('organisational_unit', row.owner_unit_id),
        canNavigate('actions') ? 'actions/' + row.id : undefined);
  }
}

export function openImplementationStage({stage}: {stage?: string}, trigger: HTMLElement, data: ProgressData = state.record) {
  const definition = stages.find(([key]) => key === stage);
  const summary = data.members && Object.hasOwn(summaryStages, stage) ? summaryStages[stage] : undefined;
  if (!definition && !summary) return;
  const [key, name, label, empty] = definition ?? [stage === 'evidence_accepted' ? 'evidence' : 'actions', summary[0], '', summary[1]];
  const count = definition ? data.implementation_progress?.[definition[0]] : undefined;
  const records = definition ? data.implementation_progress_records?.[definition[0]]
    : key === 'evidence' ? data.implementation_progress_records?.evidence?.filter(row => row.completed)
    : data.open_actions?.filter(row => stage !== 'overdue_actions' || row.overdue);
  if (!Array.isArray(records) || (definition && !count)) {
    modal(name, '<p>Progress records are unavailable. Refresh the record to try again.</p>', '', '', '', trigger);
    return;
  }
  if (!records.length) {
    modal(name, `<p>${esc(empty)}.</p>`, '', '', '', trigger);
    return;
  }
  const obligations = new Map((data.implementation_progress_records?.obligations || []).map(row => [row.id, row]));
  const members = new Map((data.members || []).map(row => [row.id, row.code]));
  const rows = records.map(row => [
    renderStageRecord(key as Stage | 'actions', row, data, obligations, members),
    statusTag(stageLabel(row.overdue ? 'OVERDUE' : row.status), row.completed ? 'green' : row.overdue || row.status === 'REJECTED' ? 'red' : 'neutral'),
  ]);
  modal(name, table(['Record', 'Status'], rows, {
    caption: name, pageKey: 'implementation-' + key, label: 'records', summary: false, cardLayout: false,
  }), '', '', count ? progressDescription(count.completed, count.total, label, empty) : '', trigger);
}

export function renderImplementationProgress(progress?: Progress, familySummary?: string) {
  const isFamily = familySummary !== undefined;
  const header = isFamily ? 'Implementation across the family' : 'Implementation progress';
  if (!progress) {
    return panel(header, '<p class="muted">Progress is unavailable. Refresh the record to try again.</p>', {
      cls: 'implementation-progress',
    });
  }
  const items = stages.map(([key, name, label, empty], index) => {
    const { completed, total } = progress[key] ?? { completed: 0, total: 0 };
    const status = total > 0 && completed === total ? 'complete' : completed > 0 ? 'underway' : 'pending';
    const description = progressDescription(completed, total, label, empty);
    return `<li class="implementation-stage ${status}">
      <span class="implementation-stage-marker" aria-hidden="true">${status === 'complete' ? icon('check') : index + 1}</span>
      <h3><button type="button" class="implementation-stage-button" data-action="${isFamily ? 'family-progress-stage' : 'implementation-stage'}" data-stage="${key}"
        aria-haspopup="dialog" aria-describedby="implementation-${key}-count">${esc(name)}${icon('arrow')}</button></h3>
      <p id="implementation-${key}-count">${esc(description)}</p>
      <progress aria-label="${esc(name)}" aria-valuetext="${esc(description)}" value="${completed}" max="${total || 1}"></progress>
    </li>`;
  });
  return panel(header, `<ol class="implementation-stages">${items.join('')}</ol>${familySummary ?? ''}`, {
    cls: 'implementation-progress',
    sub: 'Current source and delivery records in your authorised scope.',
  });
}
