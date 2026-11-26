import { date as bankDate } from '../../core/bank-time.ts';
import { type FormEvent, type ReactNode } from 'react';
import { type PageInfo, withoutPaging } from '../../core/pagination.ts';
import { ownerRoles, ownerResponse, assignmentApproval } from '../../core/obligation-detail.ts';
import { assessmentApproval, applicabilityChoices } from '../../features/applicability-register.ts';
import { workspacePath } from '../../core/obligation-workspace.ts';
import { icon } from '../../ui/icons.ts';
import { PaginatedCollection } from './paginated-collection';
import { SearchableSelectField } from './searchable-select';
import { referenceSelect, validateReferenceSelections } from '../../ui/reference-options.ts';
import { esc } from '../../ui/components.ts';

type View = 'applicability' | 'accountability';
interface Named {id: string; name?: string; full_name?: string; active_flag?: number;}
interface Obligation {id: string; code: string; title: string; version_number: number;}
interface Row {
  id: string; kind: 'ASSESSMENT' | 'ASSIGNMENT' | 'MISSING_ASSESSMENT' | 'MISSING_OWNER';
  retained: boolean;
  org_unit_id?: string; department_name?: string; scope?: Record<string, string>;
  applicability_status?: string; approval_status?: string; basis?: string; conditions?: string;
  assessed_by?: string; assessor_name?: string; assessed_date?: string; next_review_date?: string;
  legal_entity_id?: string; process_id?: string; product_id?: string; channel_id?: string;
  customer_segment_id?: string; geography_id?: string; effective_from?: string; effective_to?: string;
  user_id?: string; owner_name?: string; owner_role?: string; primary_owner_flag?: number;
  validation_decision?: string; validation_task?: {workflow_status?: string; comments?: string};
  ended_by_change_id?: string;
}
interface Group {obligation: Obligation; records: Row[];}
interface Counts {obligations: number; records: number; assessments?: number; unassessed?: number; assignments?: number; missing?: number;}
interface Props {
  view: View; query: string; returnPath: string; masters: Record<string, Named[]>;
  data: {items: Group[]; pagination: PageInfo; summary: Record<string, number>; counts: Counts};
}
const labels = {applicability: 'Applicability', accountability: 'Accountability'};
const date = (value?: string) => bankDate(value, 'Not recorded');
const Badge = ({label, tone = 'neutral'}: {label: string; tone?: string}) => <span className={'tag badge ' + tone}>{label}</span>;
const Fact = ({label, children}: {label: string; children: ReactNode}) => <div><dt>{label}</dt><dd>{children}</dd></div>;

const WorkspaceIcon = ({name, className}: {name: string; className?: string}) =>
  <span className={className} aria-hidden="true" dangerouslySetInnerHTML={{__html: icon(name)}} />;

interface FilterOption {
  name: string;
  label: string;
  values: Named[];
  empty: string;
  source?: string;
}

const assessmentOptions = applicabilityChoices.map(({id, name}) => ({id, name}));
const roleOptions = Object.entries(ownerRoles).map(([id, name]) => ({id, name}));
const approvalOptions = ['DRAFT', 'IN_REVIEW', 'REVIEWED', 'APPROVED', 'REJECTED', 'WITHDRAWN']
  .map(id => ({id, name: assessmentApproval(id).label}));
const responseOptions = [
  {id: 'PENDING', name: 'Awaiting response'},
  {id: 'ACCEPT', name: 'Accepted'},
  {id: 'OBJECT', name: 'Changes requested'},
];

