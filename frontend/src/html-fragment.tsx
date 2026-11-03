import { createElement, useMemo, type CSSProperties, type ReactNode } from 'react';
import { SearchableSelectField } from './components/searchable-select';
import { PaginatedCollection } from './components/paginated-collection';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ObligationWorkspace } from './components/obligation-workspace';

const attributeNames: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  autofocus: 'autoFocus',
  autocomplete: 'autoComplete',
  maxlength: 'maxLength',
  minlength: 'minLength',
  novalidate: 'noValidate',
  formnovalidate: 'formNoValidate',
  autocapitalize: 'autoCapitalize',
  spellcheck: 'spellCheck',
  viewbox: 'viewBox',
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
};

const booleanAttributes = new Set([
  'checked',
  'disabled',
  'hidden',
  'multiple',
  'required',
  'readonly',
  'autofocus',
  'open',
  'novalidate',
  'formnovalidate',
]);

function toStyle(value: string): CSSProperties {
  const style: Record<string, string> = {};
  for (const declaration of value.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    const rawName = declaration.slice(0, separator).trim();
    const rawValue = declaration.slice(separator + 1).trim();
    if (!rawName || !rawValue) continue;
    const name = rawName.startsWith('--')
      ? rawName
      : rawName.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    style[name] = rawValue;
  }
  return style as CSSProperties;
}

function propsFor(element: Element): Record<string, unknown> {
  const tag = element.tagName.toLowerCase();
  const props: Record<string, unknown> = {};
  for (const attribute of Array.from(element.attributes)) {
    const rawName = attribute.name.toLowerCase();
    if (rawName === 'selected') continue;
    const name = attributeNames[rawName] ?? rawName;
    if (rawName === 'style') {
      props.style = toStyle(attribute.value);
    } else if (rawName === 'checked' && tag === 'input') {
      props.defaultChecked = true;
    } else if (booleanAttributes.has(rawName)) {
      props[name] = true;
    } else if (rawName === 'value' && tag === 'input') {
      props.defaultValue = attribute.value;
    } else {
      props[name] = attribute.value;
    }
  }

  if (tag === 'select') {
    const selected = Array.from(element.querySelectorAll('option[selected]')).map(
      (option) => option.getAttribute('value') ?? option.textContent ?? '',
    );
    if (selected.length) props.defaultValue = element.hasAttribute('multiple') ? selected : selected[0];
  }
  if (tag === 'textarea') props.defaultValue = element.textContent ?? '';
  return props;
}

function nodeToReact(node: Node, key: string, replacement?: {target: Element; children: ReactNode[]}): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element)) return null;
  const tag = node.tagName.toLowerCase();
  if (tag === 'script' || tag === 'style') return null;
  if (node.hasAttribute('data-obligation-workspace')) return createElement(ObligationWorkspace, {key, ...JSON.parse(node.getAttribute('data-obligation-workspace'))});
  if (node.hasAttribute('data-paged-collection')) {
    const target = node.querySelector('[data-page-items]');
    const info = JSON.parse(node.getAttribute('data-page-info'));
    const children = Array.from(target.childNodes).filter(child => child.nodeType !== Node.TEXT_NODE || child.textContent.trim())
      .map((child, i) => nodeToReact(child, key + '.item' + i));
    return createElement(PaginatedCollection, {
      key: key + ':' + node.getAttribute('data-page-key') + ':' + node.getAttribute('data-page-scope'),
      pageKey: node.getAttribute('data-page-key'), initial: info,
      revision: node.getAttribute('data-page-revision'), server: node.getAttribute('data-page-server') === '1',
      label: node.getAttribute('data-page-label'), summary: node.getAttribute('data-page-summary') === '1',
      items: info.total ? children : [], empty: info.total ? [] : children,
      renderItems: visible => Array.from(node.childNodes).map((child, i) => nodeToReact(child, key + '.body' + i, {target, children: visible})),
    });
  }
  const children = tag === 'textarea'
    ? []
    : node === replacement?.target ? replacement.children
    : Array.from(node.childNodes).map((child, index) => nodeToReact(child, `${key}.${index}`, replacement));
  if (tag === 'select' && !node.hasAttribute('multiple') && Number(node.getAttribute('size') || 0) <= 1)
    return createElement(SearchableSelectField, { ...propsFor(node), key }, ...children);
  return createElement(tag, { ...propsFor(node), key }, ...children);
}

/** Converts the existing feature templates into React-owned DOM nodes during migration. */
export function HtmlFragment({ markup }: { markup: string }) {
  return useMemo(() => {
    const document = new DOMParser().parseFromString(markup, 'text/html');
    return <>{Array.from(document.body.childNodes).map((node, index) => nodeToReact(node, `${index}`))}</>;
  }, [markup]);
}

/** Keep imperative form fields intact; only display collections become React islands. */
export function mountImperativeCollections(scope: HTMLElement) {
  const markers = Array.from(scope.querySelectorAll<HTMLElement>('[data-paged-collection]'))
    .filter(marker => !marker.parentElement.closest('[data-paged-collection]'));
  const roots = markers.map((marker, index) => {
    // Render from an immutable template: React replaces the live marker's children.
    const content = nodeToReact(marker.cloneNode(true), 'dialog.' + index);
    const root = createRoot(marker);
    flushSync(() => root.render(content));
    return root;
  });
  return () => { for (const root of roots) flushSync(() => root.unmount()); };
}

export function escapeMarkup(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}
