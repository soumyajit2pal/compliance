# Compliance by Design — Weeks 1–3 Oracle portal

Last updated: **30 October 2026**. Source migration head: **`20261029_0015`**.

The complete documented relational model and the Week 1–3 portal are implemented in Oracle UAT through Alembic. The application includes Standard/LDAP sign-in, scoped navigation, separate Standard/LDAP user management, administrator access alerts, migration profiling and the regulatory instrument/version/clause lifecycle, same-edition clause hierarchy, independently approved earlier-clause links and governed Notification families. Formal bank sign-off, actual source-population migration and live bank LDAP configuration remain external acceptance inputs.

There are exactly two supported environments: `uat` and `prod`. UAT uses `COMPLIANCE_PORTAL` on `localhost:1523/FREEPDB1`. Prod has a configuration template and has not been connected or changed.

## Login help removed — 30 October 2026

The **Sign-in help** disclosure and its Standard/LDAP, demo-directory and administrator text have been removed from login. The **User guide** link is centred below Sign in. Demo-user selection and the existing authentication gates remain unchanged. README and the generated guide describe the current screen. Frontend TypeScript/build and live desktop/phone checks are recorded in [verification](outputs/login-help-removed-2026-10-30/validation.json). No API restart, configuration, credential or schema change is required; earlier test results below are historical checkpoints.

## Editable Master data and Organisation hierarchy — 30 October 2026

**Admin** can add and edit regulatory domains, regulators, instrument types, obligation categories, frequencies, evidence types, confidentiality classes and processes in **Administration → Master data**. Other lookups has a searchable type selector. A shared field catalogue supplies the forms and server validation. Enter a unique code when adding a record; existing codes and IDs remain permanent, including historical mixed-case codes. Names, supported attributes and active status can be maintained without deleting referenced records. A reason is required; before/after values and the administrator are retained in the audit log.

**Organisation hierarchy** offers **Add organisation unit**, **Add child unit** and **Edit**. Add child preselects the current parent. Parent choices exclude the unit and its descendants; the API also rejects cycles, missing/unavailable parents and deactivation while active children remain. Moves recalculate descendant levels and affect descendant role scope. The BANK root retains its code, type, active status, dates and parentless position; its name can be edited. Existing user Home organisation, LDAP department code/name and role assignments are not rewritten.

Regulatory domains require a `REG-` code, description and taxonomy scheme; enabling Compliance review also requires an active, effective owning department. New domains default to Draft only. Application-role display names are editable, while role codes, activation and creation of custom permission roles remain deployment-controlled. Regulators with retained non-Draft approval history are protected from direct edits. New API writes are restricted to Admin and use the existing session/CSRF controls; there is no delete operation.

The shared backend module is `backend/app/master_data.py`; `/api/masters/catalogue` describes the allowed fields and `/api/admin/masters/{key}` / `{key}/{id}` create/update records. The existing domain-ownership endpoint remains compatible and uses the same validation/auditing. `frontend/features/masters.ts` reuses the shared fields, searchable selects, modal, feedback and hierarchy helpers. These changes use existing tables and need no new configuration, dependencies or schema migration; source head remains `20261029_0015`. A matching frontend build and API restart are required.

**Verification passed:** 256 backend tests, 17 focused maintenance/catalogue checks, six rollback browser groups with 12 responsive screenshots, and three existing-record UAT groups with seven screenshots. The API was restarted on port 8010 with the same login key. Verification and live activation are recorded in [the maintenance report](outputs/master-maintenance-2026-10-30/validation.json). Oracle and browser write tests run inside rollback-only transactions; live UAT checks open/cancel forms and preserve existing records. An older test's seed-only catalogue assumption was corrected to allow the existing LDAP demo user and administrator-maintained records while still checking protected seed identities, permission codes, hierarchy integrity and retired-ID cleanup. Bank LDAP, Prod and an authoritative organisation-chart import remain outside this verification.

## Compact forms and shared searchable dropdowns — 30 October 2026

The white-and-plum sign-in form is more compact: repeated instructions, the subtitle and case-sensitivity reminder are removed. The Sign-in help disclosure has since been removed; **User guide** stays available without signing in. The UAT **Demo user** chooser retains existing autofill and password-change rules. Desktop branding is retained; phones show the compact brand header and form without the promotional panel. Shared spacing reduces panel/form gaps and the repeated role-purpose banner is removed; identity, scope restrictions and access notices remain visible.

Every single-choice dropdown uses one shared searchable control, including login, filters, source editions, registration, clauses, administration and legacy dialogs. Click and type to filter the loaded authorised choices by label, value or supplied code/username aliases; use arrows and Enter to select. Escape cancels the search before closing a surrounding filter panel or dialog. Typed text cannot create a new choice. Native names/values, FormData, required/disabled states, dependent options and existing handlers remain authoritative. Checkbox multi-choice controls and date inputs retain their own interactions. Browsers without native Popover support retain usable native dropdowns.

`frontend/ui/searchable-select.ts` owns the behaviour; `src/components/searchable-select.tsx` connects React fields and one observer handles legacy/async markup. Shared `compact.css` and `searchable-select.css` replace per-page picker implementations. Future fields should use the existing field/select helpers and this shared adapter. See [frontend reuse and test instructions](frontend/README.md).

**Current verification passed:** frontend TypeScript/build, **11 shared-control interaction groups**, **14 desktop/phone screenshots**, **14 repository-filter checks**, **8 encrypted-login checks**, plus live clause edition/parent checks across the existing 1 instrument, 2 editions and 4 clauses. Material limits are recorded in [verification](outputs/searchable-selects-2026-10-30/validation.json), [shared interaction checks](outputs/searchable-selects-2026-10-30/browser-validation.json), [desktop login](outputs/searchable-selects-2026-10-30/login-1440.png) and [phone login](outputs/searchable-selects-2026-10-30/login-390.png). This frontend change needs no new environment variables, dependencies, schema migration or API restart; the existing build is served by UAT. Business records, credentials, Home organisation, role scope and approval rules are unchanged. Browser checks use existing public UAT accounts and cancel unsaved admin edits; bank LDAP and Prod are not contacted. The earlier backend/schema verification below remains historical.

## White + plum palette — 30 October 2026

The selected **White + plum** colour combination is applied to the live portal: white surfaces, plum actions `#705389`, hover `#543a69`, charcoal headings `#292535`, a neutral workspace `#f5f5f8` and soft selected states `#f0eaf6`. Navigation, tables, filters, source details, clause/organisation trees, Notification families, dialogs and admin controls use the shared palette. Sign-in pairs a light plum desktop introduction with the compact white form; phones show branding and the form. Demo selection and password visibility remain available. The original bank artwork and local fonts are unchanged. Success, warning and error colours retain their words and meaning.

This applies the chosen colour combination to the existing labelled navigation and workflow layouts. More tools / Release baseline remain absent from the sidebar. Authentication, role scope, independent approvals, source-edition boundaries, configuration and schema are unchanged. **Palette-only checkpoint:** frontend TypeScript/build, **19 live desktop/phone views**, **14 filter checks**, **8 encrypted-login checks** and **18 selected contrast pairs**. See [verification and limitations](outputs/white-plum-2026-10-30/validation.json), with [workspace](outputs/white-plum-2026-10-30/repository-1440.png) and [login](outputs/white-plum-2026-10-30/login-1440.png) previews. At that palette-only checkpoint, the application JavaScript chunk and original bank artwork were unchanged. The subsequent shared dropdown implementation changes the JavaScript bundle. Prod was not connected; backend tests were not rerun for the stylesheet change.

## Sidebar simplification — 30 October 2026

The shared sidebar no longer shows **More tools** or its **Release baseline** entry, on desktop or in the mobile navigation drawer. Normal role-scoped navigation remains in place. This removes the navigation entry; the existing authorised `#baseline` route and historical release documentation are retained. No business records, permissions or backend configuration are changed. The user guide has been corrected and regenerated; frontend TypeScript/build and a focused live sidebar check are recorded in [verification](outputs/sidebar-navigation-2026-10-30/validation.json).

## Workspace design review history

**29 October 2026:** three alternatives were prepared for comparison: **Graphite + teal**, **Warm neutral + ink**, and **White + plum**, varying navigation, content layout, typography and filters. Each used the same KYC record from the user's screenshot. **On 30 October the user selected the White + plum colour combination, now applied as described above.** The original comparison remains a historical preview of layout ideas.

See [the three design directions and trade-offs](design/workspace-directions-2026-10-29/README.md), [browser verification](outputs/workspace-design-options-2026-10-29/preview-validation.json), and desktop previews for [Graphite + teal](outputs/workspace-design-options-2026-10-29/graphite-1024.png), [Warm neutral + ink](outputs/workspace-design-options-2026-10-29/warm-1024.png) and [White + plum](outputs/workspace-design-options-2026-10-29/plum-1024.png). All three were checked at four viewport widths, with local search/filter/source-summary interactions and no application API requests. The records are a design snapshot, not a new live database audit. Runtime source, authentication, schema/head and configuration were not changed; application/backend tests were not rerun for these isolated previews and documentation.