function Filters({view, query, masters}: Pick<Props, 'view' | 'masters'> & {query: URLSearchParams}) {
  const applicability = view === 'applicability';
  const approvalName = applicability ? 'assessment_approval' : 'assignment_approval';
  const assessment = {name: 'assessment', label: 'Applicability decision', values: assessmentOptions, empty: 'All decisions'};
  const role = {name: 'role', label: 'Owner role', values: roleOptions, empty: 'All roles'};
  const response = {name: 'response', label: 'Owner response', values: responseOptions, empty: 'All responses'};
  const entity = {name: 'legal_entity', label: 'Legal entity', values: masters.legal_entity || [], empty: 'All legal entities', source: 'legal_entity'};
  const owner = {name: 'owner', label: 'Named owner', values: masters.user || [], empty: 'All people', source: 'user'};
  const approval = {name: approvalName, label: applicability ? 'Assessment approval' : 'Assignment approval', values: approvalOptions, empty: 'All approval states'};
  const primary: FilterOption[] = [
    {name: 'department', label: 'Department', values: masters.organisational_unit || [], empty: 'All departments', source: 'organisational_unit'},
    ...(applicability ? [assessment] : [role, response]),
  ];
  const related = applicability
    ? [role, response, owner, {...approval, name: 'assignment_approval', label: 'Assignment approval'}]
    : [assessment, entity, {...approval, name: 'assessment_approval', label: 'Assessment approval'}];
  const advanced: FilterOption[] = [
    applicability ? entity : owner,
    approval,
    ...related.filter(filter => query.has(filter.name)).map(filter => ({...filter, label: 'Related ' + filter.label.toLowerCase()})),
  ];
  const gapLabel = applicability ? 'Unassessed departments only' : 'Missing required owners only';
  const mineLabel = applicability ? 'Related owner assignment is mine' : 'Assigned to me';
  const history = query.get('history') === '1';
  const relatedMine = applicability && query.has('mine');
  const advancedCount = advanced.filter(filter => query.get(filter.name)).length
    + Number(history) + Number(relatedMine && query.get('mine') === '1');

  const search = query.get('q') || '';
  const applied = [
    {name: 'q', label: 'Search', value: search},
    ...[...primary, ...advanced].map(filter => {
      const value = query.get(filter.name);
      const choice = filter.values.find(option => option.id === value);
      return {name: filter.name, label: filter.label, value: choice?.name || choice?.full_name || value};
    }),
    {name: 'gap', label: gapLabel, value: query.get('gap') === '1' ? gapLabel : ''},
    {name: 'mine', label: mineLabel, value: query.get('mine') === '1' ? mineLabel : ''},
    {name: 'history', label: 'Retained history', value: history ? 'Retained history' : ''},
  ].filter(filter => filter.value);

  function removeFilter(name: string) {
    const next = withoutPaging(query);
    next.delete(name);
    if (name === approvalName) next.delete('approval');
    return '#' + workspacePath(view, next);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    const next = withoutPaging(query), form = event.currentTarget;
    if (form.dataset.refreshingOptions || !validateReferenceSelections(form)) return;
    for (const [name, value] of new FormData(form)) {
      if (value) next.set(name, String(value));
      else next.delete(name);
    }
    for (const checkbox of form.querySelectorAll<HTMLInputElement>('input[type=checkbox]')) {
      if (!checkbox.checked) next.delete(checkbox.name);
    }
    // Legacy approval links are translated to the visible perspective-specific field.
    next.delete('approval');
    location.hash = workspacePath(view, next);
  }

  const select = ({name, label, values, empty, source}: FilterOption) =>
    <label className="workspace-filter" key={name}>
      <span>{label}</span>
      {source ? <span dangerouslySetInnerHTML={{__html: referenceSelect(name, source, query.get(name) || '', `aria-label="${esc(label)}"`, empty)}} /> :
      <SearchableSelectField name={name} defaultValue={query.get(name) || ''}>
        <option value="">{empty}</option>
        {values.filter(value => value.active_flag !== 0 || value.id === query.get(name)).map(value =>
          <option key={value.id} value={value.id}>{value.name || value.full_name}</option>)}
      </SearchableSelectField>}
    </label>;

  return <form id="view-filter" className="workspace-filters" data-reference-toolbar aria-label={labels[view] + ' filters'} onSubmit={submit}>
    <div className="workspace-filter-body">
      <h2>{applicability ? 'Filter assessments' : 'Filter assignments'}</h2>
      <div className="workspace-filter-main">
        <label className="workspace-filter workspace-search">
          <span>{applicability ? 'Search assessments' : 'Search assignments'}</span>
          <span className="workspace-search-control">
            <WorkspaceIcon name="search" />
            <input type="search" name="q" defaultValue={search} placeholder={applicability ? 'Obligation, reference or assessment' : 'Obligation, reference or person'} />
          </span>
        </label>
        {primary.map(select)}
      </div>
      <details className="workspace-advanced-filters" open={advancedCount > 0 || undefined}>
        <summary>
          <WorkspaceIcon name="filter" />
          <span>More filters</span>
          {advancedCount > 0 && <span className="workspace-advanced-count">{advancedCount} applied</span>}
          <WorkspaceIcon name="down" className="workspace-advanced-chevron" />
        </summary>
        <div className="workspace-filter-more">
          <div className="workspace-advanced-fields">{advanced.map(select)}</div>
          <div className="workspace-advanced-options">
            <label className="check-row">
              <input name="history" type="checkbox" value="1" defaultChecked={history} />
              <span><strong>Include retained history</strong><small>Earlier revisions and withdrawn or rejected records</small></span>
            </label>
            {relatedMine && <label className="check-row">
              <input type="checkbox" name="mine" value="1" defaultChecked={query.get('mine') === '1'} />{mineLabel}
            </label>}
          </div>
        </div>
      </details>
    </div>
    <div className="workspace-filter-footer">
      <div className="workspace-quick-filters">
        <label className="check-row"><input name="gap" type="checkbox" value="1" defaultChecked={query.get('gap') === '1'} />{gapLabel}</label>
        {!applicability && <label className="check-row"><input name="mine" type="checkbox" value="1" defaultChecked={query.get('mine') === '1'} />{mineLabel}</label>}
      </div>
      <div className="workspace-filter-actions">
        <button type="button" className="btn small" data-action="refresh-reference-options">Refresh options</button>
        <a className="btn" href={'#' + workspacePath(view)}>Clear</a>
        <button type="submit" className="btn primary">Apply filters</button>
      </div>
    </div>
    {applied.length > 0 && <ul className="workspace-applied-filters" aria-label="Applied filters">
      {applied.map(({name, label, value}) => <li key={name}>
        <a href={removeFilter(name)} aria-label={'Remove ' + label + (label === value ? '' : ': ' + value)}>
          <span>{label === value ? label : <><strong>{label}</strong> · {value}</>}</span><WorkspaceIcon name="x" />
        </a>
      </li>)}
    </ul>}
  </form>;
}

