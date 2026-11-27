import { clauseRelationshipTypes } from '../core/clause-relationships.ts';
import { notificationRelationshipTypes } from '../core/notification-relationships.ts';
import { obligationGroupingGuide } from '../core/obligation-setup.ts';

export type HelpLink = { label: string; path: string; permissions: string[]; role?: string };
type Step = [title: string, description: string];

export interface HelpTopic {
  id: string;
  title: string;
  icon: string;
  summary: string;
  audience: string;
  steps: Step[];
  definitions?: { heading: string; entries: [term: string, definition: string][] };
  outcome: string;
  example?: string;
  keywords?: string;
  links: HelpLink[];
}

export const helpTopics: HelpTopic[] = [
  {
    id: 'getting-started', title: 'Getting started', icon: 'book',
    summary: 'Finish sign-in, check your access and find your first assignment.', audience: 'All portal users',
    steps: [
      ['Finish account setup', 'Standard users change their temporary portal password. LDAP users sign in with their bank directory credentials and complete email and Home organisation confirmation when prompted. Follow the profile screen for any independent Admin review or access approval.'],
      ['Check your assigned roles', 'Open My role in the sidebar or select your name in the header. Check each role and the organisation scope shown beside it. Your Home organisation and each role’s scope are recorded separately.'],
      ['Open your personal queue', 'Use My tasks to find work and owner responses assigned to you. Use My decisions for review and approval assignments. Open the specific record and read its next step.'],
      ['Find and narrow records', 'Search by notification or task reference. In a table, open the filter icon beside a column, search the available values and select those you need. Remove individual values above the table or use Clear all to reset column filters.'],
    ],
    outcome: 'You know which work needs your action and which records you can browse within your scope.',
    keywords: 'first login password ldap pending access department navigation filters chips pagination 25',
    links: [{label: 'My tasks', path: 'tasks', permissions: ['tasks']}, {label: 'My decisions', path: 'approvals', permissions: ['approvals']}],
  },
  {
    id: 'regulatory-sources', title: 'Register and approve a notification', icon: 'file',
    summary: 'Register a source, capture its clauses and follow the independent approval stages.', audience: 'Regulatory Author · Compliance Reviewer · Final Approver',
    steps: [
      ['Register the source', 'In Regulatory library, choose New instrument. Enter its official reference, classification, regulatory owner and interpretation owner. Attach the official source and enter the edition details. Save the Draft.'],
      ['Capture Clauses / Para', 'Open the Draft edition and use Clauses / Para. Preserve the regulator’s text and numbering. Record the bank’s interpretation in its own field. A parent clause belongs to the same edition.'],
      ['Send for Compliance review', 'Open Workflow and check Next step. Add any missing bank interpretations before submitting, or choose Request interpretation exception, enter a reason and confirm it. Assign different people for review and final approval.'],
      ['Record the final decision', 'The Reviewer checks the source and records the review. The named Final Approver then opens the edition from My decisions. An approved effective edition can become current when eligible.'],
      ['Approve a pending interpretation', 'Open the approved clause in Clauses / Para and use Open bank interpretation review. The Author submits the interpretation for a separate Compliance review and final approval on that clause. An obligation citing it can be saved as a Draft and sent for review once its interpretation is approved.'],
      ['Handle a later change', 'Use New version for changed source wording or edition dates. Link a separately issued amendment through Notification families. Use Request metadata correction for eligible approved register fields, such as a title typo or missing keyword.'],
    ],
    outcome: 'The library retains the approved edition, original clauses and decision history. Use Implementation progress to see the records behind each stage count.',
    example: 'If RBI issues a separate amendment, register it with its own official reference and link it to the original notification. Open the family to see the two sources and their implementation together.',
    keywords: 'rbi circular amendment edition freeze original wording maker checker draft only paragraph para family supersede metadata citation',
    links: [
      {label: 'Regulatory library', path: 'repository', permissions: ['repository']},
      {label: 'Notification families', path: 'notification-families', permissions: ['notification-families']},
      {label: 'RBI notification workflow', path: 'tasks?queue=rbi', permissions: ['tasks', 'repository']},
    ],
  },
  {
    id: 'notification-relationships', title: 'Register an amendment or link a notification', icon: 'org',
    summary: 'A notification relationship records how a separately issued notification changes, explains, replaces or withdraws an earlier one. The family groups the linked notifications and preserves each source.',
    audience: 'Regulatory Author · Compliance Reviewer · Final Approver',
    definitions: {
      heading: 'Choose the relationship type',
      entries: notificationRelationshipTypes.map(({name, definition, example}) => [name, `${definition} ${example}`]),
    },
    steps: [
      ['Open the earlier notification', 'In Notification families, select the notification affected by the newer document. Choose Register amendment to create a Draft with its own official reference and source file. If the newer notification is already registered, choose Link existing notification and select it.'],
      ['Record what the newer notification does', 'Choose the relationship supported by the official source. Use the date the change takes effect. In Register amendment, the proposal uses the new notification’s Effective date. In Link existing notification, check Effective from before you submit. In Relationship basis, cite the part of the source that explains the change.'],
      ['Send for independent review', 'Choose a Compliance Reviewer and a different Final Approver. The Reviewer checks the two sources and records the review in My decisions. The named Final Approver then decides on the proposal. Submit any new Draft source edition for its separate review and approval.'],
    ],
    outcome: 'Once the proposal is approved, the notifications appear together in the family. Each keeps its own source editions, implementation records and linked obligations.',
    example: 'If a separately issued amendment changes the reporting deadline in an original direction from 15 to 30 days, open the original and choose Amends for the newer notification. Cite the paragraph that changes the deadline and enter the date it takes effect.',
    keywords: 'register amendment notification family link existing notification amends clarifies supersedes repeals parent original circular effective date',
    links: [
      {label: 'Notification families', path: 'notification-families', permissions: ['notification-families']},
      {label: 'My decisions', path: 'approvals', permissions: ['approvals']},
    ],
  },
  {
    id: 'clause-relationships', title: 'Understand clause relationships', icon: 'link',
    summary: 'A clause relationship records how a paragraph relates to an earlier approved paragraph in the same notification family. The link identifies the exact source editions, so users can trace a change or reference to the right wording.',
    audience: 'Regulatory Author · Compliance Reviewer · Final Approver',
    definitions: {
      heading: 'Choose the relationship type',
      entries: clauseRelationshipTypes.map(({name, definition}) => [name, definition]),
    },
    steps: [
      ['Start from the newer clause', 'Choose Link earlier clause in Clauses / Para or in the Clause / Para relationships register. Select the earlier approved clause from the same notification family and check both edition labels. To add a child within your Draft edition, select its parent in the tree and choose Add child clause.'],
      ['Record the basis and date', 'Select the relationship type, enter Effective from, and use Regulatory relationship basis to explain how the clauses are connected.'],
      ['Send for independent review', 'Choose different people for Compliance review and final approval. The named Reviewer checks both clauses in My decisions. The named Approver acts after the review is recorded.'],
    ],
    outcome: 'After approval, the Clause / Para relationships register shows both clauses, the relationship type, its basis and its effective period. Each clause keeps its original wording and place in its edition.',
    example: 'Suppose paragraph 4 of an RBI amendment changes the reporting deadline in paragraph 12 of the original direction from 15 to 30 days. Link Amendment paragraph 4 → Amends → Original paragraph 12. Enter the date the change takes effect and explain the revised deadline in the basis.',
    keywords: 'clause para relationship paragraph link earlier clause amends supersedes repeals refers to depends on parent hierarchy amendments rbi source edition',
    links: [
      {label: 'Clause / Para relationships', path: 'clause-relationships', permissions: ['clause-relationships']},
      {label: 'My decisions', path: 'approvals', permissions: ['approvals']},
    ],
  },
  {
    id: 'obligations', title: 'Set up obligations and ownership', icon: 'target',
    summary: 'Turn one or more source clauses into a requirement and record where it applies and who owns it.', audience: 'Regulatory Author · Compliance Reviewer · Named owners · Final Approver',
    definitions: obligationGroupingGuide,
    steps: [
      ['Capture the requirement', 'In Obligations, choose Add obligation. Select your source clauses on the Rule step, then describe the duty and set the evidence, frequency and criticality.'],
      ['Decide where it applies', 'Record each affected organisation unit in Applicability. When the requirement applies only to a sub-department, select that unit and keep its parent Department as the accountable business department. Explain partial and non-applicable decisions.'],
      ['Assign the people who will deliver', 'In Accountability, set the named owners required for the obligation. The Business Owner is accountable for delivery. The Check Owner is responsible for the reusable procedure and any assigned check work. The Evidence Owner supplies period-specific proof when assigned.'],
      ['Follow the independent decisions', 'The bank interpretation must be approved on every cited clause before sending the obligation for review. After Compliance review, named owners validate their responsibilities and applicability as prompted. The independent Final Approver records the final decision when those steps are complete.'],
    ],
    outcome: 'An approved, effective obligation can be used to assign work in an approved applicability scope.',
    example: 'A requirement for Payments Operations can apply to that sub-department alone. Keep Operations as the accountable Department and assign an eligible person with Operations scope to work for the Payments Operations scope.',
    keywords: 'group multiple clauses primary supporting citations link earlier clause amends separate obligations department subdepartment check owner control owner responsibility business acceptance impact applicability accountability active',
    links: [
      {label: 'Obligations', path: 'obligations', permissions: ['obligations']},
      {label: 'Applicability', path: 'obligations?view=applicability', permissions: ['obligations', 'applicability']},
      {label: 'Accountability', path: 'obligations?view=accountability', permissions: ['obligations', 'accountability']},
    ],
  },
  {
    id: 'work-evidence', title: 'Deliver work and submit evidence', icon: 'checkSquare',
    summary: 'Connect a reusable check to an obligation, deliver a work item and prove what was done for the period.', audience: 'Business Owner · Check Owner · Evidence Owner · Compliance Reviewer',
    steps: [
      ['Define the recurring check', 'In Checks and procedures, define the objective, procedure, frequency, named owner and evidence type. Send it for review and separate approval. Use Obligation links to record the approved requirement, department coverage and limitations.'],
      ['Assign a work item', 'In Compliance work tracker, start with an approved active obligation. Choose the approved work scope, eligible named owner, reporting period and target date. Select the applicable approved check links.'],
      ['Record the result and add proof', 'Open the assignment in My tasks. Record what was done for the period, add eligible uploaded or retained evidence, and submit for review. The assignment shows its proof standard and any required check results.'],
      ['Review and close or return the work', 'In My decisions, the named reviewer checks each evidence item and any required check results before completing the assignment. If work is returned, read the reason and resubmit the corrected outcome or proof. Earlier submissions stay in history.'],
    ],
    outcome: 'The work item shows its outcome, period evidence and independent decision. Completing one period does not retire the obligation.',
    example: 'For a monthly onboarding review, the check explains how to review the files. The assignment is for one month and one person. The retained review sheet is evidence for that month.',
    keywords: 'upload evidence document proof submit control result pending validation procedure frequency work item action deadline internal target extension',
    links: [
      {label: 'My tasks', path: 'tasks', permissions: ['tasks']},
      {label: 'Compliance work tracker', path: 'actions', permissions: ['actions']},
      {label: 'Checks and procedures', path: 'controls', permissions: ['controls']},
      {label: 'Evidence', path: 'evidence', permissions: ['evidence']},
    ],
  },
  {
    id: 'decisions', title: 'Review, approve, return or reject', icon: 'shield',
    summary: 'Find your decision, understand each choice and see where the record goes next.', audience: 'Named reviewers, approvers and owners',
    steps: [
      ['Open your assigned decision', 'Use My decisions. For a source edition, Open Compliance review or Open final approval takes you to its Workflow tab and Next step. Check the exact revision, evidence and previous decisions before acting.'],
      ['Review or approve', 'Record the Compliance review once the record meets the review requirements. Final Approve records a separate decision after the required reviews and owner responses. Each workflow shows the actions available at your stage.'],
      ['Return for correction', 'Use Return when the author or owner should make changes and resubmit. Write what needs to change and where. The corrected record goes through the required stages again.'],
      ['Reject the submission', 'Use Reject when the proposal should end. Record the reason. Check the record’s history for the outcome and follow the applicable workflow if a new submission is needed.'],
    ],
    outcome: 'The decision and reason are retained on the record. Open Approval Workflow Log to find decisions you are authorised to see.',
    example: 'If a required source page is missing, return the submission and name the missing page. The Author can attach it and resubmit.',
    keywords: 'approve review reject return rejection send back approver reviewer maker checker remarks comment reason missing decision',
    links: [{label: 'My decisions', path: 'approvals', permissions: ['approvals']}, {label: 'Approval Workflow Log', path: 'approval-workflow-log', permissions: ['approval-workflow-log']}],
  },
  {
    id: 'imports', title: 'Import records from Excel', icon: 'upload',
    summary: 'Download current templates, check the preview and correct rows before importing.', audience: 'Regulatory Author · Compliance Reviewer · Admin for organisation units',
    steps: [
      ['Download the latest template before each upload', 'Use Import existing regulatory records for source registers, Import obligations in Obligations, or Upload Excel in Organisation hierarchy. The upload dialog links to the latest template. Check its dropdown choices and reference values, then confirm you used it before uploading. Confirm again when you upload a corrected workbook.'],
      ['Prepare linked records', 'For a source import, fill Regulatory records and Clauses, match their Import reference and use Parent clause reference where applicable. Supply the matching source files. For organisation units, use the parent unit’s code and verify each unit type.'],
      ['Check the preview', 'Read the row findings before confirming. Fix missing or invalid values in Excel and upload again. In the organisation preview, check the parent and child positions before adding the units.'],
      ['Complete the required review', 'For a source import, a different Reviewer validates complete groups and the uploading Author loads the Drafts. Imported source and obligation Drafts follow the normal review and approval workflow.'],
    ],
    outcome: 'The preview identifies records ready to import and rows that need correction. Open the target register to check what was created.',
    keywords: 'spreadsheet xlsx csv bulk upload import template dropdown parent hierarchy failed rows invalid duplicate',
    links: [
      {label: 'Import existing regulatory records', path: 'migration', permissions: ['migration']},
      {label: 'Obligations', path: 'obligations', permissions: ['obligations']},
      {label: 'Organisation hierarchy', path: 'masters?tab=organisation', permissions: ['masters']},
    ],
  },
  {
    id: 'reports-history', title: 'Track progress and find decisions', icon: 'chart',
    summary: 'Find the records behind dashboard counts and choose the right history view.', audience: 'Department leads · CCO · Other scoped users · Admin for full audit',
    steps: [
      ['Choose the dashboard for your purpose', 'Use Operational dashboard for open work, overdue work and pending reviews. Use Department dashboard for obligations, ownership and check coverage. CCO dashboard gives consolidated oversight within the approved scope.'],
      ['Open the records behind a count', 'Set the available filters, hover or focus the info icon for a count’s definition, then open the tile to see matching records. Export the matching list when the view offers an export.'],
      ['Find a workflow decision', 'Open Approval Workflow Log for permitted business decisions, or open a record’s history to see the sequence for that record. Use the search and filters to narrow the log.'],
      ['Inspect system access history', 'Admins use Audit Log for full system activity. Open Details to inspect actor, timestamp and available request information such as client IP.'],
    ],
    outcome: 'You can identify the records behind a count and find who recorded an authorised decision and when.',
    keywords: 'audit log approval workflow log client IP monitoring search dashboard CCO report export due date overdue',
    links: [
      {label: 'Operational dashboard', path: 'team?audience=operational', permissions: ['team']},
      {label: 'CCO dashboard', path: 'team?audience=cco', permissions: ['team'], role: 'CCO'},
      {label: 'Approval Workflow Log', path: 'approval-workflow-log', permissions: ['approval-workflow-log']},
      {label: 'Audit Log', path: 'audit-trail', permissions: ['audit-trail'], role: 'ADMIN'},
    ],
  },
  {
    id: 'leave-cover', title: 'Arrange leave cover', icon: 'arrowRightLeft',
    summary: 'Set up temporary cover, complete the approvals and act on behalf of a colleague.', audience: 'Users with an eligible role and scope',
    steps: [
      ['Request cover', 'In Delegation, choose New delegation. Select the existing role and department, an eligible delegate and an inclusive date range of 1–90 calendar days.'],
      ['Complete independent decisions', 'The principal, delegate, reviewer and final approver must be four different people. The delegate waits for both decisions and the start date.'],
      ['Start or stop acting on behalf', 'The delegate signs in with their own account and selects Act on behalf. The banner shows both people. Use Stop leave cover to return to personal work. Revoke the cover with a reason if it should end early.'],
    ],
    outcome: 'Only eligible assignments are available during the approved period, and decisions retain both names.',
    keywords: 'acting delegation proxy alternate out of office temporary leave assignment',
    links: [{label: 'Delegation', path: 'delegations', permissions: ['delegations']}],
  },
  {
    id: 'administration', title: 'Manage access and portal settings', icon: 'settings',
    summary: 'Set up people, departments, domain ownership and integrations.', audience: 'Admin',
    steps: [
      ['Review a profile or assign access', 'Use Users & access to review pending employee details and manage accounts. Record Home organisation and assign each approved role with its global or organisation scope. Staff sign in again after profile approval or access changes.'],
      ['Maintain departments and reference data', 'Use Organisation hierarchy for parent and child units. Use Master data for reference records. Choose Set owner under Regulatory domains to select the bank-approved owning department and enable submission for Compliance review when ready.'],
      ['Configure integrations', 'Use LDAP settings or Employee profile API to test the respective connection. In Email settings, test SMTP and use Notification jobs to confirm relay acceptance or inspect failed delivery. Manage approved external links in Connected applications.'],
    ],
    outcome: 'Staff can use the approved parts of the portal, and configured domains can accept notifications for review.',
    keywords: 'admin role SSO LDAP TLS smtp jobs notification mail directory profile designation connected applications domain owner draft only',
    links: [
      {label: 'Users & access', path: 'users', permissions: ['users']}, {label: 'Master data', path: 'masters', permissions: ['masters']},
      {label: 'Employee profile API', path: 'employee-api', permissions: ['employee-api']}, {label: 'Email settings', path: 'email-settings', permissions: ['email-settings']},
      {label: 'Upload settings', path: 'upload-settings', permissions: ['upload-settings']},
      {label: 'Connected applications', path: 'applications', permissions: ['applications'], role: 'ADMIN'},
    ],
  },
];

