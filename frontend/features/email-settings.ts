import { api } from '../core/api.ts';
import { pageRequest } from '../core/pagination.ts';
import { apiColumnFilters } from '../core/table-filters.ts';
import { button, esc, field, input, link, message, select, statusTag, title } from '../ui/components.ts';
import { close, modal } from '../ui/dialog.ts';
import { heading } from '../ui/layout.ts';
import { detailFields, note, panel, table, tabs } from '../ui/widgets.ts';

const path = 'email-settings';
const endpoint = '/admin/email';
const pageKey = 'email-jobs';
const filterKeys = ['q', 'status', 'kind', 'start', 'end'];
const transport = [{id:'STARTTLS', name:'STARTTLS'}, {id:'TLS', name:'Implicit TLS'}, {id:'PLAIN', name:'Plain relay'}];
const kinds = [{id:'EVENT', name:'Workflow notification'}, {id:'DIGEST', name:'Daily approval reminder'}, {id:'TEST', name:'Test email'}];
const statuses = ['PENDING', 'SENDING', 'RETRY', 'SENT', 'FAILED', 'SKIPPED'];
const fmt = new Intl.DateTimeFormat('en-IN', {timeZone:'Asia/Kolkata', dateStyle:'medium', timeStyle:'short', hourCycle:'h23'});
const when = value => value ? fmt.format(new Date(value)) : '—';
const tones = {SENT:'green', FAILED:'red', RETRY:'amber', SENDING:'amber', PENDING:'neutral', SKIPPED:'neutral'};

function configuration(data) {
  const check = (label, name) => `<label class="check-label"><input type="checkbox" name="${name}" ${data[name] ? 'checked' : ''}> ${label}</label>`;
  const text = (label, name, type = 'text', attrs = '', help = '') => field(label, input(name, data[name], type, attrs), help);
  const status = data.ready ? statusTag('Ready to send', 'green') : data.enabled ? statusTag('Configuration incomplete', 'amber') : statusTag('Delivery paused');
  return `<form id="smtp-settings">
    <input type="hidden" name="revision" value="${esc(data.revision)}">
    ${panel('SMTP connection', `<div class="actions">${status}<span class="muted small">${esc(data.source)}</span></div>
      ${data.problem ? note(data.problem, 'warn') : ''}
      <div class="form-grid mt24">
        ${check('Enable email delivery', 'enabled')}
        ${text('SMTP host', 'host', 'text', 'maxlength="253"')}
        ${text('Port', 'port', 'number', 'required min="1" max="65535"')}
        ${field('Transport', select('transport', transport, data.transport, 'name', 'required'), data.custom_ca ? 'Uses the server-managed certificate trust bundle.' : 'TLS verifies the relay certificate and hostname.')}
        ${text('Username', 'username', 'text', 'maxlength="250" autocomplete="off"')}
        ${field('SMTP password', input('password', '', 'password', 'maxlength="1000" autocomplete="new-password"'),
          data.has_password ? 'Leave blank to retain the saved password for this relay and username.' : 'Enter a password if the relay requires authentication.')}
        ${check('Remove saved password', 'clear_password')}
        ${text('Timeout (seconds)', 'timeout_seconds', 'number', 'required min="3" max="30"')}
      </div>`)}
    <div class="mt24">${panel('Sender and approval reminders', `<div class="form-grid">
      ${text('Sender name', 'from_name', 'text', 'maxlength="150"')}
      ${text('Sender email', 'from_address', 'email', 'maxlength="254"')}
      ${text('Portal URL', 'portal_url', 'url', 'maxlength="500" placeholder="https://compliance.example.com:8010"', 'Email links use this address.')}
      ${check('Send a daily My decisions reminder', 'digest_enabled')}
      ${text('Reminder time (IST)', 'digest_time', 'time', 'required')}
    </div>`)}</div>
    <p class="inline-error" id="form-error" role="alert"></p>
    <div class="wizard-footer"><button type="submit" class="btn primary">Save email settings</button></div>
  </form>
  <div class="mt24">${panel('Test email delivery', `<p class="small muted">Send a test through the saved settings and track the relay response in Notification jobs.</p>
    <form id="smtp-test"><div class="form-grid">
      ${field('Recipient email', input('recipient', data.default_recipient || '', 'email', 'required maxlength="254"'))}
    </div><p class="inline-error" data-form-error role="alert"></p>
    <button type="submit" class="btn primary" ${data.test_ready ? '' : 'disabled'}>Send test email</button></form>`)}</div>`;
}

function jobFilters(query) {
  return new URLSearchParams(filterKeys.flatMap(key => query.get(key) ? [[key, query.get(key)]] : []));
}

