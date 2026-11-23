// Run against a rebuilt local UAT. The large directory exists only in browser GET responses.
const { chromium } = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { base, uatContextOptions } = require('./helpers/uat.cjs');
const { chooseOption } = require('./helpers/searchable-select.cjs');
const output = path.resolve(process.env.CBD_LDAP_ACCOUNTS_QA_OUTPUT || path.join(__dirname, '../../outputs/ldap-directory-2026-11-20'));
const report = { checks: [], layouts: [], browser_errors: [], blocked_writes: [] };

async function checkAccessTable(page, tab, heading, capture = false) {
  await page.goto(base + '/#users?tab=' + tab);
  const panel = page.locator('.table-panel').filter({ has: page.getByRole('heading', { name: heading, exact: true }) });
  await panel.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const controls = panel.locator('tbody td :is(.tag, .btn)');
  assert(await controls.count() > 0, 'Expected account status or action controls in ' + tab);
  for (const width of [1512, 1280, 1024, 768, 641, 640, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await controls.evaluateAll(elements => elements.flatMap(el => {
      const cell = el.closest('td'), bounds = el.getBoundingClientRect(), column = cell.getBoundingClientRect();
      const style = getComputedStyle(cell);
      const left = column.left + parseFloat(style.paddingLeft), right = column.right - parseFloat(style.paddingRight);
      return bounds.left < left - 1 || bounds.right > right + 1 ||
        el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1 ? [cell.dataset.label + ': ' + el.textContent.trim()] : [];
    }));
    assert.deepEqual(overflow, [], tab + ' controls must fit inside their cells at ' + width + 'px');
    const actionGroups = panel.locator('.review-row-actions');
    assert(await actionGroups.evaluateAll(groups => groups.every(group => Array.from(group.children)
      .every((button,i,buttons) => !i || button.getBoundingClientRect().top >= buttons[i-1].getBoundingClientRect().bottom))),
      'Account actions overlap at ' + width + 'px');
    if (capture && width === 1512)
      await panel.screenshot({ path: path.join(output, 'action-required-' + width + '.png') });
    if (capture && width === 390) {
      await panel.evaluate(el => {
        el.scrollIntoView({ block: 'start' });
        window.scrollBy(0, -document.querySelector('.topbar').getBoundingClientRect().height - 12);
      });
      await page.screenshot({ path: path.join(output, 'action-required-' + width + '.png') });
    }
  }
  report.checks.push((capture ? 'Synthetic' : 'Local UAT') + ' ' + tab + ' status text and action buttons fit their cells at eight widths from 320 to 1512px.');
}

function exampleDirectory(actor, masters) {
  const unit = masters.organisational_unit.find(row => row.active_flag);
  const role = masters.role.find(row => row.active_flag);
  const entries = Array.from({ length: 527 }, (_, i) => {
    const n = i + 1, number = String(n).padStart(3, '0');
    const name = 'Directory user ' + number, id = n === 1 ? actor.id : 'directory-' + number;
    const approved = { employee_name: name, ldap_department_code: '001', department_code: '024', department_name: 'Retail Banking' };
    return {
      id, username: 'staff' + number, full_name: name, email: 'staff' + number + '@example.invalid',
      login_type: 'LDAP', active_flag: 1, org_unit_id: unit.id, access_status: 'ACCESS_READY',
      access_status_label: 'Access assigned', employee_profile_required: true, employee_profile_status: 'VERIFIED',
      employee_approved_version_id: 'v1', employee_latest_version_id: 'v1', employee_approved: approved, employee_observed: approved,
    };
  });
  const requests = [entries[0], entries[26], entries[526]].map(user => {
    Object.assign(user, {
      employee_observed: { ...user.employee_approved, designation: 'Operations lead ' + user.username },
      employee_latest_version_id: 'v2', employee_profile_status: 'PENDING', access_status: 'DEPARTMENT_CHANGED',
      access_status_label: 'Employee profile change requires review', admin_action_required: true,
      access_message: 'Review all changed employee fields against the approved snapshot.',
    });
    return { id: 'review-' + user.id, user_id: user.id, full_name: user.full_name, username: user.username,
      status: 'PENDING', approved: user.employee_approved, current: user.employee_observed, changes: [{ field: 'designation' }] };
  });
  Object.assign(entries[1], { active_flag: 0, access_status: 'INACTIVE', access_status_label: 'Inactive account' });
  Object.assign(entries[2], { needs_email_confirmation_flag: 1, access_status: 'PROFILE_PENDING' });
  Object.assign(entries[3], { access_status: 'PENDING_APPROVAL' });
  Object.assign(entries[4], { employee_profile_status: 'RECHECK_REQUIRED', access_status: 'DEPARTMENT_RECHECK' });
  Object.assign(entries[5], { employee_profile_status: 'UNAVAILABLE', access_status: 'DEPARTMENT_UNAVAILABLE' });
  Object.assign(entries[6], { org_unit_id: null, full_name: 'Directory user <example> with a long name' });
  const assignments = entries.filter(user => user !== entries[3]).map(user => ({
    user_id: user.id, role_id: role.id, effective_flag: true, global_scope_flag: false, scope_org_unit_id: unit.id,
  }));
  assignments.push({ ...assignments[26], user_id: entries[26].id, effective_flag: false });
  return { users: entries, assignments, requests, summary: { active_accounts: 526, standard: 0, ldap: 527, action_required: 3,
    department_pending: 3, pending_approval: 1, role_assignment_required: 0, role_review_required: 0, profile_pending: 1 } };
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ ...uatContextOptions, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => report.browser_errors.push(error.message));
  let fixture, directoryReads = 0;
  await context.route('**/api/**', route => {
    const request = route.request(), url = new URL(request.url()), endpoint = url.pathname.slice(4);
    if (request.method() !== 'GET' && !['/auth/login', '/auth/logout'].includes(endpoint)) {
      report.blocked_writes.push(endpoint);
      return route.abort();
    }
    if (fixture) {
      if (endpoint === '/admin/users') {
        directoryReads++;
        return route.fulfill({ json: { users: fixture.users, assignments: fixture.assignments, summary: fixture.summary } });
      }
      if (endpoint === '/admin/employee-profile-reviews') {
        const id = url.searchParams.get('user_id');
        const matching = id ? fixture.requests.filter(r => r.user_id === id) : fixture.requests;
        if (id === 'directory-027') {
          const older = Array.from({length:56}, (_,index) => ({...matching[0],id:'prior-'+index,status:'APPROVED',decision_reason:'Decision '+index}));
          return route.fulfill({json:[...matching,...older]});
        }
        return route.fulfill({json:matching});
      }
      if (endpoint.startsWith('/admin/employee-profile-archive/')) return route.fulfill({ json: [] });
    }
    return route.continue();
  });
  const get = async endpoint => {
    const response = await context.request.get(base + '/api' + endpoint);
    assert(response.ok(), endpoint + ' returned ' + response.status());
    return response.json();
  };
  const directory = page.locator('.ldap-directory'), dialog = page.locator('#dialog');
  const range = directory.locator('.pagination-range'), rows = directory.locator('tbody tr:not([data-empty-row])');
  const details = id => directory.locator('[data-action=ldap-account-details]').and(page.locator('[data-id="' + id + '"]'));
  const close = async () => { await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); };
  async function visit(query = '') {
    await page.goto(base + '/#users?tab=LDAP' + query);
    await page.waitForLoadState('networkidle');
    await directory.waitFor();
  }
  try {
    await page.goto(base);
    await page.locator('#demo-user option[value=admin]').waitFor({ state: 'attached' });
    await page.locator('#demo-user').selectOption('admin', { force: true });
    await page.locator('#login button[type=submit]').click();
    await page.locator('.app-shell').waitFor();
    await visit();
    const catalogue = await get('/admin/users'), liveUsers = catalogue.users.filter(u => u.login_type === 'LDAP');
    assert.equal(await rows.count(), Math.min(liveUsers.length, 25));
    if (liveUsers.length) {
      await details(liveUsers[0].id).click();
      assert.equal(await dialog.locator('h2').innerText(), liveUsers[0].full_name);
      assert.equal(await dialog.locator('.ldap-profile-values tbody tr').count(), 11);
      await close();
    }
    report.live_ldap_accounts = liveUsers.length;
    report.checks.push('Authenticated local UAT directory count and selected account match the existing catalogue.');
    if (catalogue.summary.action_required > 0)
      await checkAccessTable(page, 'ACTION_REQUIRED', 'Accounts requiring administrator action');
    await checkAccessTable(page, 'STANDARD', 'Standard portal accounts');
    if (process.argv.includes('--live-only')) return;

    const actor = (await get('/auth/me')).user;
    fixture = exampleDirectory(actor, await get('/masters'));
    await checkAccessTable(page, 'ACTION_REQUIRED', 'Accounts requiring administrator action', true);
    await page.locator('[data-action=department-history][data-id="directory-027"]').click();
    await dialog.getByRole('heading', { name: 'Employee profile history' }).waitFor();
    const reviews = dialog.locator('[data-pagination-total="57"]');
    await reviews.getByRole('link',{name:'Next page',exact:true}).click();
    await reviews.getByText('Showing 26–50 of 57 records',{exact:true}).waitFor();
    const visibleRows = reviews.locator('tbody').first().locator(':scope > tr');
    assert.equal(await visibleRows.count(),25);
    await visibleRows.first().locator('summary').first().click();
    assert.match(await visibleRows.first().innerText(), /Operations lead staff027/);
    await dialog.locator('summary').filter({hasText:'Current profile and Home organisation'}).click();
    assert.match(await dialog.innerText(), /Operations lead staff027/);
    await close();
    await page.locator('[data-action=user][data-id="directory-027"]').click();
    assert.equal(await dialog.locator('[name=username]').inputValue(), 'staff027');
    await close();
    await page.setViewportSize({ width: 1440, height: 900 });
    await visit();
    await range.getByText('Showing 1–25 of 527 LDAP accounts', { exact: true }).waitFor();
    assert.equal(await rows.count(), 25);
    assert.equal(await directory.getByText('Latest observed value', { exact: true }).count(), 0);
    assert.match(await rows.nth(1).innerText(), /Account disabled/);
    assert.match(await rows.nth(2).innerText(), /Access blocked/);
    assert.match(await rows.nth(3).innerText(), /Access blocked/);
    assert.match(await rows.nth(4).innerText(), /sign-in required/);
    assert.match(await rows.nth(5).innerText(), /LDAP department unavailable/);
    assert.match(await rows.nth(6).innerText(), /<example>/);
    await details(actor.id).click();
    assert.equal(await dialog.locator('[data-action=user], [data-action=department-review]').count(), 0);
    await close();
    report.checks.push('527 synthetic accounts show 25 summary rows and zero baseline comparisons. Disabled, blocked, ready and review states and self-edit restrictions are preserved.');

    const reads = directoryReads;
    await directory.getByRole('link', { name: 'Next page', exact: true }).click();
    await details('directory-027').focus();
    await page.keyboard.press('Enter');
    await dialog.getByRole('heading', { name: 'Directory user 027' }).waitFor();
    assert.match(await dialog.innerText(), /Operations lead staff027/);
    assert.match(await dialog.innerText(), /1 assignment is currently ineffective/);
    assert.equal(await dialog.locator('.ldap-profile-values tbody tr').count(), 11);
    assert.equal(directoryReads, reads);
    await dialog.getByRole('button', { name: 'Employee profile history' }).click();
    await dialog.getByRole('heading', { name: 'Employee profile history' }).waitFor();
    await close();
    assert(await details('directory-027').evaluate(el => el === document.activeElement));
    const archivePath = '**/api/admin/employee-profile-archive/directory-027';
    let releaseArchive;
    const delayedArchive = new Promise(resolve => { releaseArchive = resolve; });
    await context.route(archivePath, async route => {
      await delayedArchive;
      await route.fulfill({ json: [] });
    });
    await details('directory-027').click();
    const historyRequest = page.waitForRequest(archivePath);
    await dialog.getByRole('button', { name: 'Employee profile history' }).click();
    await historyRequest;
    await close();
    await details('directory-028').click();
    const response = page.waitForResponse(archivePath);
    releaseArchive();
    await (await response).finished();
    await page.waitForLoadState('networkidle');
    assert.equal(await dialog.locator('h2').innerText(), 'Directory user 028');
    await close();
    await context.unroute(archivePath);
    await directory.getByRole('link', { name: 'Last page' }).click();
    await range.getByText('Showing 526–527 of 527 LDAP accounts', { exact: true }).waitFor();
    assert.equal(await rows.count(), 2);
    await details('directory-527').click();
    await dialog.getByRole('button', { name: 'Review employee profile request' }).click();
    await dialog.getByRole('heading', { name: 'Review employee profile' }).waitFor();
    assert.match(await dialog.innerText(), /staff527/);
    assert.equal(await dialog.locator('[name=reason][required]').count(), 1);
    await close();
    await details('directory-527').click();
    await dialog.getByRole('button', { name: 'Manage profile & roles' }).click();
    assert.equal(await dialog.locator('[name=username]').inputValue(), 'staff527');
    await close();
    assert(await details('directory-527').evaluate(el => el === document.activeElement));
    report.checks.push('Later-page details, baseline values, history, independent review and role management select the correct person. Escape restores focus and the current page.');

    const form = page.locator('#view-filter');
    await form.locator('[name=q]').fill('Operations lead staff527');
    await form.getByRole('button', { name: 'Search', exact: true }).click();
    await range.getByText('Showing 1–1 of 1 LDAP accounts', { exact: true }).waitFor();
    assert(await details('directory-527').isVisible());
    await form.locator('[name=q]').fill('');
    await chooseOption(form.locator('[name=department]'), 'pending');
    await form.getByRole('button', { name: 'Search', exact: true }).click();
    await range.getByText('Showing 1–3 of 3 LDAP accounts', { exact: true }).waitFor();
    await visit('&q=absent-person');
    await range.getByText('0 LDAP accounts', { exact: true }).waitFor();
    assert.equal(await rows.count(), 0);
    assert(await directory.getByText('No LDAP accounts match these filters.', { exact: true }).isVisible());
    await visit('&user=directory-527');
    await details('directory-527').waitFor();
    assert.equal(await rows.count(), 1);
    assert(await details('directory-527').isVisible());
    await page.getByRole('link', { name: 'Show all users in this view' }).click();
    await range.getByText('Showing 1–25 of 527 LDAP accounts', { exact: true }).waitFor();
    await chooseOption(directory.locator('.pagination-size select'), '10');
    assert.equal(await rows.count(), 10);
    report.checks.push('Search finds observed employee data on the final page. Pending review filters, empty results, focused links and page size work across the whole catalogue.');

    for (const width of [1440, 1024, 768, 640, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await directory.scrollIntoViewIfNeeded();
      const rowHeight = Math.round((await rows.nth(8).boundingBox()).height);
      assert(rowHeight <= (width <= 640 ? 128 : 80), 'Row height at ' + width + 'px is ' + rowHeight);
      assert(await directory.locator('.table-wrap').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Directory overflow at ' + width);
      if ([1440, 390].includes(width)) {
        await directory.evaluate(el => {
          el.scrollIntoView({ block: 'start' });
          window.scrollBy(0, -document.querySelector('.topbar').getBoundingClientRect().height - 12);
        });
        await page.screenshot({ path: path.join(output, 'directory-' + width + '.png') });
      }
      await details('directory-009').click();
      assert(await dialog.locator('.ldap-profile-values .table-wrap').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Comparison overflow at ' + width);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Document overflow at ' + width);
      report.layouts.push({ viewport_width: width, example_row_height: rowHeight });
      await close();
    }
    report.checks.push('Directory and selected profile fit desktop, tablet and phone widths. The three comparison columns fit without horizontal scrolling.');
    assert.deepEqual(report.browser_errors, []);
    assert.deepEqual(report.blocked_writes, []);
  } catch (error) {
    report.error = String(error.stack || error);
    throw error;
  } finally {
    try {
      const me = await get('/auth/me');
      await context.request.post(base + '/api/auth/logout', { headers: { Origin: base, 'X-CSRF-Token': me.csrf_token }, data: {} });
    } finally {
      await browser.close();
      await fs.writeFile(path.join(output, process.argv.includes('--live-only') ? 'live.json' : 'verification.json'), JSON.stringify(report, null, 2) + '\n');
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
