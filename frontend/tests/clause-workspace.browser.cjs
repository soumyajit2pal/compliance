// Production-bundle UI checks with synthetic API responses; no database access.
// Build first. Supply Playwright through NODE_PATH if it is not installed locally.
const { chromium } = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { searchable } = require('./helpers/searchable-select.cjs');
const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'frontend/dist');
const output = path.resolve(process.env.CBD_CLAUSE_QA_OUTPUT || path.join(require('node:os').tmpdir(), 'cbd-clause-browser'));
const user = { id: 'qa-author', full_name: 'Synthetic QA Author', org_unit_id: 'unit' };
const version = (id, number, status, from, extra = {}) => ({ id, version_number: number,
  approval_status: status, effective_from: from, version_date: from, created_by: user.id,
  source_document_id: id + '-file', ...extra });
const current = version('current', '2.0', 'APPROVED', '2020-01-01', { current_version_flag: 1 });
const history = version('history', '1.0', 'APPROVED', '2000-01-01', { effective_to: '2020-01-01' });
const draft = version('draft', '3.0', 'DRAFT', '2026-01-01');
const future = version('future', '4.0', 'APPROVED', '2999-01-01');
const clause = (id, edition, number, parent, heading, extra = {}) => ({ id, code: 'CLS-QA-' + id,
  instrument_version_id: edition.id, source_clause_reference: number, parent_clause_id: parent,
  heading, clause_text: 'Synthetic source wording for ' + heading,
  internal_interpretation: 'Synthetic interpretation for ' + heading,
  approval_status: edition.approval_status, sequence_number: 1, ...extra });
const instrument = (id, title, currentId = null) => ({ id, title, code: 'INS-QA-' + id,
  current_version_id: currentId, regulatory_owner_unit_id: 'unit', confidentiality_class_id: 'internal',
  primary_domain_id: 'domain', regulator_id: 'regulator', approval_status: 'APPROVED', regulatory_status: 'CURRENT' });
const record = (instrument, versions, clauses) => ({ instrument, versions, clauses,
  source_documents: Object.fromEntries(versions.map(v => [v.source_document_id, 'Synthetic ' + v.id + '.pdf'])),
  linked_obligations: [], clause_relationships: [], secondary_domains: [], tasks: [], audit: [], history: [], comments: [], metadata_corrections: [] });
const records = {
  access: record(instrument('access', 'Access to IT Systems', current.id), [future, draft, current, history], [
    clause('old-five', history, '5', null, 'Historical access rules'),
    clause('new-five', current, '5', null, 'Access controls'),
    clause('new-five-one', current, '5.1', 'new-five', 'User access'),
    clause('new-five-one-one', current, '5.1.1', 'new-five-one', 'Access approval'),
    clause('new-five-ten', current, '5.10', 'new-five', 'Periodic certification'),
    clause('new-five-two', current, '5.2', 'new-five', 'Access review'),
    clause('draft-five-one', draft, '5.1', null, 'Draft without an imported parent'),
    clause('future-five', future, '5', null, 'Future access rules'),
  ]),
  draftonly: record(instrument('draftonly', 'Draft only source'), [version('only-draft', '1.0', 'DRAFT', '2026-01-01')], []),
  empty: record(instrument('empty', 'Empty current source', 'empty-current'),
    [version('empty-current', '2.0', 'APPROVED', '2020-01-01'), history],
    [clause('empty-old', history, '5', null, 'Only historical clauses exist')]),
  futureonly: record(instrument('futureonly', 'Future only source'), [future], [clause('future-only-five', future, '5', null, 'Future-only rule')]),
  noversions: record(instrument('noversions', 'No source editions'), [], []),
  fallback: record(instrument('fallback', 'Fallback approved source', history.id), [draft, history, current], [
    clause('fallback-five', current, '5', null, 'Fallback current rule'),
  ]),
};
// Match real globally unique edition IDs, including copies used by other instruments.
for (const r of Object.values(records)) {
  if (r.instrument.id === 'access') continue;
  const ids = new Map(r.versions.map(v => [v.id, r.instrument.id + '-' + v.id]));
  r.versions = r.versions.map(v => ({ ...v, id: ids.get(v.id) }));
  r.clauses = r.clauses.map(c => ({ ...c, instrument_version_id: ids.get(c.instrument_version_id) }));
  if (r.instrument.current_version_id) r.instrument.current_version_id = ids.get(r.instrument.current_version_id);
}
const cancelled = version('cancelled', '5.0', 'WITHDRAWN', '2026-01-01', { cancelled_draft: true });
records.access.versions.push(cancelled);
records.access.clauses.push(clause('cancelled-five', cancelled, '5', null, 'Cancelled source rule'));
records.access.linked_obligations.push({
  id: 'access-obligation', code: 'OBL-QA-001', title: 'Review privileged access', version_number: 2,
  business_owner_unit_id: 'unit', record_status: 'ACTIVE', approval_status: 'APPROVED',
  citations: [{ clause_id: 'new-five-one', role: 'PRIMARY' }, { clause_id: 'old-five', role: 'SUPPORTING' }],
});
records.draftonly.clauses.push(clause('only-draft-five', records.draftonly.versions[0], '5', null, 'Unapproved rule'));
const bulkEdition = version('bulk-current', '1.0', 'APPROVED', '2020-01-01', { current_version_flag: 1 });
const bulkRoots = Array.from({ length: 64 }, (_, index) =>
  clause('bulk-root-' + index, bulkEdition, String(index + 1), null, 'Shared match root ' + index, { sequence_number: index + 1 }));
