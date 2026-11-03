# Oracle migrations

Run from `backend/` using the same Oracle `DATABASE_URL` as the application:

```sh
APP_ENV=uat ../.venv/bin/python -m alembic current
APP_ENV=uat ../.venv/bin/python -m alembic upgrade head
APP_ENV=uat ../.venv/bin/python -m alembic check
```

For Prod, use `APP_ENV_FILE=.env.prod` after provisioning and populating its profile. Relative profile files resolve from the project root. Only `uat` and `prod` are accepted.

`cbd_alembic_version` tracks the fifteen-revision consolidated chain through `20261101_0020`. Every new installation starts with online `upgrade head`; do not run `create_all`, seed separately or stamp a baseline.

`20261017_0006` is the consolidated baseline and the existing UAT checkpoint. Frozen modules under `backend/alembic/foundation/` install all 73 tables, 251 foreign keys, 40 integrity triggers, reference masters, eight organisation units, nine application roles and ten STANDARD accounts. Fresh installs create only these approved definitions. Existing UAT already at this checkpoint skips the baseline and applies the forward cleanup. Earlier installation implementations have been removed from the codebase; databases at an earlier checkpoint need an explicitly reviewed upgrade path before using this consolidated chain.

`REGULATORY_DOMAINS` contains the framework's 15 domains with `REG-` codes in one `REGULATORY` scheme. Reference MERGE inserts missing codes while preserving administrator-customized names and approved ownership decisions.

The account snapshot includes independently salted bcrypt hashes, password-change flags, home organisations and global/department/zone scopes. UAT uses QA Portal's `Password@123` for new users unless overridden by `SEED_USER_PASSWORD`. Prod requires a separate configured password. Secret validation runs before baseline DDL or offline SQL generation. Reserved username/organisation collisions abort before user-seed DML. Replay preserves existing profiles, credentials, deactivation and scope assignments. The full hierarchy and account list are in the root README.

`20261017_0007` removes exact installation seed UUIDs: three inactive accounts, three inactive roles, two inactive placeholder departments, ten zero-length scope assignments and three related seed-only audit entries. Active records, other foreign-key references, real assignment periods or additional audit history block cleanup. It preserves current identities, credentials and scopes and appends a summary with removal counts. It never purges arbitrary inactive records or expired history.

Oracle DDL commits independently. Cleanup checks its targets before changing the audit trigger and repeats those checks under locks inside one atomic PL/SQL DML block. A temporary exception permits deletion only of the three identified seed audit entries by the marked migration session. The original append-only guard is restored in `finally`; normal audit protection remains in the final schema. A failure after DML but before the version update can be resumed: all target deletes and the summary MERGE are idempotent.

Apply the complete chain with `upgrade head`. The generated `database/upgrade.sql` is a fresh-install review artifact. Use `alembic upgrade 20261017_0006:head --sql` when reviewing only the existing-checkpoint cleanup.

For a future change, update metadata in `app/models.py`, generate `alembic revision --autogenerate -m "describe change"`, then review the explicit operations. Add any data backfill, checks, trigger amendments and privileges needed by the change. Test against UAT before applying the same revision in Prod. Review generated Oracle SQL with `alembic upgrade head --sql`.

The initial baseline includes all circular FKs as separate `create_foreign_key` calls. Do not embed a `use_alter=True` FK in `op.create_table` and assume it will be installed. Review identifier lengths, VARCHAR2 lengths, unique indexes with NULLs, function-index reflection and nontransactional DDL. Unrelated tables are excluded from autogenerate.

If Oracle DDL is interrupted, rerun `upgrade head`: the baseline verifies existing definitions and only fills missing objects. A conflicting object is an error to investigate. Do not drop a schema, erase a version record or stamp over a partial install. Backups are the recovery path for destructive reversal; the delivered revisions deliberately refuse a downgrade that would discard history.

## Week 1–3 application revisions, 24 October 2026

