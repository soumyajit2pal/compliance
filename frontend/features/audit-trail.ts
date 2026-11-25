import type { PageCursors } from '../core/pagination.ts';
import { api, downloadProtected } from '../core/api.ts';
import { pageRequest, sizeParam } from '../core/pagination.ts';
import { apiColumnFilters, readColumnFilters, writeColumnFilters } from '../core/table-filters.ts';
import { esc, field, input, select, statusTag, title } from '../ui/components.ts';
import { dashboardInfo } from '../ui/dashboard-info.ts';
import { close, modal } from '../ui/dialog.ts';
import { icon } from '../ui/icons.ts';
import { heading, pageHelp } from '../ui/layout.ts';
import { note, person, table } from '../ui/widgets.ts';

interface AuditChange {
  field: string;
  from: string | null;
  to: string | null;
}

interface AuditEntry {
  id: string;
  when: string;
  actor: string;
  represented: string | null;
  record_type: string;
  record_id: string;
  record_code: string | null;
  record_title: string | null;
  event: string;
  changes: AuditChange[];
  group?: string;
  outcome?: 'Success' | 'Failed' | null;
  client_ip?: string | null;
  actor_username?: string | null;
  request_method?: string | null;
  request_route?: string | null;
  http_status?: number | null;
  department?: string | null;
  stage?: string | null;
  next_stage?: string | null;
  decision?: string;
}

interface AuditDetail extends AuditEntry {
  reason: string | null;
  path: string | null;
  actor_roles?: string[];
  request_id?: string | null;
  duration_ms?: number | null;
  user_agent?: string | null;
  channel?: string | null;
  delegation_id?: string | null;
  settings_changed?: string[];
}

interface AuditPage extends PageCursors {
  items: AuditEntry[];
  types: { id: string; name: string }[];
  summary?: {total: number; authentication: number; access_changes: number; failed: number} | null;
  event_types?: {id: string; name: string}[];
  departments?: {id: string; name: string}[];
  stages?: {id: string; name: string}[];
  decisions?: {id: string; name: string}[];
}

const auditPath = 'audit-trail';
const workflowPath = 'approval-workflow-log';
const commonFilters = ['q', 'audit_record_type', 'from', 'to'];
const auditFilters = [...commonFilters, 'audit_event_type', 'audit_outcome'];
const workflowFilters = [...commonFilters, 'department', 'workflow_stage', 'workflow_decision'];
const numberFormat = new Intl.NumberFormat('en-IN');
const auditMeasures = [
  {key: 'total', label: 'Total events', description: 'All retained events in the selected date range.'},
  {key: 'authentication', label: 'Authentication', event: 'authentication', description: 'Recorded sign-in and sign-out events in the selected date range.'},
  {key: 'access_changes', label: 'Access changes', event: 'access-changes', description: 'Recorded account access and employee profile review events in the selected date range.'},
  {key: 'failed', label: 'Failed events', outcome: 'failed', description: 'Requests that returned an HTTP error and retained failed sign-ins in the selected date range.'},
] as const;
const listTime = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23',
});
const detailTime = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23',
});

function filterParams(query: URLSearchParams, workflow: boolean) {
  const result = new URLSearchParams();
  for (const key of workflow ? workflowFilters : auditFilters) {
    const value = query.get(key)?.trim();
    if (value) result.set(key, value);
  }
  return result;
}

function auditChange(change: AuditChange) {
  const from = change.from ? `<span>${esc(change.from)}</span>${icon('arrow')}<span class="sr-only"> to </span>` : '';
  return `<span class="audit-change">${from}<strong>${esc(change.to ?? 'Cleared')}</strong></span>`;
}

function requestLabel(entry: AuditEntry) {
  return [entry.request_method, entry.request_route].filter(Boolean).join(' ');
}

