// Exercise the production bundle against deterministic, read-only API responses.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const dist = path.resolve(__dirname, '../dist');
const origin = 'http://127.0.0.1:8011';
const menus = ['home', 'repository', 'masters', 'audit-trail', 'approval-workflow-log'];
const id = { user: { id: 'admin', full_name: 'Test Administrator', username: 'admin', login_type: 'STANDARD' },
  environment: 'uat', roles: ['ADMIN'], grants: [], menu: menus.map(id => ({ id, label: id })) };
const format = value => String(value).padStart(3, '0');
const longReference = 'Long regulatory reference ' + 'ABC0123456789'.repeat(14);
const choiceValue = label => {
  const value = String(label).toLowerCase();
  return value.length > 160 ? 'sha256:' + createHash('sha256').update(value).digest('hex') : value;
};
const domains = Array.from({ length: 59 }, (_, i) => ({
  id: 'domain-' + i, code: 'DOM-' + format(i), name: 'Test domain ' + format(i), active_flag: 1, effective_from: '2020-01-01',
}));
const instruments = domains.map((domain, i) => ({
  id: domain.id, code: 'INS-' + format(i), title: 'Test library record ' + format(i),
  official_reference_number: i === 56 ? longReference : 'REF-' + format(i),
  regulator_name: 'Test regulator', domain_name: domain.name, materiality: 'HIGH', regulatory_status: 'CURRENT', approval_status: 'APPROVED',
}));
const entries = domains.map((domain, i) => ({
  id: 'audit-' + i, when: '2026-11-' + (21 - Math.floor(i / 20)) + 'T12:00:00Z',
  local_day: (21 - Math.floor(i / 20)) + ' Nov 2026', actor: 'Operator ' + format(i), event: 'API read', group: 'API access',
  record_type: 'Portal request', record_id: 'request-' + i, request_method: 'GET', request_route: '/api/masters',
  changes: [], outcome: 'Success', http_status: 200, client_ip: '192.0.2.' + (i + 1),
}));
const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
function filteredRows(rows, params, columns, pageResult) {
  const filters = JSON.parse(params.get('columns') || '{}');
  const chosen = params.get('options_for');
  const matches = rows.filter(row => Object.entries(filters).every(([key, filter]) => {
    if (key === chosen) return true;
    const value = String(row[columns[key]]).toLowerCase();
    if (typeof filter === 'string') return value.includes(filter.toLowerCase());
    const keyValue = choiceValue(value);
    return Array.isArray(filter.equals) ? filter.equals.includes(keyValue) : keyValue === filter.equals;
  }));
  if (chosen) {
    const labels = [...new Set(matches.map(row => row[columns[chosen]]))];
    return { options: labels.map(label => ({value: choiceValue(label), label})) };
  }
  return pageResult(matches, params);
}
function numberedPage(items, params) {
  const size = Number(params.get('page_size') || 25), pages = Math.ceil(items.length / size);
  const page = Math.min(Number(params.get('page') || 1), pages || 1);
  const start = (page - 1) * size;
  return { items: items.slice(start, start + size), pagination: {
    page, page_size: size, total: items.length, total_pages: pages,
    start: items.length ? start + 1 : 0, end: Math.min(start + size, items.length),
  } };
}
function logPage(items, params) {
  const size = Number(params.get('page_size') || 25);
  const start = Number(params.get('older') || params.get('newer') || 0);
  return { items: items.slice(start, start + size), types: [],
    through: '2026-11-21T12:30:00', total: items.length, end: Math.min(items.length, start + size),
    older: items.length > start + size ? String(start + size) : null,
    newer: start ? String(Math.max(0, start - size)) : null };
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Kolkata' });
    const errors = [], instrumentQueries = [], auditQueries = [];
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => errors.push(error.message));
    const masters = { regulatory_domain: domains, regulator: [], organisational_unit: [], instrument_type: [], obligation_category: [] };
    await page.route(origin + '/**', async route => {
      const { pathname, searchParams } = new URL(route.request().url());
      if (!pathname.startsWith('/api/')) {
        const file = path.join(dist, pathname === '/' ? 'index.html' : pathname.replace(/^\/assets\//, '').replace(/^\//, ''));
        try { return await route.fulfill({ body: await fs.readFile(file), contentType: type[path.extname(file)] || 'application/octet-stream' }); }
        catch { return route.fulfill({ status: 404, body: '' }); }
      }
      let payload = [];
      if (pathname === '/api/auth/me') payload = id;
      if (pathname === '/api/masters') payload = masters;
      if (pathname === '/api/masters/catalogue') payload = [{ key: 'regulatory_domain', label: 'Regulatory domains' }];
      if (pathname === '/api/admin/access-summary') payload = {};
      if (pathname === '/api/instruments') {
        instrumentQueries.push(searchParams);
        payload = filteredRows(instruments, searchParams, { official_reference_number: 'official_reference_number' }, numberedPage);
      }
      if (pathname === '/api/audit-trail') {
        auditQueries.push(searchParams);
        payload = filteredRows(entries, searchParams, { client_ip: 'client_ip', actor: 'actor', when: 'local_day' }, logPage);
      }
      if (pathname === '/api/approval-workflow-log') {
        payload = filteredRows(entries, searchParams, { actor: 'actor', when: 'local_day' }, logPage);
      }
      return route.fulfill({ json: payload });
    });

    async function waitForRange(table, label) {
      try {
        await table.locator('.pagination-range').filter({ hasText: label }).waitFor();
      } catch (error) {
        throw new Error(`Expected ${label}. Browser errors: ${errors.join(' | ')}
${(await page.locator('body').innerText()).slice(0, 1300)}`, {cause: error});
      }
    }
    const trigger = (table, label, applied = false) => table.locator('thead').getByRole('button', {
      name: 'Filter ' + label + (applied ? ' (applied)' : ''), exact: true,
    });
    const popup = label => page.getByRole('dialog', { name: 'Filter ' + label, exact: true });
    const chips = table => table.getByRole('group', { name: 'Applied column filters', exact: true });
    const clearAll = table => chips(table).getByRole('button', { name: 'Clear all', exact: true });
    const clearColumn = (table, column) => chips(table).getByRole('button', {name: 'Clear ' + column + ' filter', exact: true});
    const remove = (table, column, value) => chips(table).getByRole('button', {
      name: 'Remove ' + column + ' filter for ' + value, exact: true,
    });
    const chipList = (table, column) => chips(table).getByRole('list', { name: column, exact: true });
    const toggle = (table, column, label) => chipList(table, column).getByRole('button', {
      name: label + ' for ' + column, exact: true,
    });
    async function openFilter(table, label, applied = false) {
      await trigger(table, label, applied).click();
      const panel = popup(label);
      await panel.waitFor();
      await panel.getByRole('group', {name:label, exact:true}).getByRole('checkbox').first().waitFor();
      await panel.getByRole('searchbox', {name:'Search values', exact:true}).waitFor();
      return panel;
    }

    await page.goto(origin + '/#masters?tab=domains');
    const local = page.locator('.paged-collection').first();
    await waitForRange(local, 'Showing 1–25 of 59 records');
    await local.getByRole('link', { name: 'Next page' }).click();
    await waitForRange(local, 'Showing 26–50 of 59 records');
    assert.equal(await local.getByRole('link', { name: 'Next page' }).textContent(), 'Next');
    const code = await openFilter(local, 'Code');
    assert(await code.evaluate(node => node === document.activeElement));
    await code.getByRole('checkbox', {name:'DOM-057', exact:true}).check();
    await code.getByRole('searchbox').fill(' dom-058 ');
    assert.equal(await code.getByRole('checkbox', {name:'DOM-057', exact:true}).count(), 0);
    await code.getByRole('checkbox', {name:'Select all matches', exact:true}).check();
    await code.getByText('2 selected', {exact:true}).waitFor();
    await code.getByRole('button', { name: 'Apply', exact: true }).click();
    await waitForRange(local, 'Showing 1–2 of 2 records');
    await trigger(local, 'Code', true).waitFor();
    assert.equal(await local.locator('tbody tr').count(), 2);
    const codeChips = chips(local).getByRole('list', {name:'Code', exact:true});
    assert.equal(await codeChips.getByRole('listitem').count(), 2);
    assert.equal(await chips(local).getByText('Code', {exact:true}).count(), 1);
    assert(await chips(local).evaluate(list => list.compareDocumentPosition(list.parentElement.querySelector('table')) & Node.DOCUMENT_POSITION_FOLLOWING));

    const domain = await openFilter(local, 'Regulatory domains');
    assert.equal(await domain.getByRole('group', {name:'Regulatory domains', exact:true}).getByRole('checkbox').count(),
      2, 'The Code filter narrows other dropdowns');
    await domain.getByRole('checkbox', {name:'Test domain 058', exact:true}).check();
    await domain.getByRole('button', { name: 'Apply', exact: true }).click();
    await waitForRange(local, 'Showing 1–1 of 1 records');
    await remove(local, 'Code', 'DOM-057').click();
    assert.equal(await chips(local).getByRole('listitem').count(), 2);
    await remove(local, 'Regulatory domains', 'Test domain 058').waitFor();
    await page.goBack();
    await remove(local, 'Code', 'DOM-057').waitFor();
    const appliedDomain = await openFilter(local, 'Regulatory domains', true);
    await appliedDomain.getByRole('button', { name: 'Clear', exact: true }).click();
    await waitForRange(local, 'Showing 1–2 of 2 records');
    await trigger(local, 'Code', true).waitFor();

    const appliedCode = await openFilter(local, 'Code', true);
    const codeSearch = appliedCode.getByRole('searchbox');
    await codeSearch.fill('dom-05');
    const bulkCode = appliedCode.getByRole('checkbox', {name:'Select all matches', exact:true});
    assert(await bulkCode.evaluate(input => input.indeterminate));
    await bulkCode.check();
    await appliedCode.getByText('9 selected', {exact:true}).waitFor();
    await codeSearch.fill('no matching code');
    await appliedCode.getByText('No matching values', {exact:true}).waitFor();
    assert(await bulkCode.isDisabled());
    await codeSearch.fill('dom-05');
    await bulkCode.uncheck();
    await appliedCode.getByText('0 selected', {exact:true}).waitFor();
    await page.keyboard.press('Escape');
    await appliedCode.waitFor({ state: 'hidden' });
    await waitForRange(local, 'Showing 1–2 of 2 records');
    assert(await trigger(local, 'Code', true).evaluate(node => node === document.activeElement));
    await clearAll(local).click();
    await waitForRange(local, 'Showing 1–25 of 59 records');
    assert.equal(await chips(local).count(), 0);
    assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('tab'), 'domains');

    const allCodes = await openFilter(local, 'Code');
    await allCodes.getByRole('checkbox', {name:'Select all', exact:true}).check();
    await allCodes.getByText('59 selected', {exact:true}).waitFor();
    await allCodes.getByRole('button', {name:'Apply', exact:true}).click();
    await waitForRange(local, 'Showing 1–25 of 59 records');
    assert.equal(await trigger(local, 'Code', true).count(), 0);

    const manyCodes = await openFilter(local, 'Code');
    await manyCodes.getByRole('searchbox').fill('dom-05');
    await manyCodes.getByRole('checkbox', {name:'Select all matches', exact:true}).check();
    await manyCodes.getByRole('button', {name:'Apply', exact:true}).click();
    await waitForRange(local, 'Showing 1–9 of 9 records');
    assert.equal(await chipList(local, 'Code').getByRole('listitem').count(), 3);
    await toggle(local, 'Code', '+6 more').click();
    assert.equal(await chipList(local, 'Code').getByRole('listitem').count(), 9);
    await remove(local, 'Code', 'DOM-058').click();
    await waitForRange(local, 'Showing 1–8 of 8 records');
    assert.equal(await chipList(local, 'Code').getByRole('listitem').count(), 8);
    await toggle(local, 'Code', 'Show less').click();
    await toggle(local, 'Code', '+5 more').waitFor();
    await clearColumn(local, 'Code').click();
    await waitForRange(local, 'Showing 1–25 of 59 records');
    assert.equal(await chips(local).count(), 0);

    await openFilter(local, 'Code');
    await local.locator('thead').getByText('Status', { exact: true }).click();
    await popup('Code').waitFor({ state: 'hidden' });

    const localKey = await local.getAttribute('data-pagination-key');
    const legacyFilter = new URLSearchParams({tab:'domains', ['col.' + localKey + '.code']:'dom-0', ['page.' + localKey]:'2'});
    await page.goto(origin + '/#masters?' + legacyFilter);
    await waitForRange(local, 'Showing 26–50 of 59 records');
    await clearColumn(local, 'Code').focus();
    await page.keyboard.press('Enter');
    await waitForRange(local, 'Showing 1–25 of 59 records');
    assert.equal(await chips(local).count(), 0);

    await page.goto(origin + '/#repository');
    const register = page.locator('[data-pagination-key="instruments"]');
    await waitForRange(register, 'Showing 1–25 of 59 records');
    const reference = await openFilter(register, 'Official reference number');
    await reference.getByRole('checkbox', {name:longReference, exact:true}).check();
    await reference.getByRole('checkbox', {name:'REF-057', exact:true}).check();
    await reference.getByRole('checkbox', {name:'REF-058', exact:true}).check();
    assert.equal(instrumentQueries.at(-1).get('options_for'), 'official_reference_number');
    await reference.getByRole('button', { name: 'Apply', exact: true }).click();
    await waitForRange(register, 'Showing 1–3 of 3 records');
    assert.deepEqual(JSON.parse(instrumentQueries.at(-1).get('columns')), {
      official_reference_number: {equals:[choiceValue(longReference), 'ref-057', 'ref-058']},
    });
    await page.setViewportSize({ width: 320, height: 850 });
    await remove(register, 'Official reference number', longReference).waitFor();
    assert(await chips(register).evaluate(group =>
      [...group.querySelectorAll('li, button')].every(control => control.getBoundingClientRect().right <= innerWidth)));
    await remove(register, 'Official reference number', longReference).click();
    await waitForRange(register, 'Showing 1–2 of 2 records');
    assert.deepEqual(JSON.parse(instrumentQueries.at(-1).get('columns')), { official_reference_number: {equals:['ref-057','ref-058']} });
    assert.equal(instrumentQueries.at(-1).get('page'), '1');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(origin + '/#audit-trail?audit_outcome=success');
    const audit = page.locator('[data-pagination-key="audit-trail"]');
    await waitForRange(audit, 'Showing 25 of 59 entries');
    assert.equal(await audit.getByRole('link', { name: 'Next page' }).textContent(), 'Next');
    await audit.getByRole('link', { name: 'Next page' }).click();
    await audit.getByText('192.0.2.26', { exact: true }).waitFor();
    await waitForRange(audit, 'Showing 50 of 59 entries');
    assert.equal(auditQueries.at(-1).get('through'), '2026-11-21T12:30:00');
    await audit.getByRole('link', { name: 'Next page' }).click();
    await waitForRange(audit, 'Showing 59 of 59 entries');
    assert(await audit.getByRole('button', { name: 'Next page' }).isDisabled());
    await audit.getByRole('link', { name: 'Previous page' }).click();
    await audit.getByText('192.0.2.26', { exact: true }).waitFor();
    const { searchable } = require('./helpers/searchable-select.cjs');
    const size = searchable(audit.locator('select'));
    await size.input.click();
    await size.popup.getByRole('option', { name: '50', exact: true }).click();
    await audit.getByText('192.0.2.1', { exact: true }).waitFor();
    await waitForRange(audit, 'Showing 50 of 59 entries');
    assert.equal(await audit.locator('select').inputValue(), '50');
    assert(!auditQueries.at(-1).has('older') && !auditQueries.at(-1).has('newer')
      && auditQueries.at(-1).get('through') === 'latest');
    await page.setViewportSize({ width: 320, height: 850 });
    const dateFilter = await openFilter(audit, 'When');
    await dateFilter.getByRole('searchbox').fill('19 nov');
    await dateFilter.getByRole('checkbox', {name:'Select all matches', exact:true}).check();
    await dateFilter.getByRole('searchbox').fill('20 nov');
    await dateFilter.getByRole('checkbox', {name:'Select all matches', exact:true}).check();
    await dateFilter.getByText('2 selected', {exact:true}).waitFor();
    await dateFilter.getByRole('button', { name: 'Apply', exact: true }).click();
    await waitForRange(audit, 'Showing 39 of 39 entries');

    const actors = await openFilter(audit, 'Actor');
    assert.equal(await actors.getByRole('checkbox', {name:'Operator 000', exact:true}).count(), 0);
    const actorRequests = auditQueries.length;
    await actors.getByRole('searchbox').fill('operator 026');
    await actors.getByRole('checkbox', {name:'Select all matches', exact:true}).check();
    await actors.getByRole('searchbox').fill('058');
    await actors.getByRole('checkbox', {name:'Select all matches', exact:true}).check();
    await actors.getByText('2 selected', {exact:true}).waitFor();
    assert.equal(auditQueries.length, actorRequests, 'Searching and checking values only update the dropdown draft');
    await actors.getByRole('button', { name: 'Apply', exact: true }).click();
    await waitForRange(audit, 'Showing 2 of 2 entries');
    const filters = { when: {equals:['19 nov 2026','20 nov 2026']}, actor: {equals:['operator 026','operator 058']} };
    assert.deepEqual(JSON.parse(auditQueries.at(-1).get('columns')), filters);
    const csvUrl = await page.getByRole('button', { name: 'Export CSV' }).getAttribute('data-url');
    assert.deepEqual(JSON.parse(new URL(csvUrl, origin).searchParams.get('columns')), filters);

    const beforeReload = auditQueries.length;
    await page.reload();
    await waitForRange(audit, 'Showing 2 of 2 entries');
    await remove(audit, 'When', '19 Nov 2026').waitFor();
    await remove(audit, 'Actor', 'Operator 058').waitFor();
    assert.equal(await chips(audit).getByRole('listitem').count(), 4);
    for (const label of ['When', 'Actor']) {
      assert.equal(await chips(audit).getByText(label, {exact:true}).count(), 1);
      assert.equal(await chips(audit).getByRole('list', {name:label, exact:true}).getByRole('listitem').count(), 2);
    }
    assert.deepEqual(auditQueries.slice(beforeReload).filter(query => query.has('options_for'))
      .map(query => query.get('options_for')).sort(), ['actor', 'when']);
    const savedActors = await openFilter(audit, 'Actor', true);
    assert(await savedActors.getByRole('checkbox', {name:'Operator 026', exact:true}).isChecked());
    assert(await savedActors.getByRole('checkbox', {name:'Operator 058', exact:true}).isChecked());
    await savedActors.getByRole('searchbox').fill('058');
    await savedActors.getByRole('checkbox', { name: 'Select all matches', exact: true }).uncheck();
    await savedActors.getByText('1 selected', {exact:true}).waitFor();
    await savedActors.getByRole('button', { name: 'Apply', exact: true }).click();
    await waitForRange(audit, 'Showing 1 of 1 entry');
    await audit.getByText('192.0.2.27', {exact:true}).waitFor();
    await remove(audit, 'Actor', 'Operator 026').click();
    await waitForRange(audit, 'Showing 39 of 39 entries');
    assert.equal(await chips(audit).getByRole('listitem').count(), 2);

    const ip = await openFilter(audit, 'Client IP');
    const bounds = await ip.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 320 && bounds.y >= 0 && bounds.y + bounds.height <= 850);
    await ip.getByRole('checkbox', {name:'192.0.2.59', exact:true}).check();
    await ip.getByRole('button', { name: 'Apply', exact: true }).click();
    await waitForRange(audit, 'Showing 1 of 1 entry');
    assert.deepEqual(JSON.parse(auditQueries.at(-1).get('columns')), {
      when: filters.when, client_ip: {equals:'192.0.2.59'},
    });
    await audit.getByRole('table').getByText('192.0.2.59', { exact: true }).waitFor();
    await remove(audit, 'When', '20 Nov 2026').click();
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-action="audit-export"]');
      if (!button) return false;
      const url = new URL(button.dataset.url, location.href);
      return JSON.parse(url.searchParams.get('columns')).when.equals === '19 nov 2026';
    });
    assert.equal(await remove(audit, 'When', '20 Nov 2026').count(), 0);
    const csvAfterRemoval = await page.getByRole('button', {name:'Export CSV'}).getAttribute('data-url');
    assert.deepEqual(JSON.parse(new URL(csvAfterRemoval, origin).searchParams.get('columns')), {
      when: {equals:'19 nov 2026'}, client_ip: {equals:'192.0.2.59'},
    });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Filter panel overflows at 320px');
    assert.equal(await audit.getByRole('button', {name:'Clear all', exact:true}).count(), 1);
    await clearAll(audit).click();
    await waitForRange(audit, 'Showing 50 of 59 entries');
    assert.equal(await chips(audit).count(), 0);
    const unfilteredAudit = auditQueries.at(-1);
    assert.equal(unfilteredAudit.get('audit_outcome'), 'success');
    assert.equal(unfilteredAudit.get('page_size'), '50');
    assert.equal(unfilteredAudit.has('columns'), false);
    const csvAfterClear = await page.getByRole('button', {name:'Export CSV'}).getAttribute('data-url');
    assert.equal(new URL(csvAfterClear, origin).searchParams.has('columns'), false);

    const auditLink = new URLSearchParams({audit_outcome:'success'});
    const chosenActors = entries.slice(20, 25).map(entry => entry.actor.toLowerCase());
    const chosenIps = entries.slice(20, 25).map(entry => entry.client_ip);
    for (const actor of chosenActors) auditLink.append('choice.audit-trail.actor', actor);
    for (const ip of chosenIps) auditLink.append('choice.audit-trail.client_ip', ip);
    await page.goto(origin + '/#audit-trail?' + auditLink);
    await waitForRange(audit, 'Showing 5 of 5 entries');
    await remove(audit, 'Actor', 'Operator 020').waitFor();
    const auditExport = await page.getByRole('button', {name:'Export CSV'}).getAttribute('data-url');
    assert.deepEqual(JSON.parse(new URL(auditExport, origin).searchParams.get('columns')), {
      actor: {equals:chosenActors}, client_ip: {equals:chosenIps},
    });
    const actorChips = chipList(audit, 'Actor');
    const ipChips = chipList(audit, 'Client IP');
    assert.equal(await actorChips.getByRole('listitem').count(), 3);
    assert.equal(await ipChips.getByRole('listitem').count(), 3);

    const beforeExpand = auditQueries.length;
    const moreActors = toggle(audit, 'Actor', '+2 more');
    assert.equal(await moreActors.getAttribute('aria-expanded'), 'false');
    await moreActors.focus();
    await page.keyboard.press('Enter');
    assert.equal(await toggle(audit, 'Actor', 'Show less').getAttribute('aria-expanded'), 'true');
    assert.equal(await actorChips.getByRole('listitem').count(), 5);
    assert.equal(await ipChips.getByRole('listitem').count(), 3, 'Each group expands independently');
    assert.equal(auditQueries.length, beforeExpand, 'Expanding changes only the display');

    await remove(audit, 'Actor', 'Operator 024').click();
    await waitForRange(audit, 'Showing 4 of 4 entries');
    await toggle(audit, 'Actor', 'Show less').waitFor();
    assert.equal(await actorChips.getByRole('listitem').count(), 4, 'The expanded group stays open after filtering');
    await toggle(audit, 'Actor', 'Show less').click();
    await toggle(audit, 'Actor', '+1 more').waitFor();
    assert.equal(await actorChips.getByRole('listitem').count(), 3);
    await toggle(audit, 'Client IP', '+2 more').click();
    assert.equal(await ipChips.getByRole('listitem').count(), 5);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Grouped chips overflow at 320px');
    await clearColumn(audit, 'Actor').click();
    await waitForRange(audit, 'Showing 5 of 5 entries');
    assert.equal(await actorChips.count(), 0);
    assert.equal(await ipChips.getByRole('listitem').count(), 5, 'Clearing a column keeps other groups expanded');
    const auditAfterColumnClear = auditQueries.at(-1);
    assert.equal(auditAfterColumnClear.get('audit_outcome'), 'success');
    assert.deepEqual(JSON.parse(auditAfterColumnClear.get('columns')), {client_ip:{equals:chosenIps}});
    const sharedFilters = new URLSearchParams(new URL(page.url()).hash.split('?')[1]);
    assert.equal(sharedFilters.has('choice.audit-trail.actor'), false);
    assert.deepEqual(sharedFilters.getAll('choice.audit-trail.client_ip'), chosenIps);
    const auditExportAfterColumnClear = await page.getByRole('button', {name:'Export CSV'}).getAttribute('data-url');
    assert.deepEqual(JSON.parse(new URL(auditExportAfterColumnClear, origin).searchParams.get('columns')), {
      client_ip: {equals:chosenIps},
    });
    await clearAll(audit).click();
    await waitForRange(audit, 'Showing 25 of 59 entries');
    assert.equal(await chips(audit).count(), 0);

    const workflowKey = 'approval-workflow-log';
    await page.goto(origin + '/#' + workflowKey + '?choice.' + workflowKey + '.actor=operator+026');
    const workflow = page.locator('[data-pagination-key="' + workflowKey + '"]');
    await waitForRange(workflow, 'Showing 1 of 1 entry');
    await remove(workflow, 'Actor', 'Operator 026').click();
    await waitForRange(workflow, 'Showing 25 of 59 entries');
    assert.equal(await chips(workflow).count(), 0);
    assert.deepEqual(errors, []);
    console.log('Passed shared filter search, expandable chips, Clear column, Clear all, saved filters and 320px layout.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