## Setup and migration

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
cp .env.uat.example .env.uat
# Populate DATABASE_URL with the UAT credential.
chmod 600 .env.uat
APP_ENV=uat .venv/bin/python -m alembic -c backend/alembic.ini upgrade head
APP_ENV=uat .venv/bin/python -m alembic -c backend/alembic.ini current
APP_ENV=uat .venv/bin/python -m alembic -c backend/alembic.ini check
APP_ENV=uat .venv/bin/python scripts/db_status.py
```

The actual local `.env.uat` is already populated and ignored by Git. `.env` contains only `APP_ENV=uat`. Credentials are never written into revisions, `alembic.ini`, SQL exports or reports.

The commands also work from `backend/`, matching QA Portal:

```sh
APP_ENV=uat ../.venv/bin/python -m alembic upgrade head
APP_ENV=uat ../.venv/bin/python -m alembic current
APP_ENV=uat ../.venv/bin/python -m alembic check
```

`APP_ENV_FILE=.env.uat` or `APP_ENV_FILE=.env.prod` selects a project-relative file independently of the current directory. An explicit file is never merged with another profile. Process variables override connection settings. Conflicting profile selectors and all environment names except `uat` and `prod` fail before connecting.

`python -m backend.app.seed` and `python scripts/migrate.py` are convenient entry points for the same `alembic upgrade head` operation. They do not create tables outside Alembic or insert a separate set of demonstration data. Imports and application connection setup never run DDL.

## QA Portal conventions

QA Portal is the implementation reference for the Oracle pool, explicit Alembic migrations, reference-data MERGE, seed entry point and authentication conventions. The LDAP comparison on 27 October 2026 inspected `/Users/soumyajitpal/Documents/Codex/QA Portal`; source references and behavior differences are recorded in [LDAP setup](docs/ldap-setup.md).

This project follows its `backend/app`, `backend/alembic`, `backend/alembic.ini`, `DATABASE_URL` and Oracle Thin-driver conventions. Its namespace is `cbd_`, and revision history is stored in `cbd_alembic_version`. Autogenerate excludes unrelated schemas/tables. Circular foreign keys are explicitly created after all tables, including composite relationships. Oracle's equivalent reflected CASE indexes are recognized without hiding actual index changes.

Source inspection supplied the migration, LDAP, encrypted-login and persistent storage/logging references. LDAP certificate validation, the encrypted sign-in envelope and deployment-controlled storage/logging conventions were adapted from QA Portal; the integration retains this application's encrypted configuration table, server-side sessions and scoped role model. QA Portal files, runtime settings and business records were not changed. No bank directory credentials were imported.

## Migration chain

| Revision | Responsibility |
| --- | --- |
| `20261017_0006` | Consolidated baseline: 73 tables, 920 columns, 251 foreign keys, 40 integrity triggers, reference data and the approved organisation/access seed |
| `20261017_0007` | Remove superseded installation seed records from an existing UAT installation |
| `20261024_0008` | Seed the 25 supplied departments while retaining the OPERATIONS identity |
| `20261024_0009` | Server-side sessions, login throttling, LDAP onboarding flags and encrypted directory settings |
| `20261024_0010` | Insert-only master reconciliation, source/decision retention guards and dependent-trigger recompile |
| `20261025_0011` | Independently reviewed and approved metadata corrections with retained correction history |
| `20261026_0012` | Official clause numbering separate from permanent clause references; protect approved numbering |
| `20261028_0013` | Verified clause provenance, notification links, business scopes, independent implementation assessments and regulatory deadline history |
| `20261029_0014` | Single-use encrypted-login challenges, shared across API workers through Oracle |
| `20261029_0015` | Separate LDAP department identity, workspace gate and retained administrator change decisions |

Revision `20261017_0006` is both the existing UAT checkpoint and the root of the consolidated installation chain. Earlier installation code has been removed. Its frozen schema, reference, integrity and access snapshots live in `backend/alembic/foundation/`; they do not import application metadata. An empty database installs this baseline directly. An existing installation applies only its unapplied revisions through `20261029_0015`, preserving current identities and credentials. Both paths use `upgrade head` without stamping.

Future changes use a new reviewed revision. `metadata.create_all()` and routine stamping are not installation paths.

Oracle commits DDL independently. The initial revision can resume a partial install: it checks existing column types, nullability, defaults, primary/unique/check constraints, foreign keys and indexes before reusing them, and refuses conflicting definitions. It never drops or rebuilds existing tables. Use a backup and investigate a conflict rather than stamping over it. Destructive downgrades are intentionally blocked because they would remove retained compliance history.

## Coverage and initial data

All entities in the model are represented, including the extension schemas for control execution, testing and samples, observations, remediation, independent closure validation, regulatory changes and impact actions, regulatory returns/submissions and data-quality assessments. Release 1 standalone actions, migration lineage, users/scoped roles, documents, reference dimensions, evidence packages and certification are also included. See [the document-to-table map](docs/data-model.md) and [the complete column dictionary](database/data-dictionary.md).

The reference seed includes 7 regulators, 13 instrument types, 15 obligation categories, 104 status values, frequencies, evidence types, confidentiality classes, risk levels, root causes, retained application placeholders and identifier counters. The installation catalogue defines nine active application roles, ten starter accounts and 32 organisation units, including the 25 department names supplied on 24 October. These are installation definitions; names, hierarchy and supported master records can now be maintained by Admin. Earlier seed-only population results are historical; the current UAT also contains the user-created LDAP demo account. Use current verification reports or the live administration screens for counts. No regulatory/business transactions are fabricated.

`REGULATORY_DOMAINS` contains only the framework's 15 domains, using `REG-` codes and one `REGULATORY` classification. The current application list is in `backend/app/reference_data.py`; the frozen installation snapshot contains the same definitions. Domains start inactive until approved organisational owners are supplied. Retained application links start inactive until bank-approved URLs are supplied.

## Frontend and prototype alignment

The live frontend is built with React, TypeScript and Vite. Vite produces the static bundle in `frontend/dist`; FastAPI serves the bundle and the API from the same UAT process. Existing feature modules and their workflows are retained behind the React rendering adapter as the UI moves to typed components. See [frontend structure](frontend/README.md).

**My work** and **My decisions** use **Workflow stage** for the column showing Draft, Compliance review or Final approval. These values describe the task's position in the workflow; the named recipient identifies who must act.

The bulk-import workspace is named **Import existing regulatory records** throughout navigation, screens and the user guide. Regulatory domains show **Draft only** (with the missing setup explained) or **Ready for review**. Authors can prepare Drafts in either case; only Admin can record approved domain ownership and enable review submissions. Each imported instrument keeps one required primary domain for its permanent ID and can list additional affected domains separately; every affected domain must be ready before review submission.

Login includes a UAT-only demo selector. Active Standard seed accounts with effective roles remain listed after first login and after a password change. Selection fills the username and a known public demo password only when it still matches the stored hash; otherwise the user enters the current password. The current public Standard demo autofill password is `Password@1234`; it is returned only when it matches that account's current hash. The original seed password `Password@123` must currently be entered manually; its older autofill regression check is recorded below. Private credentials and password-change flags are preserved. First-password change remains required where applicable. Set `UAT_DEMO_LOGIN_ENABLED=false` to disable the selector; Prod always rejects it.

All implemented Week 1–3 screens follow the prototype's layout, grouped navigation, tables, forms and dialogs, with the selected white-and-plum palette and larger, darker text for readability. Registration uses its five-step wizard and source records use Overview, Versions, Clauses, Workflow and History tabs. Real Standard/LDAP authentication, scoped API data and independent approvals remain authoritative. Wider prototype workflows retain their agreed later-phase scope. See [the comparison and validation report](docs/week-3/frontend-and-prototype-review.md) and [the navigation guide](docs/week-3/regulatory-master-guide.md).

## Organisation hierarchy and seed users

`alembic upgrade head` installs this organisation hierarchy. Codes and labels match the screenshot application; parent links were checked against its source. This is the requested starter hierarchy, not a claim to reproduce the bank's complete HR organisation chart.

```text
BANK — Bank of Maharashtra
  COMPLIANCE — Compliance Department
  RETAIL — Retail Banking
  OPERATIONS — Banking Operations
    PUNE-ZONE — Pune Zone
      PUNE-BRANCH — Pune Main Branch
  CREDIT — Credit and Risk
  IT — Information Technology