function entryRow(entry: AuditEntry, workflow: boolean) {
  const change = entry.changes[0];
  const extra = entry.changes.length > 1 ? `<small>+${entry.changes.length - 1} more</small>` : '';
  const when = `<time datetime="${esc(entry.when)}">${esc(listTime.format(new Date(entry.when)))}</time>`;
  const actor = person(entry.actor, [workflow ? null : entry.actor_username,
    entry.represented ? 'On behalf of ' + entry.represented : null].filter(Boolean).join(' · '));
  const record = `<div class="audit-record">${entry.record_code ? `<span class="record-code">${esc(entry.record_code)}</span>` : ''}
    <small>${esc(entry.record_type)}</small>${entry.record_title && entry.record_title !== entry.record_type
      ? `<span class="audit-record-title">${esc(entry.record_title)}</span>` : ''}</div>`;
  const changePreview = change ? `<div class="audit-summary"><small>${esc(change.field)}</small>${auditChange(change)}${extra}</div>` : '';
  const details = `<button type="button" class="btn small" data-action="audit-detail" data-workflow="${Number(workflow)}" data-id="${esc(entry.id)}"
    aria-label="Details for ${esc(entry.event)}${entry.record_code ? ' · ' + esc(entry.record_code) : ''}">${icon('eye')} Details</button>`;
  if (workflow) {
    const stage = entry.stage && entry.next_stage && entry.stage !== entry.next_stage
      ? auditChange({field:'Stage', from:entry.stage, to:entry.next_stage})
      : esc(entry.stage || entry.next_stage || '—');
    return [when, actor, record, esc(entry.department || '—'), stage, esc(entry.event), details];
  }
  const request = requestLabel(entry);
  return [
    when, actor, `<div class="audit-summary"><small>${esc(entry.group)}</small>${esc(entry.event)}</div>`,
    entry.outcome ? statusTag(entry.outcome + (entry.http_status ? ' · ' + entry.http_status : ''), entry.outcome === 'Failed' ? 'red' : 'green') : '—',
    `<div class="audit-target">${request ? `<span class="audit-request">${esc(request)}</span>` : ''}
      ${entry.record_type === 'Portal request' ? '' : record}${changePreview}</div>`,
    entry.client_ip ? `<span class="audit-network">${esc(entry.client_ip)}</span>` : '<span class="muted">—</span>',
    details,
  ];
}

function auditSummary(summary: NonNullable<AuditPage['summary']>, filters: URLSearchParams) {
  return `<section class="audit-metrics" aria-label="Audit event counts">
    ${auditMeasures.map((measure) => {
      const query = new URLSearchParams();
      for (const key of ['from', 'to']) {
        if (filters.has(key)) query.set(key, filters.get(key));
      }
      if ('event' in measure) query.set('audit_event_type', measure.event);
      if ('outcome' in measure) query.set('audit_outcome', measure.outcome);
      return `<div class="audit-metric panel"><a href="#${auditPath}${query.size ? '?' + esc(query.toString()) : ''}">
        <span>${measure.label}</span><strong class="${measure.key === 'failed' && summary.failed ? 'audit-failure-count' : ''}">${numberFormat.format(summary[measure.key])}</strong>
      </a>${dashboardInfo(measure.label, measure.description)}</div>`;
    }).join('')}
  </section>`;
}