function Record({row, view, masters}: {row: Row; view: View; masters: Props['masters']}) {
  const reference = (key: string, id?: string, fallback = 'Not recorded') => masters[key]?.find(value => value.id === id)?.name || masters[key]?.find(value => value.id === id)?.full_name || id || fallback;
  const department = row.department_name || reference('organisational_unit', row.org_unit_id, 'Department not specified');
  const gap = row.kind.startsWith('MISSING_');
  const approval = view === 'applicability' ? assessmentApproval(row.approval_status) : assignmentApproval(row.approval_status);
  const response = ownerResponse(row, row.validation_task);
  const decision = row.applicability_status === 'NOT_APPLICABLE' ? row.approval_status === 'APPROVED' ? 'Exclusion approved' : row.approval_status === 'REJECTED' ? 'Exclusion rejected' : row.approval_status === 'WITHDRAWN' ? 'Exclusion withdrawn' : 'Exclusion proposed' : applicabilityChoices.find(value => value.id === row.applicability_status)?.name || 'Not assessed';
  const scope = [['process', 'process_id', 'Process'], ['product', 'product_id', 'Product'], ['channel', 'channel_id', 'Channel'], ['customer_segment', 'customer_segment_id', 'Customer segment'], ['geography', 'geography_id', 'Geography']] as const;
  const work = scope.filter(([, key]) => row[key]).map(([master, key, label]) => label + ': ' + (row.scope?.[master] || reference(master, row[key])));
  return <li className={'workspace-record' + (gap ? ' workspace-gap' : '') + (row.retained ? ' workspace-retained' : '')} data-workspace-row={row.id} data-kind={row.kind}>
    <div className="workspace-department"><span className="workspace-mobile-label">Department</span><strong>{department}</strong>{view === 'applicability' && <small>{row.scope?.legal_entity || reference('legal_entity', row.legal_entity_id, gap ? 'Scope not assessed' : 'Legal entity not recorded')}</small>}{row.retained && <Badge label={row.ended_by_change_id ? 'Previous assignment · replaced' : 'Retained record'} />}</div>
    {view === 'applicability' ? <>
      <div className="workspace-assessment"><span className="workspace-mobile-label">Assessment</span><Badge label={decision} tone={gap || row.applicability_status === 'NOT_APPLICABLE' && row.approval_status !== 'APPROVED' ? 'amber' : row.applicability_status === 'APPLICABLE' ? 'green' : 'neutral'} />
        {gap ? <p>No assessment is recorded for this department. Owner assignment does not establish applicability.</p> : <>
          <p>{work.join(' · ') || 'No additional activity limits recorded.'}</p>
          {row.conditions && <p className="workspace-limit">{row.conditions}</p>}
          <details><summary>Reason & assessment details</summary><dl>
            <Fact label={row.applicability_status === 'NOT_APPLICABLE' ? 'Reason for exclusion' : 'Reason'}>{row.basis || 'Not recorded'}</Fact>
            <Fact label="Assessed by">{row.assessor_name || reference('user', row.assessed_by)}</Fact>
            <Fact label="Assessment date">{date(row.assessed_date)}</Fact><Fact label="Effective period">{date(row.effective_from)} → {row.effective_to ? 'ends before ' + date(row.effective_to) : 'No end date'}</Fact>
            {!row.org_unit_id && <Fact label="Department scope">No department was recorded. This assessment does not automatically cover every department.</Fact>}
          </dl></details>
        </>}
      </div>
      <div className="workspace-state"><span className="workspace-mobile-label">Approval & review</span>{gap ? <span className="workspace-no-decision">Assessment needed</span> : <><Badge {...approval} /><small>Next review: {date(row.next_review_date)}</small></>}</div>
    </> : <>
      <div className="workspace-person"><span className="workspace-mobile-label">Named responsibility</span><strong>{gap ? 'Not assigned' : row.owner_name || reference('user', row.user_id)}</strong><span>{ownerRoles[row.owner_role] || row.owner_role}{row.primary_owner_flag ? ' · Primary' : ''}</span>
        {gap && <p>A named {ownerRoles[row.owner_role]?.toLowerCase() || 'owner'} is required.</p>}
        {!gap && <details><summary>Assignment details</summary><dl><Fact label="Effective period">{date(row.effective_from)} → {row.effective_to ? 'ends before ' + date(row.effective_to) : 'No end date'}</Fact>{row.validation_task?.comments && <Fact label="Response comments">{row.validation_task.comments}</Fact>}</dl></details>}
      </div>
      <div className="workspace-state"><span className="workspace-mobile-label">Response & approval</span>{gap ? <Badge label="Owner required" tone="amber" /> : <><Badge {...response} /><small>Assignment: <Badge {...approval} /></small></>}</div>
    </>}
  </li>;
}