```

The ten current `STANDARD` account definitions cover the nine roles in the screenshots. Two Business Owners demonstrate department-specific responsibility. The UAT temporary password for newly inserted accounts is **`Password@123`**, matching QA Portal. `SEED_USER_PASSWORD` overrides it for newly created accounts. Existing accounts retain their passwords and password-change flags. Passwords use independently salted bcrypt hashes with cost 12; plaintext is never stored in Oracle. New accounts have `must_change_password_flag=1`; the sign-in service enforces it before opening the workspace. The portal is available at http://127.0.0.1:8010.

| Username | Role | Department | Role scope |
| --- | --- | --- | --- |
| `admin` | Admin | Compliance Department | Global technical administration |
| `author` | Author | Compliance Department | Global |
| `reviewer` | Reviewer | Compliance Department | Global |
| `approver` | Approver | Compliance Department | Global |
| `retail.owner` | Business Owner | Retail Banking | Retail Banking |
| `operations.owner` | Business Owner | Banking Operations | Banking Operations and descendants |
| `control.owner` | Control Owner | Retail Banking | Retail Banking |
| `evidence.owner` | Evidence Owner | Retail Banking | Retail Banking |
| `cco` | CCO | Compliance Department | Global oversight |
| `zone.viewer` | Zone Viewer | Pune Zone | Pune Zone and descendants, read-only |

Home organisation, role scope and named task ownership are separate mappings. A global Reviewer belongs to Compliance Department and may review eligible assigned work across departments. Business/Control/Evidence Owners retain organisation-specific scope. Pune Zone access includes Pune Main Branch, excluding other departments and the Banking Operations parent. The Week 3 workflow routes source review/approval to explicitly named eligible users. Obligation and action ownership transactions follow in Weeks 4–5. Global scope never authorizes self-approval or technical-administrator approval of business content.

Revision `20261017_0007` physically removes three superseded seed accounts, three application roles, two placeholder departments, ten zero-length seed assignments and three related seed-only audit entries. The migration targets exact UUIDs, checks that the records are inactive and unreferenced by business data, and records removal counts in a new audit event. Current account IDs, passwords, department membership and role scopes are preserved.

The audit exception is restricted to the three identified seed entries and the migration session. The original append-only trigger is restored immediately after the atomic cleanup block. Business audit records and real assignment history retain their normal protections. Rerunning `upgrade head` is a no-op; replaying the cleanup adds no duplicate summary event.

User/role catalogues must filter `active_flag=1`; role assignments must additionally satisfy their effective date interval. The current definitions are in `backend/app/reference_data.py`. Seed emails use non-deliverable `@example.invalid` addresses. Domain ownership is not inferred from these users or departments.

Prod requires `SEED_USER_PASSWORD` with at least 12 characters and at most 72 UTF-8 bytes, different from the UAT default. A missing/invalid value fails before any DML, including offline SQL generation. Only UAT has been migrated here; Prod has not been connected or changed.

## Integrity and application responsibilities

Oracle enforces approval identity/timestamp requirements, maker/reviewer/approver separation, one current source version, parent-version relationships, typed evidence targets, controlled partial applicability, nonnegative counts, mapping uniqueness and date rules. Triggers retain approved content and audit/source metadata, prevent business-code/original-date rewrites, require approved unreplayed history for due-date changes, reject overlapping primary owner tenures, gate activation on source/applicability/owners, and require accepted evidence and independent closure validation for completion/closure.

Bcrypt hashing and verification are provided in `backend/app/security.py`. The Week 1–3 API implements authentication, password-change enforcement, scoped authorization, source workflow routing and role checks, version lifecycle transactions, restricted source storage/download and staging/profiling. Obligation/applicability reassessment follows Week 4; evidence workflow, full dashboards and reminders follow Week 5. Operational approvals remain bank decisions. The schema does not claim that completed implementation is a compliant assurance conclusion. A DBA-controlled runtime account should receive only required DML; migration-owner credentials must stay in deployment tooling.

## Prod deployment

```sh
cp .env.prod.example .env.prod
# Set the actual Prod database URL and a separate SEED_USER_PASSWORD in the untracked file.
chmod 600 .env.prod
APP_ENV_FILE=.env.prod .venv/bin/python -m alembic -c backend/alembic.ini upgrade head
APP_ENV_FILE=.env.prod .venv/bin/python -m alembic -c backend/alembic.ini current
APP_ENV_FILE=.env.prod .venv/bin/python -m alembic -c backend/alembic.ini check
APP_ENV_FILE=.env.prod .venv/bin/python scripts/db_status.py
```

Provision the dedicated Oracle user and required tablespace quota through the DBA first. The owner needs session/table/index/trigger creation privileges; revisions do not create users, grant administrator privileges, or drop schemas. Run migrations as a single deployment job before starting the matching application. Back up Oracle and the document repository together.

Review the generated SQL without connecting:

```sh
APP_ENV=uat .venv/bin/python -m alembic -c backend/alembic.ini upgrade head --sql > database/upgrade.sql
```

That export is a new-schema review artifact. The operational path remains Alembic, which tracks applied revisions and resumes verified partial creation.

## Verification

```sh
.venv/bin/python -m pytest backend/tests -q
CBD_RUN_ORACLE_TESTS=1 APP_ENV=uat .venv/bin/python -m pytest backend/tests -q
```

Oracle tests require explicit opt-in and refuse Prod. Every test uses a transaction and rolls back its temporary data. They never create/drop tables or delete business data for cleanup. `scripts/db_status.py` performs read-only head/table/column/FK/constraint/trigger/seed reconciliation. Earlier test and migration results are recorded in [the validation report](docs/validation.md).

The latest authenticated **29 October 2026 live UAT check**, after the focused UI update, used the existing public demo **reviewer** account with Global Reviewer scope. Its authorised population contained **1 instrument, 2 editions and 4 clauses**, including **1 effective approved edition** and **2 recorded parent edges**. **9 filter/view checks** verified All editions, Current approved and every specific edition; **13 parent-edge assertions** confirmed that each child stays under its recorded parent within its own edition. Source file/wording selection, reload and unchanged hierarchy/edition metadata were also checked. The broader relationship buttons/panels are absent from both clause views, obligation entry points are absent from Notification families, and an old obligation-tab URL opens Business implementation.

The live family register displayed that existing instrument once as a standalone family, with no family links, registered business scopes or regulatory deadlines. Empty implementation remains **Not assessed**. No fixture, business mutation or bank acceptance decision was created by this live audit; normal sign-in/session/audit activity occurred. See [current live results](outputs/clause-release-scope-2026-10-28/live/validation.json), [live family view](outputs/clause-release-scope-2026-10-28/live/live-family-detail.png), [mobile family table](outputs/clause-release-scope-2026-10-28/live/live-family-mobile.png) and [live All editions](outputs/clause-release-scope-2026-10-28/live/live-all-editions.png). The earlier three-level parent-copying scenario and other family transactions were verified in rollback fixtures. Parent copying is now hidden; the current scope verification is linked below. The earlier [browsing-only live report](outputs/clause-live-uat-2026-10-28/validation.json) describes a different earlier population and is historical, rather than evidence of the current database.

The earlier **28 October 2026** browsing-only implementation checks passed frontend TypeScript checking, the production build, **17 edition/filter unit tests**, **2 targeted Oracle API tests** and **19 browser scenario groups**. The API checks used Oracle UAT with temporary files and an outer transaction that rolled back all fixture rows; they cover empty/cancelled edition metadata, authentication/scope, supersession/history and cross-edition parent rejection. Browser checks used the production bundle with **synthetic API responses**, including All/current/specific filters, version/status badges, parent boundaries, scope-preserving navigation/search, empty sources, record tabs, keyboard disclosure and mobile layout. No browser exceptions or API writes occurred. The full backend suite was not rerun. Those implementation browser scenarios used synthetic data; the authenticated existing-record check above is separate evidence and does not constitute bank acceptance. See [verification results](outputs/clause-all-editions-2026-10-28/validation.json), [browser validation](outputs/clause-all-editions-2026-10-28/browser-validation.json), [desktop example](outputs/clause-all-editions-2026-10-28/all-editions-desktop.png), [mobile example](outputs/clause-all-editions-2026-10-28/all-editions-mobile.png) and the [repeatable browser check](frontend/tests/clause-workspace.browser.cjs).

**Earlier browsing-only runtime activation on 28 October 2026:** local UAT on port 8010 was restarted with the new read-only `/api/source-editions` route. Health returned 200, the unauthenticated catalogue returned 401 as expected, and the served index/assets matched the production build. The pending-edition cancellation route is also loaded. See [runtime activation](outputs/clause-all-editions-2026-10-28/runtime-activation.json). That browsing-only update required no schema migration; it predates the Notification families migration and activation recorded below.

The earlier **28 October 2026** single-edition workspace passed 10 edition tests and 15 synthetic browser scenarios; those results describe the earlier browsing default. Historical evidence remains in [single-edition browser validation](outputs/clause-hierarchy-2026-10-28/browser-validation.json). The current All-editions results above supersede that default.


The historical **27 October 2026** wording update changed the shared work/decision table heading from Responsibility to Workflow stage. Frontend TypeScript checking and the production build passed. No backend, workflow or schema behavior changed, so backend tests were not rerun for that label-only update.

The preceding pending-edition/cancellation results are dated **27 October 2026**:

| Check | Result |
| --- | --- |
| Frontend TypeScript check and Vite build | Passed |
| Source-edition selection and pending/cancellation tests | 10 passed |
| Desktop/mobile browser checks | 12 checks passed: pending links, workflow stages, maker controls, required reason, cancellation/history retention, read-only content, approved default, replacement creation and mobile layout; no page errors |
| Backend / database regression | 133 passed, 3 pre-existing failures; all new pending-edition/cancellation cases passed |
| Competing HTTP creation requests | One 200 response and one 409 conflict, leaving one pending edition. Fixture requests share a serialized rollback transaction; independent Oracle transaction contention was not separately tested |

**Historical activation note:** the 27 October cancellation update was initially left pending after a declined restart request. The 28 October UAT restart described above now loads that route and the latest pending-edition code. Live cancellation workflow acceptance was not repeated during this All-editions update; its earlier fixture evidence remains below. The earlier temporary QA server was stopped and its fixtures rolled back.

See [pending-edition validation](outputs/pending-editions-2026-10-27/validation.json), [browser results](outputs/pending-editions-2026-10-27/browser-validation.json), [full backend output](outputs/pending-editions-2026-10-27/backend-tests.txt), [pending edition example](outputs/pending-editions-2026-10-27/pending-edition-desktop.png) and [mobile cancellation](outputs/pending-editions-2026-10-27/cancel-draft-mobile.png). Run edition-selection regression tests with `npm --prefix frontend run test:editions`. The earlier [dialog-feedback validation](outputs/modal-feedback-2026-10-27/validation.json) remains available.

Earlier runs reported three failures from seed-catalogue state, the old demo-password expectation and the outdated revision graph. The current checks below supersede that historical result. The revision test now checks head `20261029_0015` and all ten revisions; the demo test verifies the current public allowlist and confirms that the old seed password is not disclosed. These tests change no live credentials. Historical evidence remains in [prior backend output](outputs/source-editions-2026-10-27/backend-tests.txt), [user-access results](outputs/users-access-2026-10-27/validation.json) and [LDAP results](outputs/ldap-2026-10-27/validation.json).

## Working Week 1–3 application

Install frontend packages once with `npm ci --prefix frontend`. Start UAT with `sh scripts/run_uat.sh`, then open **http://127.0.0.1:8010**. The script builds the React frontend and starts FastAPI, which serves both the compiled assets and API from one process. For live frontend development, start UAT in one terminal and run `npm --prefix frontend run dev` in another; open **http://127.0.0.1:5173**. Vite proxies API requests to the same UAT backend. Seed identities remain migration-managed, and existing passwords and first-sign-in flags are preserved. Standard users must change temporary passwords at first sign-in. LDAP users authenticate with the bank directory, confirm email and Home organisation, then need independent LDAP department verification and approved roles/scope. Fresh LDAP sign-in is required after department approval. UAT also supports the QA Portal mock LDAP flow; [LDAP setup](docs/ldap-setup.md) documents demo credentials and the administration screen. SSO is excluded by user direction.

The current source model contains **84 mapped tables, 1,037 columns and 284 foreign-key constraints**, with ten revisions through `20261029_0015`. Source counts and live Oracle reconciliation were checked on 29 October 2026; use `scripts/db_status.py` for the current database. The organisation seed contains 32 units and ten account definitions across nine roles. LDAP department identity is separate from Home organisation and role scope.

Metadata corrections and official clause numbering are represented by revisions `0011` and `0012`. Revision `0013` adds the five notification/provenance extension tables described below; the frozen 73-table foundation remains unchanged. LDAP configuration and demo replication reuse `0009` storage. No authoritative bank source-population import or live bank LDAP acceptance is claimed.

## Login layout refinement — 29 October 2026 (palette superseded 30 October)

The 29 October revision introduced a balanced split layout informed by the inspected QualityOps login (`frontend/src/Login.tsx` and `frontend/src/index.css` in the separate QA Portal project). Its navy/gold colours have since been replaced by the selected white-and-plum palette. The Clarity/Confidence headline, persistent UAT demo selection and Standard/LDAP guidance remain. The original Bank of Maharashtra artwork is unchanged; its added white plate and gold frame remain removed. The heading hierarchy, background grid, source/review/history explanations and password visibility control are retained. The later compact revision hides the promotional introduction on phones and keeps one bank wordmark above the form. Password and directory guidance is available in the User guide; the login disclosure has been removed.

**Verification:** frontend TypeScript checking and the production build passed. Live Chrome checks covered seven widths from **320px to 1440px**, loaded branding, no horizontal overflow, form labels, demo selection/current-password entry, keyboard password visibility, reduced motion and the public guide. The disabled-demo case was simulated in UAT; Prod was not connected. All **8 existing encrypted-login checks** passed, including actual encrypted desktop/phone login, replay/plaintext rejection, concurrency and recoverable failures. Evidence: [visual validation](outputs/login-design-2026-10-29/visual-validation.json), [desktop preview](outputs/login-design-2026-10-29/login-1440.png), [phone preview](outputs/login-design-2026-10-29/login-390.png), [login regression](outputs/login-design-2026-10-29/security/browser-validation.json) and [build log](outputs/login-design-2026-10-29/build.txt).

This is a frontend revision served by the existing UAT process on port 8010. Migration head remains `20261029_0015`; no API restart, schema, configuration, private-key or account change was needed. Login regression used an existing eligible public demo Reviewer for ordinary sign-in/sign-out only; session, challenge and audit activity are expected. Backend tests were not rerun for this presentation change. Earlier login layout/sizing reports remain historical.

## Encrypted login and deployment private key

The **29 October 2026** login update follows the inspected QualityOps implementation in `backend/app/login_encryption.py`, `generate_login_key.py`, `routers/auth.py` and frontend `loginEncryption.ts` / `api.ts` under `/Users/soumyajitpal/Documents/Codex/QA Portal`. Reference files were read only. This portal has its own newly generated key; QA Portal keys, secrets and records were not copied or changed.

Before each sign-in the browser requests **GET `/api/auth/login-key`**, imports the public RSA key and encrypts the username/password using a fresh AES-256-GCM key and IV. RSA-OAEP/SHA-256 wraps the AES key; the signed two-minute challenge is authenticated with the ciphertext. Only the API holds the RSA private key. **POST `/api/auth/login` accepts only the encrypted JSON envelope**; plaintext/form login, malformed, expired, tampered and replayed requests are rejected with generic messages that omit input values. The public-key response is not cached. A fresh challenge is requested on every retry; there is no plaintext fallback when encryption is unavailable.

Revision `0014` adds `cbd_used_login_challenge` (ID, creation time, expiry) and its expiry index. Consumption commits separately from authentication, including rejected passwords, with the Oracle primary key enforcing single use across workers. Failure to persist replay protection rejects login. Expired consumption records are removed only after an extra day; user and business history are retained. This application's existing deployment secret signs challenges with a dedicated context; its opaque cookie sessions, CSRF, throttling, bcrypt hashes, Standard/LDAP routing, first-password change, profile confirmation and role approval remain in force. The change protects the **sign-in request**; existing password-management and LDAP configuration APIs retain their separate authenticated HTTPS/CSRF requirements.

Provision a distinct key **once per deployment**, then configure the same key for all its API workers:

```sh
.venv/bin/python -m backend.app.generate_login_key var/login-private.pem
# In the ignored deployment profile:
# LOGIN_ENCRYPTION_PRIVATE_KEY_FILE=var/login-private.pem
```

The generator creates an RSA 3072-bit PKCS8 PEM with owner-only permissions and refuses to overwrite an existing key. `var/` and private-key filenames are ignored by Git. Keep the key in an approved persistent server secret store, mount it read-only and back it up securely; browsers receive only its public half. API startup rejects missing, unreadable, weak or broadly readable keys. Prod uses its own provisioned key path in `.env.prod.example`; Prod was not connected or activated. Rotation uses a new key file/path and a coordinated API-worker restart; outstanding challenges fail and the browser can retry. The session/deployment secret and saved LDAP bind secret are unchanged.

HTTPS is required for login outside local UAT. The only HTTP exception is UAT with both a loopback URL and a loopback client; raw forwarded-protocol headers do not bypass the check. Trusted TLS-proxy handling must be configured in Uvicorn/the reverse proxy. Web Crypto must be available in the browser's secure context. Apply `alembic upgrade head`, rebuild the frontend, restart the API and reload browsers together for this authentication contract change. Non-browser clients can use `backend.app.login_client.seal_login(client, credentials)` with a fresh challenge for every attempt.

**UAT activation and verification, 29 October:** revision `0014`, the new deployment key and the matching rebuilt API/frontend are active on port 8010. **171 backend tests**, **17 edition/filter unit tests**, frontend TypeScript checking and the production build passed. **8 live Chrome checks** verified the actual encrypted browser request, Standard identity, one-use/replayed/plaintext rejection, concurrent duplicate requests (one success, one rejection), failed key bootstrap, unavailable Web Crypto, retry and phone login. Standard/LDAP mock routing, first-password/profile gates, malformed/expired/tampered envelopes, transport checks and independent nonce persistence are covered by backend tests; real bank LDAP authentication remains unverified. Pre/post activation fingerprints confirm unchanged users/passwords, grants, directory settings and business counts (1 instrument, 2 editions, 4 clauses). The baseline was captured after the additive security migration and before the API restart; normal session/audit/nonce writes occurred. See [verification summary](outputs/login-encryption-2026-10-29/validation.json), [backend results](outputs/login-encryption-2026-10-29/backend-tests.txt), [live browser results](outputs/login-encryption-2026-10-29/browser-validation.json), [schema reconciliation](outputs/login-encryption-2026-10-29/database-status.json), [runtime activation](outputs/login-encryption-2026-10-29/runtime-activation.json) and [preservation check](outputs/login-encryption-2026-10-29/preservation-check.json). Existing seed-salt checks now verify uniqueness on fresh rollback-only accounts; historical-family checks derive their cutoff from the stored UTC approval date. Existing credentials and application date rules were not changed to satisfy tests.

Implementation references: [Web Crypto API](https://www.w3.org/TR/WebCryptoAPI/), [RSA-OAEP](https://cryptography.io/en/latest/hazmat/primitives/asymmetric/rsa/) and [authenticated encryption](https://cryptography.io/en/latest/hazmat/primitives/aead/).

### LDAP user details in the login response

Successful encrypted **POST `/api/auth/login`** requests for LDAP users now return `ok: true` plus **`ldap_user`**, containing `username`, `source`, `distinguished_name`, mapped `full_name`/`email`/`department`, `attributes_available` and **`attributes`**. The directory lookup requests all readable user and operational attributes (`*` and `+`), plus the configured profile mappings, for the authenticated user's resolved entry. Employee identifiers, job/contact fields, manager, group memberships and any other non-credential attributes returned by the directory are retained with their original attribute names. Multi-value lists stay lists, dates use ISO 8601 and binary values use `{ "encoding": "base64", "data": "..." }`.

Only the successfully authenticated user's details are returned. Failed or inactive LDAP accounts receive no profile; Standard login retains `{ "ok": true }`. Credential/password/hash/private-key fields and bind configuration are excluded. Directory permissions determine the actual attributes returned; direct-bind users who cannot read their entry receive `attributes_available: false` and an empty attribute map. UAT mock responses are explicitly labelled `source: "uat_mock"`, without inventing a directory DN. [LDAP response documentation](docs/ldap-setup.md) includes an illustrative JSON example.

The full attribute map remains transient: it is not persisted in sessions, audit logs or the local user row. The subsequent department approval flow stores only its selected code/name observations and approval evidence, alongside the existing minimal name/email profile. `/api/auth/me` returns the governed local profile; directory groups do not grant roles or Home organisation. The earlier response-only checkpoint required no migration; the current complete build requires revision `20261029_0015` and the matching API/frontend.

**29 October LDAP response verification:** **193 backend tests**, including **29 directory/unit checks** and **5 targeted API checks**, passed at that checkpoint. **4 actual HTTP checks** used a labelled mock in the rollback-only Oracle preview; new/returning LDAP sign-in, response details, failed authentication and unchanged onboarding/access gates passed. No eligible existing mock LDAP user was present in regular UAT, so no permanent identity was created for verification. The fixture has rolled back and its credential file has been removed; fingerprints confirm unchanged users/passwords, grants, directory settings and business counts. Real bank LDAP remains unverified. See [LDAP verification](outputs/ldap-login-details-2026-10-29/validation.json), [HTTP checks](outputs/ldap-login-details-2026-10-29/fixture-http-validation.json) and [preservation evidence](outputs/ldap-login-details-2026-10-29/preservation-check.json).

See [Week 1 baseline and traceability](docs/week-1/baseline-and-traceability.md), [Week 2 operations/access](docs/week-2/operations-and-access.md), [Week 3 user guide](docs/week-3/regulatory-master-guide.md) and [implementation validation](docs/week-3/implementation-validation.json). Help provides the current user guidance; Release baseline is no longer a sidebar destination.

The full Oracle API tests use `CBD_RUN_ORACLE_TESTS=1 APP_ENV=uat .venv/bin/python -m pytest backend/tests -q`. They refuse Prod and roll back all business/security fixture rows. Browser QA uses the same app with the explicit rollback-only server in `scripts/browser_fixture.py` on 8011; stop it to roll back all fixtures. Do not run it concurrently with writer tests because its transaction retains counter locks. Regular UAT remains on 8010.

## LDAP department verification and change approval

**29 October 2026:** LDAP department identity is stored separately from **Home organisation (`org_unit_id`)**. `department_code` and `ldap_department_name` hold approved values; `ldap_last_seen_department_code`, `ldap_last_seen_department_name`, `ldap_department_checked_at`, `ldap_observation_id` and `ldap_department_status` retain the latest authenticated observation. Home organisation and existing role/scope assignments are never derived from, or automatically changed by, the directory code. Full LDAP attributes remain response-only.

Configure **Department code attribute** and **Department name attribute** in Administration → LDAP settings, or bootstrap `LDAP_ATTR_DEPARTMENT_CODE` / `LDAP_ATTR_DEPARTMENT_NAME`. The bank's actual code attribute remains unconfirmed and defaults to unmapped; name falls back to the existing department mapping. Missing/ambiguous/invalid values restrict LDAP workspace access rather than approving a guessed department. Standard sign-in is unchanged. The UAT-only mock explicitly returns `DEMO-001 — UAT mock department`; this is synthetic and still requires approval.

On each successful LDAP sign-in, the server compares the code exactly, preserving case, leading zeroes and whitespace. A match permits the remaining profile/role checks. A mismatch preserves the approved baseline, revokes workspace sessions and shows the previous/current code **and name** with Request department update, Check request status and Sign out. Protected APIs enforce the same gate. Missing values show a verification error and cannot be submitted as replacement values. A matching code with a renamed department refreshes the name with audit history. LDAP changes are detected on sign-in; LDAP is not polled on every API request.

New users first confirm email and Home organisation when valid directory details are available; confirmation submits initial department verification. Existing LDAP users without a baseline must request verification instead of inheriting a code from Home organisation. Administrator role preparation cannot bypass this gate. **Users & access → LDAP department changes** shows pending requests; LDAP user rows also expose retained Department history. A different active administrator reviews the immutable observed code/name, records Approve/Reject and a reason. Approval updates only the LDAP baseline, revokes sessions and requires fresh LDAP sign-in; the latest code must match before workspace access returns. Role assignment remains a separate Edit access action.

Pending duplicate submissions return the same request. New observations supersede older pending requests, and stale sessions cannot request or approve newer values. Returning to the approved code makes a pending request obsolete. Rejection retains its reason and approved baseline; reconsideration requires a new explanation and creates a new request, preserving the rejected decision. Oracle guards retain request evidence and prevent decision rewrites or self-approval. Detailed state, API and deployment rules are in [LDAP department approval](docs/ldap-department-approval.md).

Apply `alembic upgrade head`, rebuild the frontend and restart the API together. Revision `0015` adds seven user fields, a session observation field, one history table, a pending-request unique index and a retention trigger. It does not infer department baselines or create users/requests. The restricted-runtime grant template includes the new table; Prod remains unconnected. The migration's first trigger creation needed DDL/PLSQL corrections; the exact empty scaffold was validated and resumed without dropping data or stamping. Schema reconciliation now passes without invalid objects or drift. Encrypted-login replay storage was also moved off the event loop after concurrent browser verification exposed a blocking wait; a dedicated concurrency regression covers the correction.

**Activation and verification, 29 October:** the matching API/frontend are active on **8010**, revision **`0015`**. **242 backend tests** passed, including 15 Oracle department-flow cases, 8 attribute-mapping cases and the encrypted-login concurrency regression. **10 full browser groups** passed with no page errors, covering mismatch/request/approve/fresh-login, rejection/reconsideration controls, name-only changes, missing codes, safe LDAP text, admin history/settings and widths **1440, 1024, 768, 390 and 320px**. TypeScript/build, live schema reconciliation and Alembic drift checking passed. **13 regular-UAT checks** verified unchanged Standard login, route boundaries, both existing editions, both restored source hashes, matching served build and the existing login key. Rollback fixtures and their credential/observation files were removed; no permanent LDAP test users or requests remain. Original user fields match after accounting for one separately audited self-service password/temporary-password-flag change, which was preserved; all other snapshotted rows match exactly. Real bank LDAP mappings/connectivity remain unverified. See [current verification](outputs/ldap-department-approval-2026-10-29/validation.json), [backend results](outputs/ldap-department-approval-2026-10-29/backend-tests.txt), [browser results](outputs/ldap-department-approval-2026-10-29/browser-validation.json), [live schema](outputs/ldap-department-approval-2026-10-29/database-status.json), [activation](outputs/ldap-department-approval-2026-10-29/runtime-activation.json), [preservation](outputs/ldap-department-approval-2026-10-29/preservation-check.json) and [account-change reconciliation](outputs/ldap-department-approval-2026-10-29/account-change-reconciliation.json). Three existing dependency deprecation warnings and Oracle expression-signature warnings remain; there are no failed checks or detected schema drift.

## Persistent uploads and operational logs

The **29 October 2026** comparison inspected QA Portal's storage configuration, logging, request middleware and Compose mounts read-only. This project previously had no upload startup write check, staged imports outside the upload root and relied on terminal redirection for logs. It now validates persistent directories before serving traffic and writes rotating application logs directly. See [configuration and gap comparison](docs/storage-and-logging.md).

```dotenv
UPLOAD_STORAGE_ROOT=var/documents
LOG_DIR=var/logs
LOG_FILE_NAME=app.log
LOG_MAX_BYTES=10485760
LOG_BACKUP_COUNT=5
DEEP_LOGGING=false
SLOW_REQUEST_MS=2000
```

Settings come from the selected deployment profile, with process variables taking precedence. UAT relative paths resolve from this project, independent of the working directory. Prod requires explicit absolute upload/log paths. Keep them in separate directory trees on approved persistent mounts. Startup fails on invalid settings, unwritable storage or unusable log/lock files. New directories use `0700`; new document/import files and logs use `0600`. Existing document paths and `portal://<id>` references are preserved. New import originals use `<UPLOAD_STORAGE_ROOT>/staging/<batch-id>`; legacy sibling staging files require a verified copy when upgrading another installation.

