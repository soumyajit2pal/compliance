import { assetUrl } from '../core/assets.ts';
import { state } from '../core/state.ts';
import { esc, link, title } from '../ui/components.ts';
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
    'Register a Draft notification, preserve the source file, capture original Clauses / Para and a separate bank interpretation. Add subsequent source/obligation revisions, capture named ownership/applicability and process mappings, stage registers and nominate independent decision makers.',
    'Edit only permitted Draft content. You cannot review or approve your own source. Regulatory and obligation imports load Drafts. Named obligation owners validate assignments after Compliance review.',
  ],
  [
    'BUSINESS_OWNER',
    'Department accountability',
    'Read regulatory sources within your approved organisation scope and understand upcoming responsibilities.',
    'Validate your named obligation ownership/applicability assignments, accept or object with a basis, and follow approved obligations in your scope. Department visibility alone does not create a personal task. Open assigned work in My tasks, record outcomes and period-specific proof, then submit to the independent named reviewer. Request internal target changes with reasons; the original date is retained.',
  ],
  [
    'CONTROL_OWNER',
    'Checks and procedures',
    'Maintain approved checks and procedures, and record which obligations they support in your authorised departments.',
    'Accept or object to your named obligation ownership. Deliver your named period-specific action and proof. Approved mappings link action-period results to proof and independent result review; automatic scheduling and general sample testing remain deferred. This role alone gives no source-approval authority.',
  ],
  [
    'EVIDENCE_OWNER',
    'Supporting proof',
    'Read authorised regulatory sources and understand the evidence responsibilities described in the framework.',
    'Supply original or retained-repository proof for your named action; a separate Compliance reviewer decides its acceptance. An Evidence Owner does not approve source content merely because they supply proof.',
  ],
  [
    'REVIEWER',
    'Independent Compliance review',
    'Open your named review tasks, inspect the source and Clauses / Para, record review, return for correction, reject or delegate to another eligible person. Validate migration content independently of its submitter.',
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
    'Oversight does not replace the named Reviewer or Approver and does not grant every business transaction. Team overview provides scoped current counts, exact records, department/domain breakdowns and matching exports.',
  ],
  [
    'ZONE_VIEWER',
    'Read-only zone visibility',
    'Read permitted sources for the assigned zone and its active, effective descendants.',
    'Read-only access excludes other departments and the parent organisation. You cannot create, change, review or approve records.',
  ],
];
const topics = [
  ['Understand checks, work and evidence','Business roles','actions','An obligation states the requirement. A check describes the bank’s reusable procedure. A work item assigns a person a task and a due date. Evidence records what was done for independent review. Open a work item to see its linked obligation, exact checks and supporting evidence together.'],
  ['Define a check and link its obligations','Authors / Check owners','controls','Open Checks and procedures → New check. Record the objective, procedure, frequency, named owner and evidence type, then obtain independent review and separate approval. Under Obligation links, record which approved requirement the check supports, the department and any limitations.'],
  ['Arrange leave cover','Business roles','delegations','Open Delegation → New delegation. Choose an existing role, department, eligible delegate and 1–90 inclusive calendar days. Four different people act as principal, delegate, reviewer and final approver. After both decisions, the delegate explicitly selects Act on behalf using their own sign-in. The banner shows both names and Stop leave cover. Current access, private files and independent decisions remain enforced. Revoke with a reason when cover should end.'],
  ['Complete assigned work','Business / Check / Evidence owners','tasks','Open My tasks, read the approved requirement, record what was done and add proof. The reporting period and proof standard carry forward. Submit to the independent reviewer; returned work keeps the original proof and prior submissions.'],
  ['Review period-specific proof','Assigned Compliance reviewers','approvals','Open My decisions. Inspect each original proof or repository reference, source, exact period, hash and retention. Accept or reject each proof item, then complete the period or return with reasons. Required retained testing/certification results need separate independent review.'],
  ['Check team pendency','Department leads / CCO / scoped readers','team','Filter current records by domain, department, owner, criticality, status and relevant dates. Select a count to inspect its exact source population, department/domain breakdown and matching export. Completion does not retire the obligation or certify overall compliance.'],
  [
    'Register a new notification',
    'AUTHOR',
    'repository/new',
    'Open Regulatory library → New instrument. Complete Basic information, Classification, Accountability and Source & version. Review the details, then create the Draft.',
  ],
  [
    'Capture original source Clauses / Para',
    'AUTHOR',
    'repository',
    'Open the notification → Clauses / Para → Add clause / para. A clause / para is one numbered part of the source notification; para means paragraph. Keep the regulator’s original wording separate from the bank’s internal interpretation. Parent Clauses / Para must belong to the same source edition.',
  ],
  [
    'Submit for independent review',
    'AUTHOR',
    'repository',
    'Open the source record → Workflow. Next step lists anything blocking submission. When ready, choose Submit for Compliance review, select two different people for review and approval, and send the edition to the reviewer’s My decisions queue.',
  ],
  [
    'Record a review or final decision',
    'REVIEWER · APPROVER',
    'approvals',
    'For source editions, choose Open Compliance review or Open final approval in My decisions. Both open the assigned edition’s Workflow tab at Next step. Check the source and Clauses / Para, then record your review or approval there. Final approval opens after the named reviewer records their review.',
  ],
  [
    'Add a revised source edition',
    'AUTHOR',
    'repository',
    'Open an approved notification → New version. Upload the new source, explain its changes, select the approved edition it supersedes and capture the new version’s Clauses / Para. Earlier sources and decisions remain available.',
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
    'Download the combined Excel template from Import existing regulatory records. Fill Regulatory records and Clauses using Import reference and Parent clause reference. Upload the workbook and matching source files together. Inspect the validation preview, source hashes and row findings. A different Reviewer validates complete groups; the uploading Author loads Drafts. Normal source review and approval still apply. Instrument-only and CSV imports remain supported.',
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
    'Open Organisation hierarchy. Add a unit, select Add child unit to prefill its parent, or Edit the selected unit. Parent choices exclude the unit and its descendants. Record a reason before saving. Moves affect descendant role scope; Home organisation and the approved employee department remain separate.',
  ],
  [
    'Use Standard or LDAP sign-in',
    'ALL ROLES',
    'help',
    'Standard accounts use the portal password. LDAP accounts bind to the bank directory. New Standard accounts must change their temporary password; new directory users confirm their profile and wait for approved access. LDAP authenticates and reads its department code. Every eligible employee sign-in also fetches API employee details. LDAP and API baselines stay separate. Any changed employee field is sent automatically to Users & access → Employee profile changes for independent Admin review and fresh sign-in after approval. If the API fails, use approved employee data with a warning only when LDAP is unchanged and no pending/rejected restriction applies. New staff keep the existing email and Home organisation confirmation.',
  ],
];
export function renderHelp(_id, query = new URLSearchParams()) {
  const tab = query.get('tab') || 'guide',
    q = (query.get('q') || '').toLowerCase();
  let body = '';
  if (tab === 'roles')
    body = `<div class="grid-equal">${ROLE_HELP.filter((r) => [title(r[0]), ...r].join(' ').toLowerCase().includes(q))
      .map(([code, purpose, duties, limits]) =>
        panel(
          title(code) + ' · ' + purpose,
          `<div class="eyebrow mb16">RESPONSIBILITIES</div><p class="small">${esc(duties)}</p><div class="divider"></div><div class="eyebrow mb16">APPROVAL LIMITS</div><p class="small">${esc(limits)}</p>`,
          { cls: state.identity.roles.includes(code) ? 'current-role-card' : '' },
        ),
      )
      .join(
        '',
      )}</div><div class="mt24">${note('Home department, role scope and personal task assignment are separate mappings. Global technical administration does not grant global business approval.')}</div>`;
  else if (tab === 'release')
    body = `<div class="grid-equal">${panel('Available now', '<p>Weeks 1–5 cover scoped Standard/LDAP sign-in, masters, source registration/versioning, Clauses / Para, obligations, ownership acceptance, applicability, independent review/approval, history, exceptions and Draft-only imports.</p>')}${panel('Operational work', '<p>My tasks contains your named assignments and decisions. Follow each action through outcome, proof and independent review. Open Team overview from Home for scoped counts and exact records. Source and obligation governance stays under Regulations. Checks and procedures contains obligation links; Work and evidence includes Compliance work tracker, Evidence and Delegation. Manual mapped results are implemented; automatic execution scheduling and broader assurance redevelopment remain deferred. Required retained bank-process results still gate task completion.</p>')}</div><div class="mt24">${link('baseline', 'Open release baseline', 'btn')}</div>`;
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
  return `<div class="runtime-help">${heading('Help & workflow guide', 'Role-specific steps, expected outcomes and approval rules.', '<button type="button" class="btn" data-action="print-guide">' + icon('file') + 'Print guide</button>')}<div class="guide-downloads"><a class="btn primary" href="${assetUrl('guides/week-1-3-navigation.html')}" target="_blank" rel="noopener">Read source / sign-in reference (Weeks 1–3)</a><a class="btn" href="${assetUrl('guides/week-1-3-navigation.html')}" download>Download source reference (HTML)</a></div>${tabs(
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
