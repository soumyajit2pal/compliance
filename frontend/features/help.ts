import { state } from '../core/state.ts';
import { empty, esc, link } from '../ui/components.ts';
import { icon } from '../ui/icons.ts';
import { canNavigate, heading } from '../ui/layout.ts';
import { searchForm, tabs } from '../ui/widgets.ts';
import { helpQuestions, helpTopics, roleHelp, type HelpLink, type HelpTopic } from './help-content.ts';

type HelpTab = 'guide' | 'roles' | 'troubleshooting';
type IndexItem = { id: string; title: string; icon: string; detail?: string };

const shortcuts = [
  {label: 'My tasks', path: 'tasks', permissions: ['tasks'], icon: 'checkSquare', detail: 'See work and responses assigned to you'},
  {label: 'My decisions', path: 'approvals', permissions: ['approvals'], icon: 'shield', detail: 'Open your review and approval queue'},
  {label: 'Regulatory library', path: 'repository', permissions: ['repository'], icon: 'book', detail: 'Find a notification, its clauses and progress'},
  {label: 'Users & access', path: 'users', permissions: ['users'], icon: 'users', detail: 'Review profiles and manage role scope'},
  {label: 'Approval Workflow Log', path: 'approval-workflow-log', permissions: ['approval-workflow-log'], icon: 'activity', detail: 'Find actions and decisions within your scope'},
];

function available(destination: HelpLink) {
  return destination.permissions.every(canNavigate) && (!destination.role || state.identity.roles.includes(destination.role));
}

function helpPath(tab: HelpTab, topic?: string) {
  const query = new URLSearchParams(tab === 'guide' ? undefined : {tab});
  if (topic) query.set('topic', topic);
  return query.size ? 'help?' + query : 'help';
}

function quickLinks() {
  const destinations = shortcuts.filter(available);
  if (!destinations.length) return '';
  return `<nav class="help-shortcuts" aria-label="Common actions">
    ${destinations.map(item => `<a href="#${esc(item.path)}">${icon(item.icon)}<span><strong>${esc(item.label)}</strong><small>${esc(item.detail)}</small></span>${icon('arrow')}</a>`).join('')}
  </nav>`;
}

function contents(items: IndexItem[], selected: string, tab: HelpTab, label: string) {
  const nav = `<nav aria-label="${esc(label)}">${items.map(item =>
    `<a href="#${esc(helpPath(tab, item.id))}"${item.id === selected ? ' aria-current="page"' : ''}>
      ${icon(item.icon)}<span>${esc(item.title)}${item.detail ? `<small>${esc(item.detail)}</small>` : ''}</span></a>`).join('')}</nav>`;
  return `<aside class="help-contents" aria-label="${esc(label)}">
    <div class="help-desktop-contents"><h2>${esc(label)}</h2>${nav}</div>
    <details class="help-mobile-contents"><summary>${esc(label)} ${icon('down')}</summary>${nav}</details>
  </aside>`;
}

function topicArticle(topic: HelpTopic, showLinks = true) {
  const destinations = showLinks ? topic.links.filter(available) : [];
  const definitions = topic.definitions;
  return `<article class="help-article">
    <header class="help-article-header"><span class="help-topic-icon">${icon(topic.icon)}</span><div>
      <h2>${esc(topic.title)}</h2><p>${esc(topic.summary)}</p></div></header>
    <p class="help-audience"><strong>Who it’s for</strong> ${esc(topic.audience)}</p>
    ${definitions ? `<section class="help-definitions"><h3>${esc(definitions.heading)}</h3><dl>${definitions.entries.map(([term, definition]) =>
      `<dt>${esc(term)}</dt><dd>${esc(definition)}</dd>`).join('')}</dl></section>` : ''}
    <ol class="help-instructions" role="list">${topic.steps.map(([label, description], index) =>
      `<li><span aria-hidden="true">${index + 1}</span><div><h3>${esc(label)}</h3><p>${esc(description)}</p></div></li>`).join('')}</ol>
    <div class="help-outcome"><h3>What happens next</h3><p>${esc(topic.outcome)}</p></div>
    ${topic.example ? `<div class="help-example"><h3>Example</h3><p>${esc(topic.example)}</p></div>` : ''}
    ${destinations.length ? `<div class="help-article-links" aria-label="Related screens">${destinations.map(item => link(item.path, item.label, 'btn')).join('')}</div>` : ''}
  </article>`;
}

function roleArticle(role: typeof roleHelp[number], showLink = true) {
  return `<article class="help-article">
    <header class="help-article-header"><span class="help-topic-icon">${icon('users')}</span><div>
      <h2>${esc(role.title)}</h2>${showLink && state.identity.roles.includes(role.code) ? '<p>Assigned to you</p>' : ''}</div></header>
    <div class="help-role-duty"><h3>What you do</h3><p>${esc(role.duty)}</p><h3>When you can act</h3><p>${esc(role.limit)}</p></div>
    ${showLink ? `<div class="help-outcome"><h3>How access works</h3><p>Your approved roles define what you can do. Organisation scope defines which records you can reach. The workflow stage and named assignment determine who can act on a particular record.</p></div>
      <div class="help-article-links">${link(helpPath('guide', role.topic), 'Read workflow steps', 'btn')}</div>` : ''}
  </article>`;
}