`LOG_DIR/LOG_FILE_NAME` retains lifecycle, API completion/status/duration, slow requests and failure stack locations with IST timestamps, PID and a generated request ID returned as `X-Request-ID`. Default rotation keeps the active 10 MiB file and five backups. A stable `.lock` coordinates rotation across POSIX workers; the filesystem must support `flock`. Operational logs are separate from transactional Oracle audit history.

`DEEP_LOGGING=true` adds request-start events and database query timings. Both modes exclude request/response bodies, LDAP profiles, headers/cookies, query strings, SQL statements/bind values and exception messages. Exception types and stack file/line/function locations remain available. This deliberately limits QualityOps's optional SQL-text diagnostics to protect directory and regulatory content. Restart every API worker after configuration changes. Uvicorn access URLs are replaced by route-template summaries.

Provision a separate persistent log directory, preserve the document store and deployment keys, and restart the API. No frontend rebuild, key rotation or schema migration is needed. Run `APP_ENV=uat .venv/bin/python scripts/check_storage_runtime.py` for read-only reconciliation without exporting user or directory payloads. Local UAT does not establish bank backup/restore, malware-scanning or production retention acceptance.

The initial storage audit found **2 existing document records with unavailable files**, already absent before activation, with no matching hashes in the current upload directory. **Both were subsequently restored on 29 October 2026** from exact-ID files in the existing project copy at `/Users/soumyajitpal/Documents/git checking/compliance-as-design/var/documents`: **Skills.docx** (`d687411a-4d16-4b5f-9011-263f6168e409`, edition **1.0**) and **Skills copy.docx** (`b9626aa7-ba92-4e50-a6a6-c1ed61d2d169`, edition **2.0**) of `INS-RBI-REG-KYC-ACT-001`. Each is **89,150 bytes**, with the same recorded SHA-256 `16894a1bfee823d9f9544bdb4c1a63c27d043194296e4cb93511158445424bed`. Source, copied stream, restored files and actual HTTP responses all matched Oracle. The files retain separate IDs/edition links and owner-only permissions; backup copies were unchanged. Reconciliation now reports **2 verified, 0 unavailable, 0 hash mismatches**. All snapshotted row counts/fingerprints and the 1 instrument, 2 editions and 4 clauses are unchanged; normal login/access audit writes occurred. **Four live UAT download/preview checks** passed using an existing authorised Reviewer, then the session was signed out. No code, migration, key rotation, restart or Prod change was needed. See [recovery verification](outputs/source-file-restore-2026-10-29/validation.json), [copy/hash evidence](outputs/source-file-restore-2026-10-29/restoration.json) and [HTTP checks](outputs/source-file-restore-2026-10-29/api-verification.json). This recovers the previously uploaded bytes; it does not assess their regulatory content.