export async function auditTrailPage(query: URLSearchParams, workflow = false) {
  const path = workflow ? workflowPath : auditPath;
  const caption = workflow ? 'Approval Workflow Log' : 'Audit Log';
  const filters = filterParams(query, workflow);
  apiColumnFilters(filters, query, path);
  const request = new URLSearchParams(filters);
  request.set('page_size', String(pageRequest(query, path).page_size));
  request.set('through', query.get('through') || 'latest');
  for (const key of ['older', 'newer']) {
    if (query.has(key)) request.set(key, query.get(key));
  }
  const data: AuditPage = await api('/' + path + '?' + request.toString());
  const exportUrl = '/api/' + path + '/export?' + filters.toString();
  const optionQuery = new URLSearchParams(filters);
  optionQuery.set('through', data.through || request.get('through'));
  const columnOptionsUrl = '/' + path + '?' + optionQuery;
  const exportButton = data.items.length ? `<button type="button" class="btn${workflow ? ' primary' : ''}" data-action="audit-export" data-url="${esc(exportUrl)}">${icon('download')} Export CSV</button>` : '';
  const workflowHeader = workflow
    ? pageHelp('Find submissions and decisions',
      'Search by record or actor, or filter by department, stage and decision. Open Details to see the recorded decision and any available reason.',
      'reports-history') + heading(caption, 'Review past submissions and decisions for records you can access.', exportButton)
    : '';
  return `${workflowHeader}<div class="audit-trail${workflow ? ' workflow-log' : ''}">
    ${workflow ? '' : `<header class="audit-heading">
      <div><h1>${caption}</h1><p>Review system access, outcomes, and changes across the portal.</p></div>
      ${exportButton}
    </header>`}
    ${note(workflow ? 'Workflow history is read-only. Open My decisions to act on work assigned to you.' : 'Audit entries are append-only.')}
    ${!workflow && data.summary ? auditSummary(data.summary, filters) : ''}
    <form id="audit-trail-filter" class="audit-filters panel" data-workflow="${Number(workflow)}" aria-label="${caption} filters">
      ${field('Search', input('q', filters.get('q') || '', 'search', 'maxlength="160" placeholder="' + (workflow ? 'Record, actor, stage or decision' : 'Actor, action, request, record or IP') + '"'))}
      ${field('Record type', select('audit_record_type', data.types, filters.get('audit_record_type'), 'name', '', 'All record types'))}
      ${workflow ? field('Department', select('department', data.departments || [], filters.get('department'), 'name', '', 'All')) +
        field('Stage', select('workflow_stage', data.stages || [], filters.get('workflow_stage'), 'name', '', 'All stages')) +
        field('Decision', select('workflow_decision', data.decisions || [], filters.get('workflow_decision'), 'name', '', 'All decisions'))
        : field('Event type', select('audit_event_type', data.event_types || [], filters.get('audit_event_type'), 'name', '', 'All types')) +
        field('Outcome', select('audit_outcome', [{id:'success',name:'Success'},{id:'failed',name:'Failed'}], filters.get('audit_outcome'), 'name', '', 'All outcomes'))}
      ${field('From date', input('from', filters.get('from') || '', 'date'))}
      ${field('To date', input('to', filters.get('to') || '', 'date'))}
      <div class="audit-filter-actions"><button type="submit" class="btn primary">Apply filters</button>
        ${filters.size || query.has('older') || query.has('newer') ? `<a class="text-link" href="#${path}">Clear</a>` : ''}</div>
    </form>
    <section class="panel audit-results" aria-label="${workflow ? 'Workflow entries' : 'Audit entries'}">
      <div class="audit-results-meta">Newest first · Times in IST</div>
      ${table(workflow ? ['When', 'Actor', 'Record', 'Department', 'Stage', 'Decision', 'Details']
        : ['When', 'Actor', 'Event', 'Outcome', 'Access / record', 'Client IP', 'Details'], data.items.map((entry) => entryRow(entry, workflow)), {
        caption, pageKey: path, columnOptionsUrl, label: workflow ? 'workflow entries' : 'audit entries', cursors: {older: data.older, newer: data.newer, through: data.through, total: data.total, end: data.end},
        empty: workflow ? 'No workflow entries match this view.' : 'No audit entries match this view.',
      })}
    </section>
  </div>`;
}