Historical checkpoint `20261024_0010`: Revision 0008 seeds the supplied 25 departments while retaining OPERATIONS identity. Revision 0009 adds server-side authentication state, LDAP onboarding flags and encrypted directory configuration; it imports no application metadata and runs no startup DDL. Revision 0010 reconciles missing frozen reference values with insert-only MERGE, protects migration source/decision history and recompiles the dependent closure guard invalidated by the user-table alteration. All upgrades use Alembic; Prod has not been connected. No downgrade removes retained records. Shape at that checkpoint: 76 tables, 941 columns and 252 foreign keys, with 43 enabled triggers.

## Clause references, 26 October 2026

Revision `20261026_0012` follows metadata-correction revision `20261025_0011`. It adds nullable `cbd_regulatory_clause.source_clause_reference` for the regulator’s original clause/para number. Existing codes and combined page references are retained without guessing or splitting historical values. A new trigger protects permanent clause codes in every status and protects approved source numbering.

At the `0012` checkpoint, portal creation generated permanent `CLS-...` references. Current revision `0020` uses full instrument-prefixed clause codes and retains old references in the alias table. The form has no editable sequence: parent links define hierarchy, source numbers determine natural sibling order, and automatic creation order handles unnumbered provisions. Existing-register import retains a supplied legacy reference as an alias through its independently validated import path. Apply the current head before starting the matching API build.

## Notification families and clause provenance, 28 October 2026

Historical checkpoint `20261028_0013`: 82 tables, 1,010 columns and 281 foreign-key constraints. The frozen baseline remains unchanged. This explicit revision adds `clause_carry_forward`, `notification_link`, `notification_scope`, `notification_assessment` and `regulatory_deadline`, their foreign keys, indexes and five retention/immutability triggers. It inserts no regulatory or business records. Workflow actions, approval separation, audit, status history and notifications reuse the shared tables.

The target-clause/target-edition composite foreign key preserves provenance scope. Oracle's unique target-clause index already covers that foreign key column; no duplicate index is created. A conditional unique index reserves each child's one active/pending parent, and another reserves each notification/deadline effective date. The service also serializes graph writers and revalidates approved sources and scope evidence at both decision stages. Approved relationships and dates are immutable; retained proposals are withdrawn/returned and replaced rather than edited.

Oracle DDL recovery was verified after the redundant-index attempt: the first provenance table was empty and matched every expected column/type/nullability, primary/unique key and foreign key. The revision can reuse only that exact empty scaffold, accounting for Oracle's equivalent VARCHAR/VARCHAR2 reflection. It refuses conflicting or populated scaffolds and never deletes retained rows. Apply with `upgrade head`; do not stamp. Run `alembic check` and `scripts/db_status.py` before starting the matching API. Prod has not been connected or changed.

Oracle reflects the approval-state IN predicate as a simple CASE with repeated WHEN branches. The drift comparator verifies exact state sets, result columns, uniqueness and composite position before treating these representations as equivalent; 14 comparison cases protect against hiding real index changes.

## Encrypted login and LDAP department identity, 29 October 2026

Revision `20261029_0014` adds the three-column ephemeral encrypted-login challenge table and expiry index, bringing that checkpoint to 83 tables / 1,013 columns / 281 foreign keys. Replay consumption commits independently and never replaces authentication/session auditing.

Historical revision **`20261029_0015`** adds seven LDAP department fields to users, a session observation field and a retained 16-column department-request table with three user foreign keys. The model/live UAT reconciliation at that checkpoint was **84 tables, 1,037 columns and 284 foreign keys**. Approved directory code/name are independent of `org_unit_id`, role grants and Home organisation. Nullable baselines are deliberately not inferred for existing LDAP users. The migration creates no accounts, approval requests or business records.

A unique function index enforces one pending request per user. Request ownership/independence checks and a history trigger prevent payload changes, deletion, terminal-decision rewriting and self-approval. Application services serialize subject logins/requests/decisions with a user-row lock and require fresh LDAP authentication after approval. The DBA runtime-grant template adds only SELECT/INSERT and decision-column UPDATE access to the new table.