**Storage/logging checkpoint, 29 October:** **214 backend tests** passed. The final startup-logging refinement then passed **49 focused configuration/storage/rotation/encrypted-login checks** and **5 Oracle API checks**. Three processes retained all **120 unique log events** across rotation. The UAT restart passed **10 live checks**, including health, reference correlation, IST, private-key preservation, route/query privacy, file permissions and unchanged served frontend. Two read-only Oracle queries confirmed deep timings without SQL text/bind values and basic-mode suppression. All pre/post row fingerprints and counts matched. Those historical reports captured the two missing files before the subsequent verified recovery described above. The API is active on 8010 with `var/logs/app.log`; three existing dependency deprecation warnings remain. See [verification summary](outputs/storage-logging-2026-10-29/validation.json), [full backend results](outputs/storage-logging-2026-10-29/backend-tests.txt), [runtime checks](outputs/storage-logging-2026-10-29/runtime-activation.json), [deep diagnostics](outputs/storage-logging-2026-10-29/deep-diagnostics.json) and [preservation](outputs/storage-logging-2026-10-29/preservation-check.json).

## Regulatory library: More filters

**29 October 2026:** More filters expands an inline panel above the results. The header has an **X / Close filters** control and the footer has **Close**, **Apply filters** and **Clear filters**. Close, Escape, clicking outside or moving keyboard focus outside dismisses the panel. Explicit close and Escape return focus to More filters; closing preserves unapplied selections without running a search. The native disclosure also supports Enter/Space. On narrow or short screens, fields scroll inside the panel while its header/footer stay available; the action group stays together when wrapping.