export function auditTrailHandlers() {
  return {
    actions: {
      'audit-export': async ({ url }) => downloadProtected(url),
      'audit-detail': async ({ id, workflow: workflowMarker }, trigger: HTMLElement) => {
        const workflow = workflowMarker === '1';
        const currentHash = location.hash;
        const entry: AuditDetail = await api('/' + (workflow ? workflowPath : auditPath) + '/' + encodeURIComponent(id));
        if (!trigger.isConnected || currentHash !== location.hash) return;
        const facts = [
          ['When', detailTime.format(new Date(entry.when)) + ' IST'],
          ['Actor', entry.actor],
          ...(entry.represented ? [['On behalf of', entry.represented]] : []),
          ['Record type', entry.record_type],
          ...(entry.record_code ? [['Reference', entry.record_code]] : []),
          ...(entry.record_type !== 'Portal request' ? [['Record ID', entry.record_id]] : []),
          ...(entry.id !== entry.request_id ? [[workflow ? 'Workflow event ID' : 'Audit entry ID', entry.id]] : []),
        ];
        if (workflow) {
          if (entry.department) facts.push(['Department', entry.department]);
          if (entry.decision) facts.push(['Decision', entry.decision]);
          if (entry.stage) facts.push(['Stage', entry.stage]);
          if (entry.next_stage && entry.next_stage !== entry.stage) facts.push(['Next stage or result', entry.next_stage]);
        } else if (entry.group) {
          if (entry.actor_username) facts.push(['Username', entry.actor_username]);
          facts.push(['Roles at the time', entry.actor_roles?.map(title).join(', ') || '—'],
            ['Event type', entry.group], ['Outcome / HTTP status', [entry.outcome, entry.http_status].filter(Boolean).join(' · ') || '—'],
            ['Client IP', entry.client_ip || '—'], ['Request', requestLabel(entry) || '—'],
            ['Correlation ID', entry.request_id || '—'], ['User agent', entry.user_agent || '—']);
          if (entry.duration_ms != null) facts.push(['Request duration', numberFormat.format(entry.duration_ms) + ' ms']);
          if (entry.channel) facts.push(['Channel', title(entry.channel)]);
          if (entry.delegation_id) facts.push(['Leave cover reference', entry.delegation_id]);
        }
        const changes = entry.changes.length
          ? `<dl class="audit-detail-changes">${entry.changes.map(change => `<div><dt>${esc(change.field)}</dt><dd>${auditChange(change)}</dd></div>`).join('')}</dl>`
          : '<p class="muted">No before or after values were recorded for this event.</p>';
        modal(workflow ? 'Workflow entry' : 'Audit entry', `<div class="audit-detail">
          <h3>${esc(entry.event)}</h3>
          ${entry.record_title ? `<p class="audit-detail-title">${esc(entry.record_title)}</p>` : ''}
          <dl class="audit-detail-facts">${facts.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
          ${entry.record_type === 'Portal request' ? '' : '<h3>Recorded changes</h3>' + changes}
          ${entry.settings_changed?.length ? `<p class="muted">Updated fields · ${esc(entry.settings_changed.map((key) => ({url:'HTTPS address', active_flag:'Availability'}[key] || title(key))).join(', '))}</p>` : ''}
          ${entry.reason ? `<h3>Recorded reason</h3><p class="audit-reason">${esc(entry.reason)}</p>` : ''}
          ${entry.path ? `<div class="audit-detail-actions"><a href="#${esc(entry.path)}" class="btn" data-action="audit-open-record">Open record ${icon('arrow')}</a></div>` : ''}
        </div>`, '', '', 'Read-only entry', trigger);
      },
      'audit-open-record': () => close(),
    },
    forms: {
      'audit-trail-filter': (form: HTMLFormElement) => {
        const workflow = form.dataset.workflow === '1';
        const filters = filterParams(new URLSearchParams(Array.from(new FormData(form), ([key, value]) => [key, String(value)])), workflow);
        const start = filters.get('from');
        const end = filters.get('to');
        if (start && end && start > end) throw new Error('Choose an end date on or after the start date.');
        const path = workflow ? workflowPath : auditPath;
        const current = new URLSearchParams(location.hash.split('?')[1] || '');
        writeColumnFilters(filters, path, readColumnFilters(current, path));
        if (current.has(sizeParam(path))) filters.set(sizeParam(path), current.get(sizeParam(path)));
        location.hash = path + (filters.size ? '?' + filters.toString() : '');
      },
    },
  };
}