export const roleHelp = [
  {code: 'AUTHOR', title: 'Regulatory Author', duty: 'Prepare source editions, clauses, interpretations and obligation Drafts. Propose metadata or ownership changes and nominate independent decision makers.', limit: 'Edit authorised Drafts. A separate Reviewer and Final Approver act on your submissions.', topic: 'regulatory-sources'},
  {code: 'REVIEWER', title: 'Compliance Reviewer', duty: 'Use My decisions to inspect named submissions, including cited source, scope and evidence. Record Compliance review or return or reject when available.', limit: 'Review only eligible assignments. Another person gives final approval on the submission you reviewed.', topic: 'decisions'},
  {code: 'APPROVER', title: 'Final Approver', duty: 'Use My decisions after the required review and responses. Approve, return or reject the assigned version or proposal.', limit: 'The Author, Reviewer and Final Approver are different people. Final source approval does not certify department implementation.', topic: 'decisions'},
  {code: 'BUSINESS_OWNER', title: 'Business Owner', duty: 'Validate your named obligation ownership and applicability. Follow department implementation, deliver named work and record outcomes and evidence.', limit: 'Your department gives scope. A named assignment identifies work you can act on. Request an internal target change with a reason when needed.', topic: 'obligations'},
  {code: 'CONTROL_OWNER', title: 'Check Owner', duty: 'Maintain the checks you own and their approved obligation links. Accept named ownership and provide the exact check results and proof for assigned work.', limit: 'Independent review applies to check changes and required results. Source decisions need a separate authorised role and assignment.', topic: 'work-evidence'},
  {code: 'EVIDENCE_OWNER', title: 'Evidence Owner', duty: 'Gather and attach original or eligible retained proof for your assigned work and reporting period.', limit: 'The named reviewer decides whether proof meets the evidence requirement.', topic: 'work-evidence'},
  {code: 'CCO', title: 'CCO', duty: 'Use the CCO dashboard and governed decision history to monitor implementation, overdue work and escalation within scope.', limit: 'Decisions remain with the named Reviewer or Final Approver unless a separate eligible role and assignment apply.', topic: 'reports-history'},
  {code: 'ZONE_VIEWER', title: 'Zone Viewer', duty: 'Read authorised sources and records for the assigned zone and its eligible descendants.', limit: 'Read-only scope covers the assigned area. Create, edit and workflow decisions require a separate eligible role.', topic: 'reports-history'},
  {code: 'ADMIN', title: 'Admin', duty: 'Manage users and access, master data, organisation structure, domain setup and integrations. Review system activity in Audit Log.', limit: 'Source and business decisions require a separate eligible role and assignment. The portal protects your own access and the last active Admin.', topic: 'administration'},
];