Apply filters submits the main search and additional criteria, then closes the panel even when the query is unchanged. An applied-count badge remains on More filters. Clear filters resets the full query and also clears unapplied selections on an already unfiltered page. Filtering permissions and API semantics are unchanged. Rebuild the frontend and reload UAT; this update needs no backend restart, schema migration or business-data changes.

TypeScript checking and the production build passed, followed by **14 read-only live UAT browser groups** using **1 existing authorised instrument**, with no browser/API errors or business writes. Checks cover close/focus preservation, Escape, outside dismissal, retained selections, Apply/Clear and layouts at **1440, 1024, 768, 390 and 320px**. The shared-handler change also passed **19 Clause workspace browsing groups with synthetic API responses**. These UI checks do not repeat the backend/database regression suite or establish bank acceptance. See [filter verification](outputs/repository-filters-2026-10-29/validation.json), [live browser results](outputs/repository-filters-2026-10-29/browser-validation.json), [Clause browsing regression](outputs/repository-filters-2026-10-29/clause-regression/browser-validation.json) and [served-build check](outputs/repository-filters-2026-10-29/runtime-validation.json). Repeat the focused check with `npm --prefix frontend run test:repository-filters:live -- /absolute/path/to/playwright` against the running local UAT portal.

## Form errors and dialog feedback

Validation failures inside a dialog appear once in a persistent error summary at the top of the dialog body. The summary receives keyboard focus, scrolls into view and is announced as an alert. Entered values remain available; the submit button becomes usable again after the failed request. The summary clears on retry or when a new dialog is opened. Asynchronous action/lookup failures also use feedback inside the active dialog, rather than a page toast behind its backdrop.

Page forms with an inline error area use that area; other page actions use the normal toast. Successful modal saves close the dialog before showing their page success message. Opening another dialog clears stale page feedback. A new toast replaces the older timer and remains available for its full seven-second interval. Session expiry closes a stale dialog before showing sign-in and the session message.

The screenshot's **Add at least one source clause / para before submitting** message remains a business validation requirement. Cancel the submission, add source clauses to the selected Draft edition, and submit again. This update changes error presentation and does not bypass review prerequisites.

The shared implementation is in `frontend/ui/feedback.ts`, with form event handling in `frontend/core/events.ts` and dialog layout in `frontend/ui/dialog.ts`. Feedback is rendered within the native dialog's top layer; raising a page toast's z-index would not solve the layering issue.

## Notification families and focused clause linking

**Regulations → Notification families** groups an original notification with its separately issued amendments. Existing unlinked library records appear as standalone families. The page uses authorised Oracle records: it does not install the prototype's `DEMO-NOT-101` examples or invent implementation totals.

- Authors can **Register amendment** through the source wizard or **Link existing notification**. Each amendment has its own instrument, source editions and independent implementation. A named Reviewer and a different Approver must approve its family relationship. One retained parent is allowed per notification; same-regulator, cycle, duplicate and concurrent-approval checks run on the server. Return/withdraw retains the proposal; corrections use a fresh proposal. Approved links cannot be reparented in this release; registered scope-owner reassignment also needs a later governance transaction.
- **As of date → Apply filters** applies the selected date to approved source history, effective source editions and regulatory deadlines. The register also offers a labelled **Search notifications** field for titles or reference numbers; Apply filters submits both controls. Summary cards distinguish original requirements, amendment implementation and the parent's regulatory deadline. Rows show official references, relationship, effective date, implementation and timeline. Approved future amendments remain visible as Upcoming. Historical/future positions are read-only. Delivery details use the latest retained action records, so this is not a complete reconstruction of historical implementation.
- **Business implementation** begins with registered scopes in Pending. Missing descendant scopes remain pending until explicitly registered. Conclusions and obligation citations never transfer from an original to its amendment. The named Business Owner submits Completed or No impact for the exact effective approved source, followed by independent review and approval. Completed requires all source-specific actions completed with accepted, retained, independently verified evidence. Source/action/evidence changes require reassessment. Empty scopes are Not assessed, and implementation never asserts compliance assurance.
- Registered business scopes grant read access to their notification and approved family descendants for effective roles covering that organisation. They grant no Author authority and do not override higher confidentiality restrictions. The assessment's recipient lookup is restricted to its named Business Owner. Counts and ancestry cover only visible notifications and business scopes; restricted parent identities remain hidden.
- **Business implementation**, **Source editions** and **Regulatory deadline history** remain available. Obligation tabs, buttons, links, counters and detail views are hidden from the current business workspaces. A saved `tab=obligations` link falls back to Business implementation. The underlying obligation/citation data and controlled lookup administration are retained; full obligation management remains outside this release.
- Authors propose source-cited regulatory dates for independent approval. The original, current and next approved dates remain visible; descendants inherit the nearest effective ancestor date until their own approved override applies. Internal action extensions do not change regulatory deadlines. Link, scope, assessment and deadline history is retained by database guards.

In **Add/Edit Draft clause → Parent clause**, choices are restricted to the selected source edition and exclude the edited clause and its descendants. Changing source editions resets the parent choices. The hierarchy remains **5 → 5.1 → 5.1.1 within one edition**. **Earlier-edition parent reuse is hidden**: Add/Edit offers no reuse button, ancestor preview or copy action. Previously recorded provenance remains readable, and no stored clauses or history are deleted.

**Link earlier clause** remains available to eligible Authors in both the Clause workspace and the instrument's Clauses tab. It submits an AMENDS/SUPERSEDES/REFERS_TO/DEPENDS_ON/REPEALS reference to an approved earlier clause within the notification family. The named independent Reviewer must review it before the different named Approver can approve it. Recipients need access to both sources. Review uses **My decisions** or Notification families → **Independent proposals and decisions**, with both cited clauses available for inspection. Linking does not copy wording or change a structural parent.