Oracle's initial DDL attempt installed the columns and empty table/index before failing on trigger syntax. The final revision wraps trigger DDL correctly and uses native PL/SQL comparisons. Its resume path checks exact column types/defaults/nullability, the empty history shape/foreign keys/checks and equivalent pending index before continuing; conflicting or populated scaffolds abort. No table was dropped, data deleted or revision stamped. It recompiles dependent triggers after alteration. Alembic drift checking and live schema/trigger reconciliation pass; reports remain under `outputs/ldap-department-approval-2026-10-29/`. Downgrade refuses to discard retained evidence. Prod was not connected.

## Code-only LDAP identity and Week 4 obligations, 1 November 2026

Revision `20261030_0016` removes redundant LDAP department-name fields while preserving code observations/approvals and Home organisation. Revision `20261101_0017` adds obligation optimistic edit revision, content-validation state and retained ownership-validation task links. Existing workflow, audit, applicability, ownership and mapping tables are reused. Its junction trigger preserves decision lineage; dependent obligation triggers are recompiled.

Revision `20261101_0018` preflights retained obligations for duplicate pending/active versions by immutable code and adds Oracle unique function indexes. It refuses conflicting existing populations without deleting, merging or stamping them. Services serialize a continuing obligation's root before locking its selected version. No obligation/master/business record is inserted by these revisions. Source shape is **85 tables / 1,039 columns / 286 foreign keys**. Downgrade cannot discard decision history. Review the updated runtime grants; revision `20261101_0019` protects reviewed clause/process mappings with retention triggers; Draft replacement uses DELETE, and ownership validation/history remains append-only.

Back up and stop the old API before applying forward DDL, then run `upgrade head`, `alembic check` and the source/live comparison before starting the matching API/frontend. The latest UAT verification, requirement traceability and limitations are in [Week 4 verification](../outputs/week-4-2026-11-01/validation.json) and [the workflow guide](../docs/week-4/obligation-lifecycle.md). Prod has not been connected or changed.

Revision `20261101_0019` is the current head. Its idempotent CREATE OR REPLACE triggers protect UPDATE/DELETE of reviewed clause/process maps and prevent moving a Draft map into a reviewed obligation. Draft edits remain possible. The existing whole-obligation workflow approves captured citations; later independently governed citation insertion retains the pre-existing approval model.

## `20261101_0020` — contextual business identifiers

Run this revision online with the API stopped and a private schema/data backup available. It widens three code columns to 200 characters, rebuilding the two obligation function indexes around the Oracle type alteration, and adds immutable legacy aliases with restrictive foreign keys. A deterministic parent-aware backfill gives each clause a unique instrument-prefixed ordinal across editions. Obligation revision groups retain one code derived from their original primary clause. Supplied old import codes become aliases; UUID relationships and historical payloads are unchanged.

The migration reads and preserves the actual four live code/content guard sources. Its temporary guards permit only exact retained old/new alias pairs on the marked maintenance connection; all other checks remain active. Backfill DML rolls back before restoration DDL on failure. Original guards are restored and dependent triggers recompiled. Oracle DDL is nontransactional: a failed width/index step may leave forward schema changes; rerun after resolving the reported cause. Retained canonical mappings support resumption after data backfill committed but before Alembic stamping. Downgrade is intentionally blocked. Offline SQL is review output and omits the online data backfill; never deploy by stamping or executing that file alone.

UAT evidence is in `outputs/business-identifiers-2026-11-01/`; all 19 original business codes were retained, all original non-code values reconciled and source guard hashes matched. No live obligations existed at migration time. Production has not been accessed.

The restricted runtime needs SELECT/INSERT on `cbd_business_code_alias`, INSERT on `cbd_id_counter` columns `id`, `entity_type`, `prefix`, `next_value`, plus its existing SELECT and next-value UPDATE. Apply the matching grants before activating the API. UAT currently uses the owner; the separate Prod runtime account has not been provisioned or tested.