function troubleshooting(selected?: string, print = false) {
  return `<section class="help-article help-questions"><header class="help-article-header"><span class="help-topic-icon">${icon('info')}</span><div>
    <h2>Troubleshooting</h2><p>Check what is blocking your next step.</p></div></header>
    <div class="help-question-list">${helpQuestions.map(question => `<details${print || question.id === selected ? ' open' : ''}>
      <summary>${esc(question.title)}${icon('down')}</summary><p>${esc(question.answer)}</p></details>`).join('')}</div>
    <div class="help-outcome"><h3>What to include when asking for help</h3><p>Share the screen name, full record reference, current stage, time, attempted action and exact message. Include a request reference if the portal shows one. Mask credentials and personal information in screenshots.</p></div>
  </section>`;
}

const searchEntries = [
  ...helpTopics.map(topic => ({tab: 'guide' as const, id: topic.id, title: topic.title, summary: topic.summary, icon: topic.icon,
    text: [topic.audience, topic.keywords, topic.outcome, topic.example, ...topic.steps.flat(), ...(topic.definitions?.entries.flat() ?? [])].join(' ')})),
  ...roleHelp.map(role => ({tab: 'roles' as const, id: role.code, title: role.title, summary: role.duty, icon: 'users', text: `${role.code} ${role.limit}`})),
  ...helpQuestions.map(item => ({tab: 'troubleshooting' as const, id: item.id, title: item.title, summary: item.answer, icon: 'info', text: item.keywords})),
];
const searchLabels: Record<HelpTab, string> = {guide: 'Workflow', roles: 'Role', troubleshooting: 'Troubleshooting'};
const searchWords = (value: string) => value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

function searchResults(query: string, tab: HelpTab) {
  const terms = searchWords(query);
  const results = terms.length ? searchEntries.filter(item => {
    const text = searchWords(`${item.title} ${item.summary} ${item.text}`).join(' ');
    return terms.every(word => text.includes(word));
  }) : [];
  // Give direct topic names priority while retaining matches in the instructions.
  const titleMatches = (title: string) => terms.filter(word => searchWords(title).join(' ').includes(word)).length;
  results.sort((a, b) => titleMatches(b.title) - titleMatches(a.title));
  return `<section class="help-article help-search-results" aria-label="Search results">
    <div class="help-results-header"><h2>${results.length} ${results.length === 1 ? 'result' : 'results'} for “${esc(query)}”</h2>
      ${link(helpPath(tab), 'Clear search', 'btn small')}</div>
    ${results.length ? `<ul>${results.map(item => `<li><a href="#${esc(helpPath(item.tab, item.id))}">
      <span class="help-topic-icon">${icon(item.icon)}</span><span><strong>${esc(item.title)}</strong><small>${esc(searchLabels[item.tab])}</small><p>${esc(item.summary)}</p></span>${icon('arrow')}</a></li>`).join('')}</ul>`
    : empty('No help topics match', 'Try a page name, a role or an error code such as 403.')}
  </section>`;
}

export function renderHelp(_id, query = new URLSearchParams()) {
  const tab = query.get('tab') === 'roles' ? 'roles' : query.get('tab') === 'troubleshooting' ? 'troubleshooting' : 'guide';
  const selected = query.get('topic');
  const search = (query.get('q') || '').trim();
  const assigned = new Set(state.identity.roles);
  let body: string;
  if (search) body = searchResults(search, tab);
  else if (tab === 'roles') {
    const roles = [...roleHelp].sort((a, b) => Number(assigned.has(b.code)) - Number(assigned.has(a.code)));
    const current = roles.find(role => role.code === selected) || roles[0];
    const index = roles.map(role => ({id: role.code, title: role.title, icon: 'users', detail: assigned.has(role.code) ? 'Assigned to you' : undefined}));
    body = `<div class="help-layout">${contents(index, current.code, tab, 'Roles')}${roleArticle(current)}</div>`;
  } else if (tab === 'troubleshooting') body = troubleshooting(selected);
  else {
    const current = helpTopics.find(topic => topic.id === selected) || helpTopics[0];
    body = `${current === helpTopics[0] ? quickLinks() : ''}<div class="help-layout">${contents(helpTopics, current.id, tab, 'Guide contents')}${topicArticle(current)}</div>`;
  }

  return `<div class="runtime-help">${heading('Help & workflow guide', 'Find the steps for your task, who acts next and what to check when you get stuck.',
    `<button type="button" class="btn" data-action="print-guide">${icon('file')}Print guide</button>`)}
    <div class="help-screen">
      <div class="help-search-box">
        <h2>Find help</h2>
        ${searchForm('view-filter', 'Search the guide', search, '<input type="hidden" name="topic" value="">')}
        <p>Try “return for correction”, “Check Owner” or “403”.</p>
      </div>
      ${tabs([['guide', 'Step-by-step help'], ['roles', 'Roles & responsibilities'], ['troubleshooting', 'Troubleshooting']], tab, 'help')}
      ${body}
    </div>
    <div class="help-print">${helpTopics.map(topic => topicArticle(topic, false)).join('')}
      <h2>Roles &amp; responsibilities</h2>${roleHelp.map(role => roleArticle(role, false)).join('')}${troubleshooting(undefined, true)}</div>
  </div>`;
}
