"""Shared screen labels and field guidance for instrument register imports."""
import csv
import io
from datetime import datetime
from typing import get_args
from .schemas import FamilyRelationshipType

RECORDS_SHEET = 'Regulatory records'
CLAUSES_SHEET = 'Clauses'
GUIDANCE_SHEETS = {'How to fill', 'Example', 'Choices'}
GUIDE_TITLE = 'Import existing regulatory records'
CHOICE_LABELS = ['Regulator', 'Primary regulatory domain', 'Instrument type', 'Materiality',
                 'Confidentiality', 'Regulatory owner department', 'Interpretation owner',
                 'Additional affected domains']
MULTI_VALUE_FIELDS = {'Additional affected domains'}
FAMILY_RELATIONSHIPS = get_args(FamilyRelationshipType)

# key, screen label, required, guidance, illustrative value
FIELDS = [
    ('title', 'Instrument title', True, 'Use the title printed on the official source.', 'EXAMPLE ONLY - Customer identification notification'),
    ('short_title', 'Short title', False, 'An optional shorter name for this notification.', 'Customer identification example'),
    ('official_reference_number', 'Official reference number', False, 'Copy the regulator\'s reference exactly, when one was issued.', 'EXAMPLE-REFERENCE-001'),
    ('issue_date', 'Issue date', True, 'Use an Excel date or DD/MM/YYYY, for example 24/10/2026.', '24/10/2026'),
    ('effective_date', 'Effective date', True, 'Use an Excel date or DD/MM/YYYY. YYYY-MM-DD also works.', '01/11/2026'),
    ('applicability_date', 'Applicability date, if different', False, 'Leave blank when it is the same as the effective date.', ''),
    ('regulator_code', 'Regulator', True, 'Choose the regulator name shown in the portal.', 'Reserve Bank of India'),
    ('domain_code', 'Primary regulatory domain', True, 'Choose the required primary domain. It supplies the domain segment in the permanent instrument ID. Draft-only domains still need setup before review.', 'KYC / AML / CFT'),
    ('instrument_type_code', 'Instrument type', True, 'Choose the instrument type shown in the portal.', 'Notification'),
    ('materiality', 'Materiality', True, 'Choose a value from the Materiality drop-down list.', 'High'),
    ('confidentiality_code', 'Confidentiality', True, 'Use the same confidentiality as the uploaded source document.', 'Internal'),
    ('keywords', 'Search keywords', False, 'Separate search words with commas.', 'KYC, customer identification'),
    ('department_code', 'Regulatory owner department', True, 'Use the owning department shown in the portal and on the uploaded source.', 'Compliance Department'),
    ('owner_username', 'Interpretation owner', True, 'Choose a person from the list, or enter the portal name or username. The person still needs Author access for the selected department.', 'Regulatory Author'),
    ('source_document_id', 'Source document ID', False, 'For a previously uploaded source, copy its document ID. Otherwise use Source file name and attach the file with the workbook. Choose one method.', ''),
    ('source_record_id', 'Existing register reference', False, 'Optional reference from your existing register, retained with the original row.', 'REGISTER-001'),
    ('additional_domain_codes', 'Additional affected domains', False,
     'Optional. Enter each additional domain name or code from Choices, separated by semicolons. Do not repeat the primary domain.',
     'Fraud Risk Management; Information Technology and Cyber Security'),
    ('import_reference', 'Import reference', False, 'Required when linking clauses. Use one unique workbook reference per record, for example REG-001. Permanent portal IDs are generated automatically.', 'REG-001'),
    ('source_file_name', 'Source file name', False, 'For a new record, enter the exact filename of a supported source attachment instead of a Source document ID.', 'example-source.txt'),
    ('source_edition', 'Source edition', False, 'New records start at 1.0. For an existing Draft, enter its exact edition number as text.', '1.0'),
    ('existing_instrument_code', 'Existing instrument code', False, 'Optional clause-only target: enter the current or retained legacy instrument code and its exact Draft source edition. Other instrument fields and source inputs must be blank; existing content is retained.', ''),
    ('family_parent_reference', 'Parent notification', False,
     'For a new amendment, use the parent’s Import reference in this file or its existing portal instrument code. Fill all three relationship fields together.', 'REG-ORIGINAL'),
    ('family_relationship_type', 'Relationship', False,
     'Choose Amends, Clarifies, Supersedes or Repeals. The Author assigns a Reviewer and Final Approver when loading Drafts.', 'Amends'),
    ('family_effective_from', 'Relationship effective date', False,
     'Enter the date the relationship takes effect as an Excel date, DD/MM/YYYY or YYYY-MM-DD.', '01/11/2026'),
]
FAMILY_FIELDS = frozenset(field[0] for field in FIELDS[-3:])
HIERARCHY_FIELDS = [
    ('source_chapter', 'Chapter', False, 'Repeat the source chapter heading on each row in its branch.', 'Chapter I - Preliminary'),
    ('source_section', 'Section', False, 'Repeat the section heading if the source has one.', 'C. Definitions'),
    ('source_paragraph', 'Paragraph', False, 'Enter the source paragraph number as text, for example 4.', '4'),
    ('source_subparagraph', 'Subparagraph', False, 'Enter the source subparagraph label as text, for example (1).', '(1)'),
    ('source_item', 'Item', False, 'Enter the source item label as text, for example (i).', '(i)'),
]
CLAUSE_FIELDS = [
    ('import_reference', 'Import reference', True, 'Match the Regulatory records row, for example REG-001.', 'REG-001'),
    *HIERARCHY_FIELDS,
    ('heading', 'Clause heading', True, 'Heading for this source clause / para.', 'Customer identification'),
    ('source_page_reference', 'Source page reference', True, 'Identify the pages in the attached authoritative source.', 'Page 5'),
    ('clause_text', 'Original regulatory text', True, 'Copy the original wording. Excel cells support up to 32,767 characters; never truncate source wording.', 'Illustrative original wording; replace with actual source text.'),
    ('internal_interpretation', "Bank’s internal interpretation", False, 'Keep the bank interpretation separate from the original regulatory wording.', ''),
    ('clause_import_reference', 'Clause import reference', False, 'Keep an existing row reference, or leave blank when using hierarchy columns. Required for explicit parent-link imports.', 'C1'),
    ('source_edition', 'Source edition', False, 'Leave blank to inherit the record edition, or enter the same edition as text. Cross-edition parents are not allowed.', '1.0'),
    ('parent_import_reference', 'Parent clause reference', False, 'For explicit parent links, use a reference from this record and edition. Leave blank when using hierarchy columns.', ''),
    ('source_clause_reference', 'Source clause / para number', False, 'For explicit parent links, copy numbering exactly as text, including 5.10. Leave blank when using hierarchy columns.', '5'),
    *[(key, label, False, 'Optional Yes or No. Blank means ' + default + '.', default)
      for key, label, default in [('mandatory_flag', 'Mandatory', 'Yes'), ('conditional_flag', 'Conditional', 'No'),
          ('reporting_flag', 'Reporting', 'No'), ('disclosure_flag', 'Disclosure', 'No'), ('retention_flag', 'Record retention', 'No')]],
]
GUIDE_REFRESH_ROW = 15 + len(FIELDS) + len(CLAUSE_FIELDS)
LABELS = {key: label for key, label, *_ in FIELDS}
LABELS.update({key: label for key, label, *_ in CLAUSE_FIELDS})
ALIASES = {label.casefold(): key for key, label, *_ in FIELDS}
ALIASES.update({label.casefold(): key for key, label, *_ in CLAUSE_FIELDS})
ALIASES.update({'primary domain': 'domain_code', 'keywords': 'keywords',
                'source clause / para number': 'source_clause_reference',
                'source clause number': 'source_clause_reference',
                'other affected domains': 'additional_domain_codes',
                'additional domains': 'additional_domain_codes',
                'secondary domains': 'additional_domain_codes',
                'secondary domain codes': 'additional_domain_codes',
                'secondary_domain_ids': 'additional_domain_codes'})
LABELS['source_clause_reference'] = 'Source clause / para number'


def canonical_header(value):
    label = str(value or '').strip().rstrip('*').strip().casefold()
    return ALIASES.get(label, label)


def import_date(value):
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        for pattern in ('%d/%m/%Y', '%d-%m-%Y'):
            try:
                return datetime.strptime(value, pattern).date()
            except ValueError:
                continue
        raise ValueError('Use DD/MM/YYYY or YYYY-MM-DD.') from None


def csv_template():
    output = io.StringIO(newline='')
    csv.writer(output).writerow([label for _, label, *_ in FIELDS])
    return '\ufeff' + output.getvalue()