const plural = (count: number, label: string) => `${count} ${label}${count === 1 ? '' : 's'}`;
function recordCounts(view: View, records: Row[]) {
  const saved = records.filter(row => !row.kind.startsWith('MISSING_')).length;
  const gaps = records.length - saved;
  return view === 'applicability' ? `${plural(saved, 'assessment')} · ${plural(gaps, 'unassessed department')}` : `${plural(saved, 'assignment')} · ${plural(gaps, 'missing owner')}`;
}

function ObligationGroup({group, view, returnPath, masters}: {group: Group; view: View; returnPath: string; masters: Props['masters']}) {
  const {obligation, records} = group;
  const path = (tab: string) => '#obligations/' + encodeURIComponent(obligation.id) + '?' + new URLSearchParams({tab, return_to: returnPath});
  const headingId = `workspace-heading-${view}-${obligation.id}`;
  return <article className="workspace-obligation-group" data-workspace-obligation={obligation.id} aria-labelledby={headingId}>
    <header className="workspace-group-heading">
      <div className="workspace-obligation">
        <p className="workspace-group-reference">{obligation.code} <span>Revision {obligation.version_number}</span></p>
        <h3 id={headingId}><a href={path('overview')} data-obligation-preview={obligation.id} aria-haspopup="dialog" aria-expanded="false" aria-controls="obligation-quick-view">{obligation.title}</a></h3>
        <p className="workspace-group-count">{recordCounts(view, records)}</p>
      </div>
      <a className="btn small workspace-open-section" href={path(view === 'applicability' ? 'applicability' : 'owners')}>{view === 'applicability' ? 'Open applicability' : 'Open owners'} <WorkspaceIcon name="arrow" /></a>
    </header>
    <div className="workspace-group-body"><div className="workspace-list-heading" aria-hidden="true"><span>Department</span><span>{view === 'applicability' ? 'Assessment & covered work' : 'Named responsibility'}</span><span>{view === 'applicability' ? 'Approval & review' : 'Response & approval'}</span></div>
      <ul className="workspace-group-rows" aria-label={view === 'applicability' ? 'Department assessments' : 'Owner assignments'}>{records.map(row => <Record key={row.id} row={row} view={view} masters={masters} />)}</ul>
    </div>
  </article>;
}

