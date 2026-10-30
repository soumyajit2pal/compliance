"""Shared screen labels and field guidance for instrument register imports."""
import csv
import io

RECORDS_SHEET = 'Regulatory records'
GUIDANCE_SHEETS = {'How to fill', 'Example', 'Choices'}
GUIDE_TITLE = 'Import existing regulatory records'
CHOICE_LABELS = ['Regulator', 'Primary regulatory domain', 'Instrument type', 'Materiality',
                 'Confidentiality', 'Regulatory owner department', 'Interpretation owner',
                 'Additional affected domains']
MULTI_VALUE_FIELDS = {'Additional affected domains'}

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
    ('source_document_id', 'Source document ID', True, 'First choose Upload source document in the portal, then copy the Source document ID shown after upload.', 'PASTE THE ID FROM YOUR SOURCE UPLOAD'),
    ('source_record_id', 'Existing register reference', False, 'Optional reference from your existing register, retained with the original row.', 'REGISTER-001'),
    ('additional_domain_codes', 'Additional affected domains', False,
     'Optional. Enter each additional domain name or code from Choices, separated by semicolons. Do not repeat the primary domain.',
     'Fraud Risk Management; Information Technology and Cyber Security'),
]
LABELS = {key: label for key, label, *_ in FIELDS}
ALIASES = {label.casefold(): key for key, label, *_ in FIELDS}
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


def csv_template():
    output = io.StringIO(newline='')
    csv.writer(output).writerow([label for _, label, *_ in FIELDS])
    return '\ufeff' + output.getvalue()