export const helpQuestions = [
  {id: 'missing-action', title: 'Why is Approve, Return or Reject missing?', answer: 'Open the record from My decisions and check Next step and the current stage. Verify that your account has the required role, scope and named assignment. A later decision opens after earlier required decisions are recorded. You cannot act on your own submission.', keywords: 'missing button approve reject return 403 prohibited reviewer no access next action'},
  {id: 'draft-only', title: 'Why does a regulatory domain say Draft only?', answer: 'You can save the record as a Draft. Check the domain’s message for a missing owning department or disabled review submissions. An Admin can use Master data → Regulatory domains → Set owner to complete setup. Each notification still follows its own approval workflow.', keywords: 'bank approved owning department domain not listed review regulatory owner department submit'},
  {id: 'empty-queue', title: 'Why can I see a record but not find it in My tasks?', answer: 'A register shows the records available to your role and organisation scope. My tasks shows work assigned to you. Check the named owner and current stage, or open My decisions if you are assigned a review or approval.', keywords: 'missing assignment task no results search filter department'},
  {id: 'returned-record', title: 'What do I do when a record is returned?', answer: 'Open the returned assignment or Draft and read the reason in its workflow or history. Address the requested changes and resubmit when ready. Keep the original reference and use the existing record for the correction.', keywords: 'send back rework reopen correction returned proof'},
  {id: 'validation-error', title: 'What do 400, 403 or 422 errors mean?', answer: 'For 400 or 422, read the specific message and complete the missing field or prerequisite. For 403, check your role, department scope, assignment and independent decision rules. Ask an Admin to review access if the assignment looks correct.', keywords: 'HTTP status popup error forbidden invalid form unauthorized bad request'},
  {id: 'missing-record', title: 'What if a linked record cannot be opened?', answer: 'Check the full notification, obligation or work reference and clear any filters in the register. Ask the record owner or Admin to confirm that the record is still available and your account can see it.', keywords: '404 not found empty register hidden search record'},
  {id: 'employee-profile', title: 'Why is my employee profile waiting for review?', answer: 'A new or changed employee snapshot needs an independent Admin review. Check the status on your profile screen. If the lookup is unavailable, the portal can use approved details when the access checks allow it. Sign in again after approval when prompted.', keywords: 'LDAP login pending user access email designation department TLS employee API unavailable'},
  {id: 'due-date', title: 'Can I change a regulatory deadline by extending a work item?', answer: 'An approved work extension changes the internal target and retains the original date. Regulatory deadlines come from the approved regulatory source and its separate, source-cited deadline history.', keywords: 'date extension overdue notification family internal target regulatory deadline'},
];