const bulkChildren = Array.from({ length: 62 }, (_, index) =>
  clause('bulk-child-' + index, bulkEdition, '1.' + (index + 1), bulkRoots[0].id, 'Shared match child ' + index, { sequence_number: index + 1 }));
const deep = clause('bulk-deep', bulkEdition, '1.62.1', bulkChildren.at(-1).id, 'Deep clause outside the first batch');
records.bulk = record(instrument('bulk', 'Bulk source', bulkEdition.id), [bulkEdition], [...bulkRoots, ...bulkChildren, deep]);
records.bulk.instrument.official_reference_number = 'PUBLICATION-REF-062';
const sourceEditions = () => Object.values(records).flatMap(r => r.versions.map(v => ({ ...v, instrument_id: r.instrument.id })));
const sourceRows = Object.values(records).flatMap(r => r.clauses.map(c => {
  const v = r.versions.find(v => v.id === c.instrument_version_id);
  return { ...c, instrument_id: r.instrument.id, instrument_title: r.instrument.title,
    instrument_code: r.instrument.code, version_number: v.version_number,
    version_approval_status: v.approval_status, version_is_effective_current: v.current_version_flag === 1,
    version_cancelled_draft: v.cancelled_draft, version_effective_from: v.effective_from, version_effective_to: v.effective_to,
    has_children: r.clauses.some(child => child.parent_clause_id === c.id && child.instrument_version_id === v.id),
    parent_code: r.clauses.find(parent => parent.id === c.parent_clause_id)?.code };
}));
const byId = new Map(sourceRows.map(row => [row.id, row]));
const summary = ({ clause_text, internal_interpretation, ...row }) => row;
function ancestors(row) {
  const chain = [];
  for (let parent = byId.get(row.parent_clause_id); parent && parent.instrument_version_id === row.instrument_version_id;
    parent = byId.get(parent.parent_clause_id)) chain.unshift(summary(parent));
  return chain;
}
function response(query) {
  const selectedInstrument = query.get('instrument');
  const selectedEdition = query.get('edition');
  const parent = query.get('parent');
  const search = query.get('mode') === 'search';
  const needle = (query.get('q') || '').toLowerCase();
  const status = query.get('status');
  const page = Number(query.get('page') || '1');
  const rows = sourceRows.filter(row => (selectedInstrument === 'all' || row.instrument_id === selectedInstrument)
    && (selectedEdition === 'all' || (selectedEdition === 'current' ? row.version_is_effective_current : row.instrument_version_id === selectedEdition))
    && (search
      ? (!status || row.approval_status === status) && [row.code, row.heading, row.clause_text].some(value => value.toLowerCase().includes(needle))
      : (row.parent_clause_id || null) === parent));
  return { items: rows.slice((page - 1) * 25, page * 25).map(row =>
    search ? { ...summary(row), parent_path: ancestors(row).map(parent => parent.source_clause_reference) } : summary(row)),
  next_page: rows.length > page * 25 ? page + 1 : null };
}
const checks = [];
const errors = [];
const calls = [];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const file = path.resolve(dist, url.pathname === '/' ? 'index.html' : '.' + url.pathname.replace(/^\/assets/, ''));
    if (!file.startsWith(dist + path.sep)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});