The broader **Clause relationships** buttons, scroll actions, relationship panel and relationship counts are hidden. The focused linking action and its independent decision/history workflow remain available. All instruments / All editions, Current approved, specific-edition selection and notification-family relationships keep their existing behavior.

This **29 October 2026 UI scope update** requires only the rebuilt frontend and a browser reload. No backend change, schema migration, data cleanup or credential change is needed; the source migration head at that checkpoint was `20261028_0013`. Retained carry-forward APIs/provenance and relationship/obligation data are preserved for later release. Current verification passed TypeScript checking, the production build, **17 edition unit tests**, **19 browsing regression groups**, **3 targeted Oracle/API checks** and **11 browser workflow groups**. The latter verifies hidden Add/Edit reuse controls, same-edition parents, source-safe independent linking from both clause views, hidden obligations/relationship panels, old-URL fallback and the retained family workflows. The full backend suite was not rerun for this frontend-only update. Verification is recorded in [release-scope results](outputs/clause-release-scope-2026-10-28/validation.json), [targeted Oracle/API checks](outputs/clause-release-scope-2026-10-28/backend-tests.txt), [browser workflow results](outputs/clause-release-scope-2026-10-28/browser-validation.json) and [browsing regression](outputs/clause-release-scope-2026-10-28/clause-regression/browser-validation.json). The report directory records the task's 28 October start; the final verification date is recorded inside the reports.


The original backend delivery required `alembic upgrade head`, a frontend rebuild and a UAT backend restart. Revision `20261028_0013` adds five tables and five retention guards without seeding business records; UAT activation is recorded below. The earlier 28 October backend delivery passed **154 regression tests** and **11 focused Oracle/API tests**. Type checking, the production build, **17 edition unit tests** and the **19 browsing regression groups** passed. Verification is recorded in [the implementation report](outputs/notification-families-2026-10-28/validation.json), [Oracle/API regression results](outputs/notification-families-2026-10-28/backend-tests.txt), [browser results](outputs/notification-families-2026-10-28/browser-validation.json) and [live schema reconciliation](outputs/notification-families-2026-10-28/database-status.json). Fixture evidence and existing-record UAT evidence are identified separately. The historical 28 October browser run passed **10 workflow groups**, including the then-visible parent-copying feature. The current scope results above supersede that UI behavior; the stored evidence remains historical.

**UAT activation completed on 28 October 2026:** the server on port 8010 loads revision `0013` and the rebuilt frontend. Health returned 200, the new family API requires authentication, served assets match the build, and pre/post activation business-record snapshots match. See [runtime activation](outputs/notification-families-2026-10-28/runtime-activation.json). Reload the portal to use the feature.

**29 October filter UI check:** the former **Show position** button is now **Apply filters**, with **As of date**, a wider labelled search field and a short date explanation. Controls align on desktop and stack on narrower screens. Counts use the correct singular/plural; a search reports matching families separately from the authorised library-record total, and a no-match result offers filter guidance. The production build and TypeScript check passed. A read-only existing-record UAT check passed **9 browser groups** at 1440, 1024, 768 and 390 pixels, covering date/search submission and register/detail layouts with no browser/API errors or business writes. This population contains **1 family / 1 library record** and does not establish new amendment/deadline scenario coverage. See [filter UI verification](outputs/notification-family-filters-2026-10-29/validation.json), [browser results](outputs/notification-family-filters-2026-10-29/browser-validation.json) and [served-build check](outputs/notification-family-filters-2026-10-29/runtime-validation.json). This frontend-only update needs a browser reload; no backend restart or migration is needed.

Repeat the browser workflow using `CBD_RUN_ORACLE_TESTS=1 CBD_NOTIFICATION_BROWSER_QA=1 APP_ENV=uat .venv/bin/python scripts/browser_fixture.py` and `npm --prefix frontend run test:families` with Playwright available. This starts an isolated-session UAT preview on port 8011; stop it with Ctrl+C to roll back every synthetic record. The normal UAT portal stays on port 8010. Fixture credentials are stored only in an ignored owner-readable file and removed on exit.

## Source editions and draft editing

### Clause workspace hierarchy and browsing filters

**Clauses / Paras → Workspace** starts with **All instruments / All editions**. The tree groups every authorised clause by instrument and shows recorded parent/child branches directly, for example **5 → 5.1 → 5.1.1**, with no intermediate version rows. Official source numbers and headings are primary; permanent `CLS-…` references remain visible. Every node carries an edition number and source-status badges, including Current approved, Draft, Approved/Historical, Approved/Future effective and Cancelled where applicable. Opening a clause shows that exact edition's wording, interpretation, source file and permitted actions while preserving the browsing filters.

| Source edition filter | Population |
| --- | --- |
| **All editions** (default) | All authorised editions, including Draft, historical, future, rejected and cancelled sources, for all instruments or the selected instrument |
| **Current approved** | One approved edition effective today per selected instrument, resolved from the current pointer or the latest effective approval. No Draft, historical or future fallback is substituted |
| **Specific edition** | Available after choosing one instrument; displays only that edition, including an empty edition |

Repeated clause numbers remain distinct records with edition/status badges. Both ancestor context and direct parent links require the same instrument and edition. Numbering alone never creates or joins parents across editions. The Author must record the same-edition parent when capturing each clause. An edition with no clauses remains empty; old clauses do not stand in for an empty current edition. Instruments without captured clauses or editions remain selectable in the controls.

Search and clause-approval filters apply within the selected instrument/edition scope. Matching children retain same-edition ancestors as parent context; opening a parent context clears those filters and preserves the browsing scope. Clear filters retains the instrument/edition choice. Changing instruments preserves All editions or Current approved; a specific edition resets to All editions for the newly selected instrument. Changing either selector clears the previous clause/search/status selection. **Register** shares the same filters and edition badges; result links and returning to Workspace preserve the browsing scope and open the exact clause. Legacy `version=` links are accepted; new links use `instrument=all|ID` and `edition=all|current|ID`. Clause-only links open their exact record within the default All view. Unavailable filters fall back with an explicit notice.

The selectors remain above the collapsible hierarchy on mobile. The Instrument workspace's Clauses tab shares the tree and badges but stays pinned to its own Source edition selection and approved/effective default.

`GET /api/source-editions` returns edition metadata for the same authorised instrument population as the library/clauses endpoints, including editions with zero clauses and the retained Draft-cancellation flag. The workspace loads this catalogue once per render and fetches full details only for the opened clause's instrument. Existing permissions, stored parent relationships, approvals and source files are preserved. The catalogue itself requires no migration. The complete current API build requires migration head `20261029_0015` and a matching backend restart before using the rebuilt frontend.

### Instrument workspace edition selection and Draft editing

Opening a record from the Regulatory library selects its **current approved edition effective today**. If the current pointer is unavailable or no longer effective, selection falls back to the latest approved edition effective today. A newer Draft or future-approved edition does not replace that default. With only future/historical approvals available, the view is labelled as reference material with no approved edition effective today. If there are no approved editions, the latest Draft is displayed with **No approved source edition is available yet**.

The selector, edition-history links and My work / decision links can explicitly open any authorised edition. The selected edition stays in the URL while navigating Overview, Versions, Clauses, Workflow and History and survives reload. Returning through the library starts with the approved default again. Creating a new edition opens that Draft directly. **Open pending edition** opens an existing Draft, In review or Reviewed edition; a selected Draft explains that the approved effective edition remains the operative source and offers **View approved edition**. Future-approved editions retain the Future effective label and require the existing controlled activation rules.

**Edit draft version** is available to the edition's maker with Author access in the owning department. It supports version number, version date, effective-from date, approved predecessor for subsequent editions, change summary, consolidated-edition flag and an optional source replacement. An empty file input retains the source. Normalized version numbers must be unique within the instrument, and subsequent editions must supersede an approved edition of the same instrument with an earlier effective-from date.

| Edition state | Editing and next step |
| --- | --- |
| Draft, including an edition returned to Draft | Maker with scoped Author authority can edit edition details, clauses and interpretation |
| In review / reviewed | Content is locked. The maker can Withdraw to Draft; the named reviewer/approver can Return for correction |
| Approved | Source edition is retained and cannot be edited. Source changes require a new edition; supported instrument metadata corrections use their independent approval flow |
| Previously rejected or terminal historical editions | Retained read-only; this change does not reopen old history |
| Cancelled Draft | Permanently closed, retained read-only with its cancellation reason; its version number stays reserved |

Withdrawal now returns the source edition to Draft and records the old workflow as Withdrawn. Return records it as Returned. Both clear current review/approval fields, reset clause interpretation to pending and preserve prior assignments, decisions, comments and audit history. Resubmission starts a new Compliance review followed by independent final approval; an earlier review cannot be reused.

Saving a Draft preserves its identity, clauses, interpretations and uploaded source files. A replacement source does not rewrite or delete the approved edition or automatically replace clause wording; recheck existing clauses before resubmission. Clause effective-from dates follow the edited Draft. Editing the initial Draft also aligns its draft instrument source/issue/effective dates and open domain mappings; editing a subsequent edition leaves approved instrument metadata unchanged. Changes are recorded in the existing audit table.

The new `PUT /api/versions/{id}` endpoint enforces Draft status, maker identity, Author scope, source ownership/classification, version uniqueness and predecessor validity on the server. An open review workflow also blocks editing. Draft editing itself adds no schema migration; the complete current source migration head is `20261029_0015`.

### One pending source edition per instrument

