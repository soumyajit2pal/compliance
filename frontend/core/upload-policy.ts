import { state } from './state.ts';
import { esc } from '../ui/components.ts';

const defaults = {source_mib: 20, evidence_mib: 20, workbook_mib: 20, organisation_mib: 2};
type Limit = keyof typeof defaults;

export function fileLimitHint(limit: Limit) {
  return `Up to ${state.identity?.upload_policy?.[limit] ?? defaults[limit]} MiB per file.`;
}

export function documentAccept() {
  return `accept="${esc((state.identity?.upload_policy?.document_extensions ?? ['.pdf', '.txt', '.docx']).join(','))}"`;
}

export function documentHint(limit: 'source_mib' | 'evidence_mib' = 'source_mib') {
  return 'Supported images, PDF, text and macro-free Office files. ' + fileLimitHint(limit);
}

export function canPreviewDocument(fileName: string) {
  const extension = '.' + fileName.split('.').pop()?.toLowerCase();
  return (state.identity?.upload_policy?.preview_extensions ?? ['.pdf', '.txt']).includes(extension);
}