(async () => {
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const pathname = url.pathname.slice(4);
      calls.push({ pathname, query: Object.fromEntries(url.searchParams), method: request.method() });
      let body;
      if (pathname === '/auth/me') body = { user, csrf_token: 'synthetic', environment: 'uat', roles: ['AUTHOR'],
        grants: [{ role_code: 'AUTHOR', global_scope_flag: 1 }], menu: [{ id: 'clauses' }, { id: 'repository' }] };
      else if (pathname === '/masters') body = { organisational_unit: [{ id: 'unit', name: 'QA department' }],
        regulator: [{ id: 'regulator', code: 'QA' }], regulatory_domain: [{ id: 'domain', name: 'QA domain' }] };
      else if (pathname === '/tasks' || pathname === '/notifications') body = [];
      else if (pathname === '/source-editions') body = sourceEditions().filter(row => !url.searchParams.has('instrument') || row.instrument_id === url.searchParams.get('instrument'));
      else if (pathname === '/instruments') body = Object.values(records).map(r => r.instrument);
      else if (pathname.startsWith('/instruments/')) body = records[pathname.split('/')[2]];
      else if (pathname === '/clause-browser') body = response(url.searchParams);
      else if (pathname.startsWith('/clause-browser/')) {
        const row = byId.get(pathname.split('/')[2]);
        if (!row) return route.fulfill({ status: 404, json: { detail: 'Clause not found.' } });
        const edition = sourceEditions().find(v => v.id === row.instrument_version_id);
        body = { clause: row, ancestors: ancestors(row), edition, owner_unit_id: 'unit',
          source_document: { id: edition.source_document_id, name: 'Synthetic source.pdf' } };
      } else throw new Error('Unexpected synthetic API request: ' + pathname);
      await route.fulfill({ json: body });
    });
    let serial = 0;
    const open = hash => page.goto(base + '/?scenario=' + (++serial) + '#' + hash);
    const heading = name => page.getByRole('heading', { name, exact: true });
    const instrumentFilter = page.getByLabel('Instrument', { exact: true });
    const picker = searchable(instrumentFilter);
    const editionFilter = page.getByLabel('Source edition', { exact: true });
    const searchBox = page.getByRole('searchbox', { name: 'Search clauses' });
    const options = page.getByText('Search options', { exact: true });
    const results = page.getByRole('navigation', { name: 'Clause search results' });
    const tree = page.locator('.clause-browser-tree');
    const visibleRows = tree.locator('.clause-tree-node:visible');
    const row = id => tree.locator('[data-clause-row="' + id + '"] > .clause-browser-row a');
    const clauseReads = () => calls.filter(call => call.pathname.startsWith('/clause-browser'));
    const readCount = () => clauseReads().length;
    async function count(expected) {
      await page.waitForFunction(count => [...document.querySelectorAll('.clause-browser-tree .clause-tree-node')]
        .filter(node => node.getClientRects().length).length === count, expected);
    }

    await open('clauses');
    await heading('Find a clause').waitFor();
    assert.equal(await instrumentFilter.inputValue(), 'all');
    assert((await searchBox.boundingBox()).y < (await heading('Browse an instrument').boundingBox()).y);
    assert(!await page.locator('#working-clause-detail').count());
    assert(!await page.locator('.clause-search-panel details').evaluate(el => el.open));
    await page.screenshot({ path: path.join(output, 'clause-search-first.png'), fullPage: true });
    assert.equal(readCount(), 0);
    assert.equal(calls.filter(call => call.pathname === '/source-editions').length, 0);
    await page.getByRole('link', { name: 'Register', exact: true }).click();
    await heading('Clause register').waitFor();
    assert.equal(readCount(), 0);
    await page.getByRole('link', { name: 'Workspace', exact: true }).click();
    await heading('Find a clause').waitFor();
    assert.equal(readCount(), 0);
    assert.equal(calls.filter(call => call.pathname === '/source-editions').length, 0);
    checks.push('Search appears above Browse an instrument, with options collapsed and zero clause or edition reads on Workspace and Register arrival.');

    await picker.input.click();
    assert.equal(await picker.input.getAttribute('placeholder'), 'Find by instrument title or reference');
    await picker.input.fill(records.bulk.instrument.official_reference_number);
    const bulkOption = picker.popup.getByRole('option', { name: 'Bulk source · INS-QA-bulk', exact: true });
    const optionTitle = await bulkOption.locator('.searchable-select-option-title').boundingBox();
    const optionCode = await bulkOption.locator('.searchable-select-option-detail').boundingBox();
    assert(optionTitle && optionCode && optionCode.y >= optionTitle.y + optionTitle.height);
    assert((await picker.popup.boundingBox()).width >= 480);
    assert.equal(readCount(), 0);
    await page.screenshot({ path: path.join(output, 'clause-instrument-picker.png'), fullPage: true });
    await picker.input.press('Enter');
    await count(25);
    assert.equal(await picker.input.inputValue(), 'Bulk source');
    assert.equal(await editionFilter.inputValue(), 'current');
    assert(!await page.locator('#working-clause-detail').count());
    assert.equal(clauseReads().at(-1).query.instrument, 'bulk');
    assert.equal(calls.filter(call => call.pathname === '/source-editions').at(-1).query.instrument, 'bulk');
    await page.getByRole('button', { name: 'Load more top-level clauses', exact: true }).click();
    await count(50);
    await page.getByRole('button', { name: 'Expand children of 1', exact: true }).click();
    await count(75);
    assert.equal(clauseReads().at(-1).query.parent, bulkRoots[0].id);
    await page.getByRole('button', { name: 'Load more children', exact: true }).click();
    await count(100);
    const loaded = readCount();
    await page.getByRole('button', { name: 'Collapse children of 1', exact: true }).click();
    await count(50);
    await page.getByRole('button', { name: 'Expand children of 1', exact: true }).click();
    await count(100);
    assert.equal(readCount(), loaded);
    checks.push('The wider instrument picker shows the reference code below the title, finds an official reference and supports keyboard selection without a clause fetch while typing.');
    checks.push('The selected instrument defaults to its current approved edition. Roots and each branch load 25 at a time, and reopening a loaded branch makes no request.');

    const beforeDeep = readCount();
    await open('clauses?clause=' + deep.id);
    await heading(deep.heading).waitFor();
    await row(deep.id).waitFor();
    assert.equal(await instrumentFilter.inputValue(), 'bulk');
    assert.equal(await editionFilter.inputValue(), bulkEdition.id);
    assert.equal(await visibleRows.count(), 27);
    assert.equal(await row(deep.id).getAttribute('aria-current'), 'true');
    assert.equal(await page.getByRole('navigation', { name: 'Clause path' }).getByRole('link').count(), 2);
    assert((await tree.boundingBox()).x < (await page.locator('#working-clause-detail').boundingBox()).x);
    assert.equal(readCount() - beforeDeep, 2);
    assert.equal(clauseReads().filter(call => call.query.parent === bulkChildren.at(-1).id).length, 0);
    assert(await page.getByRole('button', { name: 'Source document', exact: true }).isVisible());
    await page.reload();
    await heading(deep.heading).waitFor();
    assert.equal(await row(deep.id).getAttribute('aria-current'), 'true');
    await page.screenshot({ path: path.join(output, 'clause-split-reader.png'), fullPage: true });
    await page.setViewportSize({ width: 320, height: 844 });
    await page.reload();
    await heading(deep.heading).waitFor();
    assert(!await tree.isVisible());
    assert(await page.getByText('Original regulatory text', { exact: true }).isVisible());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(output, 'clause-deep-link-mobile.png'), fullPage: true });
    await page.getByText('Change instrument or edition', { exact: true }).click();
    await picker.input.click();
    await picker.input.fill('INS-QA-bulk');
    await bulkOption.waitFor();
    const mobilePopup = await picker.popup.boundingBox();
    assert(mobilePopup.x >= 0 && mobilePopup.x + mobilePopup.width <= 320);
    await picker.input.press('Escape');
    await page.getByText('Instrument & clause hierarchy', { exact: true }).click();
    await row(deep.id).waitFor();
    await page.setViewportSize({ width: 1440, height: 1050 });
    checks.push('A deep clause opens a split reader with exact text and linked ancestors, using two bounded reads. At 320px the hierarchy collapses by default and the picker stays within the viewport.');

    await open('clauses?view=register');
    await heading('Clause register').waitFor();
    await searchBox.fill('Shared match');
    await options.click();
    await page.getByLabel('Search type', { exact: true }).selectOption('phrase');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const table = page.getByRole('table', { name: 'Authorised source clauses and Para' });
    await table.waitFor();
    assert.equal(await table.locator('tbody tr').count(), 25);
    assert.equal(clauseReads().at(-1).query.instrument, 'all');
    assert.equal(clauseReads().at(-1).query.mode, 'search');
    assert.equal(clauseReads().at(-1).query.search_type, 'phrase');
    assert(!await page.getByText('Original regulatory text', { exact: true }).count());
    await page.getByRole('link', { name: 'Next results', exact: true }).click();
    await page.getByText('Page 2', { exact: true }).waitFor();
    assert.equal(await table.locator('tbody tr').count(), 25);
    await table.getByRole('link', { name: /Shared match root 25/ }).click();
    await heading('Shared match root 25').waitFor();
    assert.deepEqual(clauseReads().at(-1).query, { instrument: 'bulk', edition: 'bulk-current' });
    assert(await tree.isVisible());
    assert(await page.getByText('Original regulatory text', { exact: true }).isVisible());
    await page.getByRole('button', { name: 'Load more top-level clauses', exact: true }).click();
    await row('bulk-root-49').waitFor();
    assert.deepEqual(clauseReads().at(-1).query, { instrument: 'bulk', edition: 'bulk-current', page: '2' });
    await page.getByRole('link', { name: 'Back to results', exact: true }).click();
    await table.waitFor();
    assert(await page.getByText('Page 2', { exact: true }).isVisible());
    assert.equal(await searchBox.inputValue(), 'Shared match');
    assert.equal(await page.getByLabel('Search type', { exact: true }).inputValue(), 'phrase');
    await page.getByRole('link', { name: 'Workspace', exact: true }).click();
    await results.getByRole('link', { name: /Shared match root 25/ }).click();
    await heading('Shared match root 25').waitFor();
    await page.getByRole('link', { name: 'Back to results', exact: true }).click();
    await results.waitFor();
    assert(await page.getByText('Page 2', { exact: true }).isVisible());
    checks.push('Workspace and Register return 25 matches per page. Opening a result switches to the exact source hierarchy and Back to results restores the originating view, phrase and page.');

    const beforeInvalidLiteral = readCount();
    await open('clauses?search_type=literal&q=atch+roo');
    await page.getByText(/Choose a specific source edition to use Exact wording/).waitFor();
    assert.equal(readCount(), beforeInvalidLiteral);
    await open('clauses?instrument=bulk&edition=bulk-current');
    await count(25);
    await options.click();
    await page.getByLabel('Search type', { exact: true }).selectOption('literal');
    await page.getByRole('searchbox', { name: 'Search clauses' }).fill('atch roo');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('navigation', { name: 'Clause search results' }).waitFor();
    assert.equal(clauseReads().at(-1).query.edition, bulkEdition.id);
    assert.equal(clauseReads().at(-1).query.search_type, 'literal');
    checks.push('Exact wording only reaches the API after selecting one specific source edition.');

    await open('clauses?instrument=draftonly');
    await page.getByText(/No approved source edition is effective today/).waitFor();
    assert.equal(await visibleRows.count(), 0);
    await editionFilter.selectOption('draftonly-only-draft');
    await row('only-draft-five').click();
    await heading('Unapproved rule').waitFor();
    assert(await page.getByRole('button', { name: 'Edit Draft clause', exact: true }).isVisible());
    await open('clauses?version=history');
    await row('old-five').waitFor();
    assert.equal(await instrumentFilter.inputValue(), 'access');
    assert.equal(await editionFilter.inputValue(), 'history');
    await open('clauses?clause=not-visible');
    await page.getByText('The requested clause is unavailable in your authorised area.', { exact: true }).waitFor();
    checks.push('A missing current approval stays empty, Draft is selectable and editable by its maker, and legacy edition links and unavailable clauses resolve clearly.');

    await open('repository/access?tab=clauses');
    await page.waitForFunction(() => document.getElementById('selected-source')?.value === 'current');
    assert.equal(await page.locator('.clause-hierarchy .clause-tree-node').count(), 5);
    await page.locator('#selected-source').selectOption('history');
    await heading('Historical access rules').waitFor();
    const tabs = page.getByRole('navigation', { name: 'Page sections', exact: true });
    await tabs.getByRole('link', { name: 'Obligations 1', exact: true }).click();
    await page.getByRole('table', { name: 'Linked obligation revisions' }).waitFor();
    assert.equal(await page.locator('#selected-source').inputValue(), 'history');
    assert.equal(await page.getByRole('link', { name: '5 · Edition 1.0' }).getAttribute('href'),
      '#repository/access?tab=clauses&clause=old-five&version=history');
    await open('repository/draftonly?tab=obligations');
    await heading('No linked obligations').waitFor();
    checks.push('The instrument-specific Clauses and Obligations tabs retain edition-pinned navigation and empty states.');

    assert.deepEqual(errors, []);
    assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
    assert.equal(calls.filter(call => call.pathname === '/clauses').length, 0);
    assert.equal(calls.filter(call => call.pathname === '/instruments/bulk').length, 0);
    checks.push('No browser errors, writes, legacy clause catalogue requests or full instrument detail reads for the bulk source.');
    await fs.writeFile(path.join(output, 'browser-validation.json'), JSON.stringify({
      checked_at: new Date().toISOString(), evidence: 'Production bundle with synthetic API responses', checks,
    }, null, 2) + '\n');
    console.log('Passed ' + checks.length + ' browser groups.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
