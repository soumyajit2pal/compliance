import { createElement, type CSSProperties, type ReactNode } from 'react';
import { SearchableSelectField } from './components/searchable-select';

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
  'download',
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

function nodeToReact(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element)) return null;
  const tag = node.tagName.toLowerCase();
  if (tag === 'script' || tag === 'style') return null;
  const children = tag === 'textarea'
    ? []
    : Array.from(node.childNodes).map((child, index) => nodeToReact(child, `${key}.${index}`));
  if (tag === 'select' && !node.hasAttribute('multiple') && Number(node.getAttribute('size') || 0) <= 1)
    return createElement(SearchableSelectField, { ...propsFor(node), key }, ...children);
  return createElement(tag, { ...propsFor(node), key }, ...children);
}

/** Converts the existing feature templates into React-owned DOM nodes during migration. */
export function HtmlFragment({ markup }: { markup: string }) {
  const document = new DOMParser().parseFromString(markup, 'text/html');
  return <>{Array.from(document.body.childNodes).map((node, index) => nodeToReact(node, `${index}`))}</>;
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
