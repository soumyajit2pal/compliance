import { assetUrl } from '../core/assets.ts';
import { state } from '../core/state.ts';
import { esc, link } from '../ui/components.ts';
import { icon } from '../ui/icons.ts';
import { heading, canNavigate } from '../ui/layout.ts';
import { panel, tabs, note, searchForm } from '../ui/widgets.ts';
export const ROLE_HELP = [
  [
    'ADMIN',
    'System administration',
    'Manage Standard/LDAP accounts, approved role assignments, department scope, domain ownership, directory configuration and retained application links.',
    'Admin alone cannot register, review or approve business content. Your own access and the last active Admin are protected.',
  ],
  [
    'AUTHOR',
    'Regulatory source preparation',
    'Register a Draft notification, preserve the source file, capture original clauses / paras and a separate bank interpretation. Add subsequent source versions, stage registers and nominate eligible independent decision makers.',
    'Edit only permitted Draft content. You cannot review or approve your own source. Migration loading creates Drafts, not approved records.',
  ],
  [
    'BUSINESS_OWNER',
    'Department accountability',
    'Read regulatory sources within your approved organisation scope and understand upcoming responsibilities.',
    'Business-owner validation and obligation/action transactions belong to later implementation stages. Department visibility does not create a personal task.',
  ],
  [
    'CONTROL_OWNER',
    'Controls and procedures',
    'Read authorised sources and understand the requirements that future checks and procedures will address.',
    'Control definition, mappings and executions are outside the implemented Week 1–3 transaction scope. This role alone gives no source-approval authority.',
  ],
  [
    'EVIDENCE_OWNER',
    'Supporting proof',
    'Read authorised regulatory sources and understand the evidence responsibilities described in the framework.',
    'Evidence submission/review follows in a later stage. An Evidence Owner does not approve source content merely because they supply proof.',
  ],
  [
    'REVIEWER',
    'Independent Compliance review',
    'Open your named review tasks, inspect the source and clauses / paras, record review, return for correction, reject or delegate to another eligible person. Validate migration content independently of its submitter.',
    'Never review your own source. You cannot give its final approval after performing its review. Only the assigned stage is actionable.',
  ],
  [
    'APPROVER',
    'Final approval',
    'Open your named final-decision tasks after review by a different person. Approve, return, reject or delegate, and make an approved effective edition current when eligible.',
    'Maker, Compliance reviewer and final approver must be different people. Approval is unavailable before the required review and does not assert implementation or assurance.',
  ],
  [
    'CCO',
    'Compliance oversight',
    'Read the authorised regulatory population, source versions and governed review history. Follow ownership and escalation responsibilities described in the baseline.',
    'Oversight does not replace the named Reviewer or Approver and does not grant every business transaction. Full CCO dashboards follow later.',
  ],
  [
    'ZONE_VIEWER',
    'Read-only zone visibility',
    'Read permitted sources for the assigned zone and its active, effective descendants.',
    'Read-only access excludes other departments and the parent organisation. You cannot create, change, review or approve records.',
  ],
];
const topics = [
  [
    'Register a new notification',
    'AUTHOR',
    'repository/new',
    'Open Regulatory library → New instrument. Complete Basic information, Classification, Accountability and Source & version. Review the details, then create the Draft.',
  ],
  [
    'Capture original source clauses / paras',
    'AUTHOR',
    'repository',
    'Open the notification → Clauses / Paras → Add clause / para. A clause / para is one numbered part of the source notification; para means paragraph. Keep the regulator’s original wording separate from the bank’s internal interpretation. Parent clauses / paras must belong to the same source edition.',
  ],
  [
    'Submit for independent review',
    'AUTHOR',
    'repository',
    'Open the source record → Workflow → Submit for Compliance review. Select an eligible Reviewer and a different Approver. A preserved source, at least one clause / para and a domain marked Ready for review are required. Draft-only domains need Admin setup first.',
  ],
  [
    'Record a review or final decision',
    'REVIEWER · APPROVER',
    'approvals',
    'Open My decisions → Open decision. Read the source and clauses / paras, then use the Workflow tab to record your assigned decision. The next stage opens only after the required independent review.',
  ],
  [
    'Add a revised source edition',
    'AUTHOR',
    'repository',
    'Open an approved notification → New version. Upload the new source, explain its changes, select the approved edition it supersedes and capture the new version’s clauses / paras. Earlier sources and decisions remain available.',
  ],
  [
    'Correct approved register metadata',
    'AUTHOR · REVIEWER · APPROVER',
    'repository',
    'For an approved instrument, use Request metadata correction for register errors such as its title, official reference, materiality, applicability date, owner, keywords or additional domains. Give a reason and assign a different Compliance reviewer and final approver. Changes take effect only after approval and remain in History. Regulator, instrument type and primary domain define the permanent ID; issue/effective dates and source content belong in a new source version. Confidentiality changes require administrator handling.',
  ],
  [
    'Why is a domain marked Draft only?',
    'AUTHOR · ADMIN',
    'repository/new',
    'You can save a Draft in this domain. The message below the domain shows whether an owning department is missing or review submissions are not enabled. An Admin completes this setup in Administration → Master data → Regulatory domains → Set owner. Ready for review means domain setup is complete; each notification still needs its own review and approval.',
  ],
  [
    'Profile a source register',
    'AUTHOR · REVIEWER',
    'migration',
    'Open Import existing regulatory records → Download Excel template. Read How to fill and Example, then fill Regulatory records using the screen field names and choices. Upload your source document and copy its Source document ID. Use Import source to upload the completed workbook. Example and guidance sheets are excluded. Inspect Source profile, correct errors, obtain independent content validation and load eligible rows as Drafts.',
  ],
  [
    'Maintain people and access',
    'ADMIN',
    'users',
    'Open Administration → Users & access. Add a user or edit an existing account. Set the home organisation and each role’s separate global or organisational scope. Saving access revokes existing sessions.',
  ],
  [
    'Maintain master data',
    'ADMIN',
    'masters',
    'Open Administration → Master data. Add a record or choose Edit, enter the fields and a reason, then save. Codes remain permanent. Set owner configures the bank-approved department and review readiness for a regulatory domain; a seeded department is not an owner nomination.',
  ],
  [
    'Maintain the organisation tree',
    'ADMIN',
    'masters?tab=organisation',
    'Open Organisation hierarchy. Add a unit, select Add child unit to prefill its parent, or Edit the selected unit. Parent choices exclude the unit and its descendants. Record a reason before saving. Moves affect descendant role scope; Home organisation and LDAP department identity remain separate.',
  ],
  [
    'Use Standard or LDAP sign-in',
    'ALL ROLES',
    'help',
    'Standard accounts use the portal password. LDAP accounts bind to the bank directory. New Standard accounts must change their temporary password; new directory users confirm their profile and wait for approved access.',
  ],
];
export function renderHelp(_id, query = new URLSearchParams()) {
  const tab = query.get('tab') || 'guide',
    q = (query.get('q') || '').toLowerCase();
  let body = '';
  if (tab === 'roles')
    body = `<div class="grid-equal">${ROLE_HELP.filter((r) => r.join(' ').toLowerCase().includes(q))
      .map(([code, purpose, duties, limits]) =>
        panel(
          code + ' · ' + purpose,
          `<div class="eyebrow mb16">RESPONSIBILITIES</div><p class="small">${esc(duties)}</p><div class="divider"></div><div class="eyebrow mb16">APPROVAL LIMITS</div><p class="small">${esc(limits)}</p>`,
          { cls: state.identity.roles.includes(code) ? 'current-role-card' : '' },
        ),
      )
      .join(
        '',
      )}</div><div class="mt24">${note('Home department, role scope and personal task assignment are separate mappings. Global technical administration does not grant global business approval.')}</div>`;
  else if (tab === 'release')
    body = `<div class="grid-equal">${panel('Available now', '<p>Weeks 1–3 cover scoped Standard/LDAP sign-in, reference data, source registration and versioning, clauses / paras, named independent review/approval, history and migration profiling.</p>')}${panel('Upcoming workflows', '<p>Obligation/applicability/ownership transactions follow in Week 4. Actions, evidence, reminders and full dashboards follow in Week 5. Control execution and assurance extensions remain deferred.</p>')}</div><div class="mt24">${link('baseline', 'Open release baseline', 'btn')}</div>`;
  else
    body = `<div class="grid-equal">${topics
      .filter((r) => r.join(' ').toLowerCase().includes(q))
      .map(([name, role, path, text]) =>
        panel(
          name,
          `<div class="eyebrow mb16">${esc(role)}</div><p class="small">${esc(text)}</p>${canNavigate(path.split(/[/?]/)[0]) ? `<div class="mt16">${link(path, 'Open workspace →', 'text-link')}</div>` : ''}`,
          { cls: 'help-topic' },
        ),
      )
      .join('')}</div>`;
  return `<div class="runtime-help">${heading('Help & workflow guide', 'Role-specific steps, expected outcomes and approval controls.', '<button type="button" class="btn" data-action="print-guide">' + icon('file') + 'Print guide</button>')}<div class="guide-downloads"><a class="btn primary" href="${assetUrl('guides/week-1-3-navigation.html')}" target="_blank" rel="noopener">Read full navigation guide</a><a class="btn" href="${assetUrl('guides/week-1-3-navigation.html')}" download>Download guide (HTML)</a></div>${tabs(
    [
      ['guide', 'Step-by-step help'],
      ['roles', 'Roles & responsibilities', ROLE_HELP.length],
      ['release', 'Release scope'],
    ],
    tab,
    'help',
    query,
  )}${searchForm('view-filter', 'Search a workflow, role or source…', query.get('q') || '', `<input type="hidden" name="tab" value="${esc(tab)}">`)}${body}</div>`;
}
