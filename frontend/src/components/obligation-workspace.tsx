import { type FormEvent, type ReactNode } from 'react';
import { type PageInfo, withoutPaging } from '../../core/pagination.ts';
import { ownerRoles, ownerResponse, assignmentApproval } from '../../core/obligation-detail.ts';
import { assessmentApproval, applicabilityChoices } from '../../features/applicability-register.ts';
import { workspacePath } from '../../core/obligation-workspace.ts';
import { PaginatedCollection } from './paginated-collection';
import { SearchableSelectField } from './searchable-select';

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
const date = (value?: string) => value ? new Date(value.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'}) : 'Not recorded';
const Badge = ({label, tone = 'neutral'}: {label: string; tone?: string}) => <span className={'tag badge ' + tone}>{label}</span>;
const Fact = ({label, children}: {label: string; children: ReactNode}) => <div><dt>{label}</dt><dd>{children}</dd></div>;

function Filters({view, query, masters}: Pick<Props, 'view' | 'masters'> & {query: URLSearchParams}) {
  const select = (name: string, label: string, values: Named[], empty: string) => <label className="workspace-filter"><span>{label}</span><SearchableSelectField name={name} defaultValue={query.get(name) || ''}>
    <option value="">{empty}</option>{values.filter(value => value.active_flag !== 0 || value.id === query.get(name)).map(value => <option key={value.id} value={value.id}>{value.name || value.full_name}</option>)}
  </SearchableSelectField></label>;
  const approvals = ['DRAFT', 'IN_REVIEW', 'REVIEWED', 'APPROVED', 'REJECTED', 'WITHDRAWN'].map(id => ({id, name: assessmentApproval(id).label}));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); event.stopPropagation();
    const next = withoutPaging(query), form = event.currentTarget;
    for (const [name, value] of new FormData(form)) {if (value) next.set(name, String(value)); else next.delete(name);}
    for (const checkbox of form.querySelectorAll<HTMLInputElement>('input[type=checkbox]')) if (!checkbox.checked) next.delete(checkbox.name);
    // Legacy approval links are translated to the visible perspective-specific field.
    next.delete('approval');
    location.hash = workspacePath(view, next);
  };
  const approvalName = view === 'applicability' ? 'assessment_approval' : 'assignment_approval';
  const related = view === 'applicability' ? ['role','response','owner','assignment_approval','mine'] : ['assessment','legal_entity','assessment_approval'];
  const advanced = ['legal_entity', 'owner', approvalName, 'approval', 'history', ...related].some(key => query.get(key));
  return <form id="view-filter" className="workspace-filters" aria-label={labels[view] + ' filters'} onSubmit={submit}>
    <div className="workspace-filter-main">
      <label className="workspace-filter workspace-search"><span>Search</span><input type="search" name="q" defaultValue={query.get('q') || ''} placeholder={view === 'applicability' ? 'Obligation, reference or assessment' : 'Obligation, reference or person'} /></label>
      {select('department', 'Department', masters.organisational_unit || [], 'All departments')}
      {view === 'applicability' ? select('assessment', 'Applicability decision', applicabilityChoices.map(row => ({id: row.id, name: row.name})), 'All decisions') : <>
        {select('role', 'Owner role', Object.entries(ownerRoles).map(([id, name]) => ({id, name})), 'All roles')}
        {select('response', 'Owner response', [{id: 'PENDING', name: 'Awaiting response'}, {id: 'ACCEPT', name: 'Accepted'}, {id: 'OBJECT', name: 'Changes requested'}], 'All responses')}
      </>}
      <div className="workspace-filter-actions"><button type="submit" className="btn primary">Apply</button><a className="btn" href={'#' + workspacePath(view)}>Clear</a></div>
    </div>
    <div className="workspace-filter-secondary">
      <label className="check-row"><input name="gap" type="checkbox" value="1" defaultChecked={query.get('gap') === '1'} />{view === 'applicability' ? 'Unassessed departments only' : 'Missing required owners only'}</label>
      {view === 'accountability' && <label className="check-row"><input name="mine" type="checkbox" value="1" defaultChecked={query.get('mine') === '1'} />Assigned to me</label>}
      <details open={advanced || undefined}><summary>More filters</summary><div className="workspace-filter-more">
        {view === 'applicability' ? select('legal_entity', 'Legal entity', masters.legal_entity || [], 'All legal entities') : select('owner', 'Named owner', masters.user || [], 'All people')}
        {select(approvalName, view === 'applicability' ? 'Assessment approval' : 'Assignment approval', approvals, 'All approval states')}
        {view === 'accountability' && query.get('assessment') && select('assessment', 'Related department assessment', applicabilityChoices.map(row => ({id: row.id, name: row.name})), 'All decisions')}
        {view === 'accountability' && query.get('legal_entity') && select('legal_entity', 'Related assessment legal entity', masters.legal_entity || [], 'All legal entities')}
        {view === 'accountability' && query.get('assessment_approval') && select('assessment_approval', 'Related assessment approval', approvals, 'All approval states')}
        {view === 'applicability' && query.get('role') && select('role', 'Related owner role', Object.entries(ownerRoles).map(([id, name]) => ({id, name})), 'All roles')}
        {view === 'applicability' && query.get('response') && select('response', 'Related owner response', [{id: 'PENDING', name: 'Awaiting response'}, {id: 'ACCEPT', name: 'Accepted'}, {id: 'OBJECT', name: 'Changes requested'}], 'All responses')}
        {view === 'applicability' && query.get('owner') && select('owner', 'Related named owner', masters.user || [], 'All people')}
        {view === 'applicability' && query.get('assignment_approval') && select('assignment_approval', 'Related assignment approval', approvals, 'All approval states')}
        {view === 'applicability' && query.get('mine') && <label className="check-row"><input type="checkbox" name="mine" value="1" defaultChecked={query.get('mine') === '1'} />Related owner assignment is mine</label>}
        <label className="check-row"><input name="history" type="checkbox" value="1" defaultChecked={query.get('history') === '1'} />Include earlier revisions and withdrawn or rejected records</label>
      </div></details>
    </div>
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
      <div className="workspace-obligation"><h3 id={headingId}><a href={path('overview')} data-obligation-preview={obligation.id} aria-haspopup="dialog" aria-expanded="false" aria-controls="obligation-quick-view">{obligation.title}</a></h3>
        <small className="workspace-group-reference">{obligation.code} · Revision {obligation.version_number}</small>
        <p className="workspace-group-count">{recordCounts(view, records)}</p>
      </div>
      <a className="btn small workspace-open-section" href={path(view === 'applicability' ? 'applicability' : 'owners')}>{view === 'applicability' ? 'Open applicability' : 'Open owners'}</a>
    </header>
    <div className="workspace-group-body"><div className="workspace-list-heading" aria-hidden="true"><span>Department</span><span>{view === 'applicability' ? 'Assessment & covered work' : 'Named responsibility'}</span><span>{view === 'applicability' ? 'Approval & review' : 'Response & approval'}</span></div>
      <ul className="workspace-group-rows" aria-label={view === 'applicability' ? 'Department assessments' : 'Owner assignments'}>{records.map(row => <Record key={row.id} row={row} view={view} masters={masters} />)}</ul>
    </div>
  </article>;
}