const workspaceMetrics = {
  applicability: [
    ['assessments', 'Recorded assessments', 'file'],
    ['partial', 'Applies in part', 'layers'],
    ['exclusions', 'Recorded exclusions', 'shield'],
    ['unassessed', 'Unassessed departments', 'alert'],
  ],
  accountability: [
    ['awaiting', 'Awaiting response', 'clock'],
    ['accepted', 'Accepted', 'checkSquare'],
    ['objected', 'Changes requested', 'message'],
    ['missing', 'Missing required owners', 'alert'],
  ],
};

export function ObligationWorkspace({view, data, query: text, returnPath, masters}: Props) {
  const query = new URLSearchParams(text);
  const applicability = view === 'applicability';
  const approvalName = applicability ? 'assessment_approval' : 'assignment_approval';
  if (query.has('approval') && !query.has(approvalName)) query.set(approvalName, query.get('approval'));
  const {counts} = data;
  const resultSummary = [
    plural(counts.obligations, 'obligation'),
    applicability ? plural(counts.assessments ?? 0, 'assessment') : plural(counts.assignments ?? 0, 'assignment'),
    applicability ? plural(counts.unassessed ?? 0, 'unassessed department') : plural(counts.missing ?? 0, 'missing owner'),
  ].join(' · ');
  const groups = data.items.map(group => <ObligationGroup key={group.obligation.id} group={group} view={view} returnPath={returnPath} masters={masters} />);
  const empty = <div className="empty workspace-empty">
    <WorkspaceIcon name="search" />
    <h3>No {applicability ? 'assessments or unassessed departments' : 'assignments or missing owners'} match these filters.</h3>
    <p>Change the filters or clear them to see all authorised records.</p>
    <a href={'#' + workspacePath(view)} className="btn">Clear filters</a>
  </div>;
  return <section className="obligation-focused-workspace" aria-labelledby="obligation-view-heading" data-workspace-view={view}>
    <div className="workspace-summary-heading">
      <h2 id="obligation-view-heading">{applicability ? 'Assessment overview' : 'Assignment overview'}</h2>
      <p>Current records across all matching obligations</p>
    </div>
    <div className="workspace-metrics">
      {workspaceMetrics[view].map(([key, label, glyph]) => {
        const count = data.summary[key] ?? 0;
        return <div key={key} className="workspace-metric" data-workspace-metric={key} data-attention={glyph === 'alert' && count > 0 ? 'true' : undefined}>
          <WorkspaceIcon name={glyph} className="workspace-metric-icon" />
          <div><span>{label}</span><strong>{count}</strong></div>
        </div>;
      })}
    </div>
    <Filters view={view} query={query} masters={masters} />
    <div className="workspace-results-heading">
      <h2>Matching obligations</h2><p>{resultSummary}</p>
    </div>
    <PaginatedCollection pageKey={view} initial={data.pagination} server revision={text} label="obligations" summary items={groups} empty={[empty]} renderItems={items => <div className="workspace-groups">{items}</div>} />
  </section>;
}