async function jobsPage(query, config) {
  const filters = jobFilters(query);
  const request = new URLSearchParams(filters);
  apiColumnFilters(request, query, pageKey);
  const optionsUrl = endpoint + '/jobs?' + request;
  const paging = pageRequest(query, pageKey);
  request.set('page', String(paging.page));
  request.set('page_size', String(paging.page_size));
  const result = await api(endpoint + '/jobs?' + request);
  const rows = result.items.map(job => [
    esc(when(job.created_at)), esc(job.type_label), esc(job.event_label), esc(job.recipient || '—'),
    statusTag(title(job.status), tones[job.status]), esc(job.attempts),
    button('email-job-detail', 'Details', `data-id="${esc(job.id)}"`, 'small') + (job.last_error ? `<small>${esc(job.last_error)}</small>` : ''),
  ]);
  return `<div class="audit-metrics" aria-label="Email job totals">${['PENDING','RETRY','SENT','FAILED'].map(key => {
    const filter = new URLSearchParams(filters);
    filter.set('status', key);
    return `<div class="audit-metric panel"><a href="#${path}?tab=jobs&amp;${esc(filter.toString())}"><span>${esc(title(key))}</span><strong>${esc(config.counts[key] || 0)}</strong></a></div>`;
  }).join('')}</div>
  ${config.ready ? '' : note('Email delivery is currently paused or awaiting configuration.')}
  <form id="email-jobs-filters" class="audit-filters panel" aria-label="Notification job filters">
    ${field('Search jobs', input('q', filters.get('q') || '', 'search', 'maxlength="160" placeholder="Recipient, event or job ID"'))}
    ${field('Status', select('status', statuses.map(id => ({id, name:title(id)})), filters.get('status'), 'name', '', 'All statuses'))}
    ${field('Type', select('kind', kinds, filters.get('kind'), 'name', '', 'All types'))}
    ${field('From date', input('start', filters.get('start') || '', 'date'))}
    ${field('To date', input('end', filters.get('end') || '', 'date'))}
    <div class="audit-filter-actions"><button type="submit" class="btn primary">Apply filters</button>${link(path + '?tab=jobs', 'Clear', 'text-link')}</div>
  </form>
  ${panel('Delivery history', table(['Queued (IST)', 'Type', 'Event', 'Recipient', 'Status', 'Attempts', 'Details'], rows, {
    caption:'Notification jobs', pageKey, pagination:result.pagination, columnOptionsUrl:optionsUrl, label:'jobs', empty:'No notification jobs match this view.',
  }), {action:button('reload', 'Refresh'), cls:'table-panel'})}`;
}

export async function emailSettingsPage(_id, query = new URLSearchParams()) {
  const config = await api(endpoint + '/settings');
  const active = query.get('tab') === 'jobs' ? 'jobs' : 'settings';
  return heading('Email notifications', 'Manage SMTP delivery and track workflow emails and daily approval reminders.') +
    tabs([['settings','Email settings'], ['jobs','Notification jobs']], active, path) +
    (active === 'settings' ? configuration(config) : await jobsPage(query, config));
}

export function emailSettingsHandlers({render}) {
  return {
    forms: {
      'smtp-settings': async (form: HTMLFormElement) => {
        const values: Record<string, unknown> = Object.fromEntries(new FormData(form));
        for (const name of ['enabled', 'digest_enabled', 'clear_password']) values[name] = Boolean(values[name]);
        for (const name of ['port', 'timeout_seconds']) values[name] = Number(values[name]);
        await api(endpoint + '/settings', 'PUT', values);
        message('Email settings saved.');
        await render();
      },
      'smtp-test': async (form: HTMLFormElement) => {
        const result = await api(endpoint + '/test', 'POST', Object.fromEntries(new FormData(form)));
        message('Test email queued. Refresh to check delivery.', 'info');
        location.hash = path + '?tab=jobs&q=' + encodeURIComponent(result.id);
      },
      'email-jobs-filters': (form: HTMLFormElement) => {
        const query = new URLSearchParams(location.hash.split('?')[1]);
        const values = new FormData(form);
        for (const key of filterKeys) {
          const value = String(values.get(key) || '').trim();
          if (value) query.set(key, value); else query.delete(key);
        }
        query.delete('page.' + pageKey);
        const next = path + '?' + query.toString();
        if (location.hash === '#' + next) return render();
        location.hash = next;
      },
    },
    actions: {
      'email-job-detail': async ({id}, trigger: HTMLElement) => {
        const job = await api(endpoint + '/jobs/' + encodeURIComponent(id));
        if (!trigger.isConnected) return;
        modal('Email delivery details', detailFields([
          ['Job ID',esc(job.id)], ['Event',esc(job.event_label)], ['Recipient',esc(job.recipient || '—')],
          ['Status',statusTag(title(job.status), tones[job.status])], ['Attempts',esc(job.attempts)],
          ['Queued (IST)',esc(when(job.created_at))], ['Last attempt (IST)',esc(when(job.last_attempt_at))],
          ['Next retry (IST)',esc(when(job.next_attempt_at))], ['Relay accepted (IST)',esc(when(job.sent_at))],
          ['Reason code',esc(job.last_error || '—')],
        ]) + (['FAILED','RETRY'].includes(job.status) ? `<div class="mt24">${button('email-job-retry', 'Queue retry', `data-id="${esc(id)}"`, 'primary')}</div>` : ''));
      },
      'email-job-retry': async ({id}) => {
        await api(endpoint + '/jobs/' + encodeURIComponent(id) + '/retry', 'POST', {});
        close();
        message('Email job queued again.');
        await render();
      },
    },
  };
}