export function ObligationWorkspace({view, data, query: text, returnPath, masters}: Props) {
  const query = new URLSearchParams(text);
  if (query.has('approval') && !query.has(view === 'applicability' ? 'assessment_approval' : 'assignment_approval')) query.set(view === 'applicability' ? 'assessment_approval' : 'assignment_approval', query.get('approval'));
  const metrics = view === 'applicability' ? [['assessments', 'Recorded assessments'], ['partial', 'Applies in part'], ['exclusions', 'Recorded exclusions'], ['unassessed', 'Unassessed departments']] : [['awaiting', 'Awaiting response'], ['accepted', 'Accepted'], ['objected', 'Changes requested'], ['missing', 'Missing required owners']];
  const groups = data.items.map(group => <ObligationGroup key={group.obligation.id} group={group} view={view} returnPath={returnPath} masters={masters} />);
  const empty = <div className="empty"><h3>No {view === 'applicability' ? 'assessments or unassessed departments' : 'assignments or missing owners'} match these filters.</h3><p>Change the filters or clear them to see all authorised records.</p><a href={'#' + workspacePath(view)} className="btn">Clear filters</a></div>;
  return <section className="obligation-focused-workspace" aria-labelledby="obligation-view-heading" data-workspace-view={view}>
    <div className="workspace-intro"><h2 id="obligation-view-heading">{labels[view]}</h2><p>{view === 'applicability' ? 'Review which departments and activities each requirement covers, including exclusions and unassessed departments.' : 'Review named responsibilities, owner responses and missing required owners. Acceptance and assignment approval are separate decisions.'}</p></div>
    <p className="workspace-count-note">All matching records · current {view === 'applicability' ? 'assessments and unassessed departments' : 'assignments and missing required owners'}</p>
    <div className="workspace-metrics">{metrics.map(([key, label]) => <div key={key} className="workspace-metric" data-workspace-metric={key}><span>{label}</span><strong>{data.summary[key] ?? 0}</strong></div>)}</div>
    <Filters view={view} query={query} masters={masters} />
    <div className="workspace-results-heading"><h3>{plural(data.counts.obligations, 'obligation')} · {view === 'applicability' ? `${plural(data.counts.assessments, 'assessment')} · ${plural(data.counts.unassessed, 'unassessed department')}` : `${plural(data.counts.assignments, 'assignment')} · ${plural(data.counts.missing, 'missing owner')}`}</h3><p>All matching records stay with their obligation.</p></div>
    <PaginatedCollection pageKey={view} initial={data.pagination} server revision={text} label="obligations" summary items={groups} empty={[empty]} renderItems={items => <div className="workspace-groups">{items}</div>} />
  </section>;
}