An instrument may have only one pending source edition: **Draft**, **In review** and **Reviewed** all occupy the pending slot. While one exists, the UI replaces **New version** with **Open pending edition**, identifies its version and stage, and explains the required action. The approved effective source remains the reading default. Approval, rejection or permanent Draft cancellation releases the slot. **Withdraw to Draft** and **Return for correction** keep it pending, since the same edition still needs work.

The maker with scoped Author access can use **Cancel draft** on a Draft and provide a required reason of 10–10,000 characters. Cancellation is permanent: the edition cannot be edited, submitted or reopened. Its uploaded source, clause wording, interpretation, identifiers and previous review/withdrawal history remain available, together with who cancelled it, when and why. Cancelling a subsequent Draft leaves the approved instrument and current source unchanged; another edition may then be created with a different version number. Cancelling the initial Draft also closes its unapproved instrument as Withdrawn and retains the registration and history.

`POST /api/versions/{id}/cancel` enforces maker identity, Author scope, Draft status, a closed review workflow and the required reason. The cancellation and clause state changes, status history and `DRAFT_CANCELLED` audit event commit together. The existing terminal `WITHDRAWN` storage status is displayed as **Cancelled** for editions carrying that cancellation event; earlier historical withdrawals keep their original label. No schema migration or historical deletion is needed.

`POST /api/instruments/{id}/versions` checks for pending editions while holding the parent instrument row lock, shared with submission, cancellation and workflow decisions. A competing creator waits and then receives **409 Conflict** if a pending edition exists. Submission also rejects a second pending edition retained from earlier data. Existing duplicates are preserved and listed with links; their makers must withdraw active submissions to Draft and cancel the extras. This is enforced by the portal API; direct database writers must follow the same locking rule. Cancelled and rejected version numbers remain reserved by the existing uniqueness rule.

## Users & access and administrator alerts

Administration → **Users & access** separates **Standard users** and **LDAP users** into tabs, with a third **Action required** view across both types. Tabs show account counts. Search stays within the selected view, and an access-status filter narrows the list. Summary cards link to pending LDAP approvals, missing/ineffective roles and unfinished LDAP profiles.

Account enablement and usable access are displayed separately:

| Access status | Meaning and next step |
| --- | --- |
| Profile confirmation pending | The LDAP user must confirm email and Home organisation. Prepared roles do not bypass this step. |
| Pending access approval | The LDAP profile is confirmed and has no effective roles. Admin reviews the request and assigns approved roles and scope. |
| Role assignment required | A Standard account has no effective roles. Admin assigns approved roles and scope. |
| Role review required | Assignments exist but none are currently effective. Admin reviews role availability, dates and organisation scope. |
| Password change required | Roles are assigned; the Standard user must change their temporary password at sign-in. |
| LDAP department verification required / changed | Review the server-observed code/name request separately from Home organisation and roles. Workspace access is blocked. |
| LDAP department unavailable | Correct directory mappings or missing/ambiguous values before a valid request can be submitted. |
| Fresh LDAP sign-in required | Department approval is complete; the user must authenticate again and match the approved code. |
| Access assigned | Effective roles are present and profile, password and applicable LDAP department checks are complete. |
| Inactive account | The login is disabled and is excluded from the action queue. Admin reviews the account before reactivation. |

The table shows only effective roles as current access, flags other non-expired assignments that are not effective, explains the next step and provides **Review request**, **Assign roles**, **Review roles** or **Edit access** as appropriate. Saving access returns a specific confirmation: for example, roles assigned but profile confirmation still needed, or approved access ready. Access updates revoke existing sessions; the user signs in again.

Administrators see an attention banner throughout their workspace, an action count beside **Users & access**, and an **Access action required** Home card. Counts are calculated from current account state, role validity and scope, including pre-existing requests. They refresh on navigation and through **Refresh access status**; no background polling extends idle sessions.

First LDAP sign-in, profile confirmation and account/access updates generate persistent **in-app notifications** for active administrators. Role/access changes also notify the affected user. Admin notification links open the specific account in its Standard/LDAP tab. Historical events display the account's current status and next step, so a resolved request shows assigned access. Former administrators cannot read other users' access notifications. No email delivery is configured by this change.

The original access catalogue reused existing tables. The complete current LDAP department workflow additionally requires revision `20261029_0015`. Existing LDAP email/UPN and domain-qualified usernames can receive role assignments; Standard usernames retain their existing character restrictions. Username/login-type immutability, own-access restrictions, session/CSRF checks and existing business approval boundaries remain enforced by the API.

## LDAP / Active Directory

Administration → **LDAP settings** follows QA Portal's connection, certificate, profile and test sections:

- Enable or disable real directory authentication. Saved database configuration applies immediately and overrides environment bootstrap values as a complete record.
- Configure service-account search followed by a user bind, or a direct user DN template. Service-account search takes priority when both Base DN and Bind DN are supplied. The selected username pattern must contain `{username}` exactly once.
- Upload, retain or remove a PEM/DER CA certificate bundle. The limit is 1 MiB and 20 CA certificates. Validation rejects private keys, invalid/expired certificates, non-CA certificates and duplicates. Certificate details include issuer, validity and SHA-256 fingerprint.
- Map full name/email and separate department code/name attributes. Name can retain the legacy `department` mapping; code defaults to unmapped until confirmed by the bank. Missing values restrict LDAP workspace access. Home organisation and role scope remain separate.
- Test the currently displayed values and certificate changes before saving. A connection test uses the real directory, creates no account and stores no test credentials; the mock cannot satisfy it.
- Keep the existing encrypted bind secret by leaving the password blank. Password whitespace is preserved. After a deployment-secret rotation, re-enter the bind password to restore service-account lookup.

`ldaps://` validates the certificate chain and directory hostname. `ldap://` with StartTLS upgrades before credentials are sent. Existing configurations retain StartTLS behavior. QA Portal-compatible plain LDAP is selectable with an on-screen transport warning. Explicit URI schemes take priority over the TLS/SSL choice for a bare hostname. Removing a custom CA restores system trust.

Before the first database save, configuration comes from the selected profile. Supported bootstrap settings are:

| Purpose | Variables |
| --- | --- |
| Availability and transport | `LDAP_ENABLED`, `LDAP_SERVER_URI`, `LDAP_USE_SSL`, `LDAP_START_TLS` |
| Search bind | `LDAP_BASE_DN`, `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`, `LDAP_USER_SEARCH_FILTER` |
| Direct bind | `LDAP_USER_DN_TEMPLATE` |
| Server-managed legacy CA path | `LDAP_CA_CERT_FILE` |
| Profile attributes | `LDAP_ATTR_FULL_NAME`, `LDAP_ATTR_EMAIL`, `LDAP_ATTR_DEPARTMENT`, `LDAP_ATTR_DEPARTMENT_CODE`, `LDAP_ATTR_DEPARTMENT_NAME` |

Use the Admin upload control for certificate files selected on your device. Keep bank bind secrets in ignored environment profiles or the encrypted saved configuration. A bank endpoint, CA trust and service/search configuration still need to be supplied and validated. Keep a Standard administrator available for recovery. Prod has not been connected or deployed.

### UAT demo LDAP

The local UAT mock uses the following public demonstration credentials. The active login endpoint was checked on 30 October 2026; the prefix is `bmock`:

```env
LDAP_MOCK_ENABLED=true
LDAP_MOCK_USERNAME_PREFIX=bmock
LDAP_MOCK_PASSWORD=QualityOps-Mock-LDAP-2026!
```

These are public demonstration credentials. The tracked example profiles default mock LDAP to disabled; local UAT currently uses the runtime default prefix `bmock`. The earlier `mmock` instructions reflected a previous configuration. Environment changes require a backend restart using `sh scripts/run_uat.sh`; no environment setting was changed for this palette update.

1. Open [the local portal](http://127.0.0.1:8010) and sign in as `bmock01` with `QualityOps-Mock-LDAP-2026!`.
2. Confirm work email and select Home organisation. The mock LDAP identity is `DEMO-001 — UAT mock department`.
3. An administrator approves the LDAP department in **Users & access → LDAP department changes** and assigns roles/scope separately in Edit access.
4. Sign in again to use the approved access. Use a new username such as `bmock02` to repeat first-login onboarding.

Demo LDAP substitutes directory authentication and then uses the real session, profile, approval and access services. New users receive no automatic roles or local password hash. Existing Standard accounts always use their portal password. Wrong mock passwords are rejected without contacting the directory. Other usernames reach the real directory when one is configured.

Demo LDAP availability, the prefix and sample username are documented here and in the User guide; login no longer shows the demo LDAP help hint. The API does not return the configured mock password. Mock LDAP is configured independently of the Standard selector controlled by `UAT_DEMO_LOGIN_ENABLED`; set `LDAP_MOCK_ENABLED=false` and restart to disable it. Prod startup rejects mock LDAP when enabled.

See [LDAP configuration and reference comparison](docs/ldap-setup.md) for details and [the historical 27 October validation](outputs/ldap-2026-10-27/validation.json); current department evidence is linked above for evidence.

## Documentation maintenance

Update this README with every project change, including behavior, setup/configuration, migration head, demo instructions, verification results and outstanding limitations as applicable. Revise existing sections when facts change, update the date, and link supporting reports. Distinguish source-model counts, live database checks and historical results. Document only public demo credentials; keep private secrets out of tracked files. This requirement is also recorded in [AGENTS.md](AGENTS.md) for future work.
