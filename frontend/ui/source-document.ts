import { esc } from './components.ts';
import { icon } from './icons.ts';

/** Default document reads are attachments; inline preview is an explicit choice. */
export function sourceDocumentUrl(identifier: string, preview = false) {
  return '/api/documents/' + encodeURIComponent(identifier) + (preview ? '?preview=true' : '');
}

export function sourceDocumentDownload(identifier: string, fileName: string, label = 'Download', className = 'text-link source-document-download') {
  return '<a class="' + esc(className) + '" href="' + esc(sourceDocumentUrl(identifier)) + '" download="' + esc(fileName) + '" aria-label="Download ' + esc(fileName) + '">' + icon('download') + '<span>' + esc(label) + '</span></a>';
}

export function sourceDocumentActions(identifier: string, fileName: string) {
  return '<div class="source-document-actions"><button type="button" class="record-summary-link source-document-link" data-action="source-document-preview" data-id="' + esc(identifier) + '" data-name="' + esc(fileName) + '">' + icon('file') + '<span>' + esc(fileName) + '</span></button>' + sourceDocumentDownload(identifier,fileName) + '</div>';
}
