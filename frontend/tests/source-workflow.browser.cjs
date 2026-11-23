// Run against scripts/browser_fixture.py with CBD_EDITION_BROWSER_QA=1.
const { chromium } = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const base = 'http://127.0.0.1:8011';
const root = path.resolve(__dirname, '../..');
const out = process.env.CBD_WORKFLOW_QA_OUTPUT || path.join(os.tmpdir(), 'cbd-source-workflow');
const checks = [];
const errors = [];
const blocked = [];
const decisions = [];
let browser, fixture;

async function run() {
  const secretFile = path.join(root, 'var/browser-fixture-secrets.json');
  assert.equal((await fs.stat(secretFile)).mode & 0o077, 0);
  fixture = JSON.parse(await fs.readFile(secretFile, 'utf8'));
  const version = fixture.editions.draft;
  const draftOnly = fixture.editions.draft_only;
  assert(version && draftOnly?.version_id, 'Enable the edition browser fixture.');
  const editionPath = 'repository/' + fixture.record.id + '?version=' + version;
  const workflowPath = editionPath + '&tab=workflow';
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  let serial = 0;

  async function open(page, hash) {
    await page.goto(base + '/?source-workflow=' + (++serial) + '#' + hash);
  }
  async function login(role) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      const read = ['GET', 'HEAD', 'OPTIONS'].includes(request.method());
      const auth = ['/api/auth/login', '/api/auth/logout'].includes(url.pathname);
      const change = request.method() === 'POST' && ['/submit', '/decision'].find(suffix =>
        url.pathname === '/api/versions/' + version + suffix);
      if (url.origin !== base || (!read && !auth && !change)) {
        blocked.push(url.pathname);
        return route.abort();
      }
      if (change) decisions.push(change === '/submit' ? 'SUBMIT' : request.postDataJSON().decision);
      return route.continue();
    });
    await open(page, 'approvals');
    const { username, password } = fixture.credentials[role];
    await page.locator('#login-username').fill(username);
    await page.locator('#login-password').fill(password);
    await page.locator('#login').getByRole('button', { name: /^Sign in/ }).click();
    await page.getByRole('heading', { name: 'Assigned decisions' }).waitFor();
    return page;
  }

  const author = await login('author');
  const reviewer = await login('reviewer');
  const approver = await login('approver');
  const next = (page, name) => page.getByRole('heading', { name, exact: true });
  const action = (page, name) => page.locator('.edition-next-step').getByRole('button', { name, exact: true });

  // The missing-clause draft is real. Overlay an affected domain so the test
  // can exercise domain guidance without changing master data.
  const secondary = { id: 'synthetic-secondary', name: 'TEST ONLY · Additional affected domain', active_flag: 0, domain_owner_unit_id: null };
  await author.route('**/api/masters', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.regulatory_domain.push(secondary);
    await route.fulfill({ response, json: body });
  });
  await author.route('**/api/instruments/' + draftOnly.id, async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.secondary_domains.push(secondary);
    await route.fulfill({ response, json: body });
  });
  await author.setViewportSize({ width: 320, height: 844 });
  await open(author, 'repository/' + draftOnly.id + '?version=' + draftOnly.version_id);
  await author.getByRole('link', { name: 'Check submission requirements', exact: true }).click();
  await next(author, 'Submission blocked').waitFor();
  const blockedCard = author.locator('.edition-next-step');
  assert.match(await blockedCard.innerText(), /Additional affected domain · Owner department not assigned/);
  assert.match(await blockedCard.innerText(), /Add at least one source clause/);
  assert.match(await blockedCard.innerText(), /Administration → Master data → Regulatory domains → Set owner/);
  assert.equal(await author.locator('[data-action=submit-version]').count(), 0);
  assert.equal(await blockedCard.getByRole('link', { name: 'Open Clauses', exact: true }).count(), 1);
  assert.equal(await blockedCard.getByRole('link', { name: 'Open Regulatory domains', exact: true }).count(), 0);
  assert(await author.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await blockedCard.screenshot({ path: path.join(out, 'blocked-320.png') });
  checks.push('The maker sees the missing clause, the named secondary domain blocker and the Admin setup path at 320px. No disabled submit or unauthorised Admin action appears.');

  await author.setViewportSize({ width: 1440, height: 1000 });
  await open(author, editionPath);
  await author.getByRole('link', { name: 'Open review submission', exact: true }).click();
  await next(author, 'Ready to submit for review').waitFor();
  const submit = action(author, 'Submit for Compliance review');
  assert.equal(await submit.isEnabled(), true);
  assert.match(await submit.getAttribute('class'), /\bprimary\b/);
  await author.waitForFunction(() => document.activeElement?.id === 'edition-next-step-heading');
  await author.locator('.edition-next-step').screenshot({ path: path.join(out, 'ready-desktop.png') });
  await submit.click();
  const submitDialog = author.getByRole('dialog', { name: 'Submit for Compliance review' });
  await submitDialog.waitFor();
  const idFor = async page => (await (await page.request.get(base + '/api/auth/me')).json()).user.id;
  await submitDialog.locator('[name=reviewer_id]').selectOption(await idFor(reviewer), { force: true });
  await submitDialog.locator('[name=approver_id]').selectOption(await idFor(approver), { force: true });
  await submitDialog.locator('[name=comments]').fill('TEST ONLY clear source workflow browser check.');
  await submitDialog.getByRole('button', { name: 'Send to Compliance reviewer', exact: true }).click();
  await next(author, 'Waiting for Compliance review').waitFor();
  assert.match(await author.locator('.edition-next-step').innerText(), /assigned to Browser QA Reviewer/);
  assert.match(await author.locator('.edition-next-step').innerText(), /Browser QA Approver receives final approval/);
  assert.equal(await author.locator('.edition-other-actions [data-decision=WITHDRAW]').count(), 1);
  assert.equal(await author.locator('[data-decision=REVIEW], [data-decision=APPROVE]').count(), 0);
  checks.push('The ready maker follows the prominent shortcut, selects two named recipients and submits from the dialog. The maker sees the handoff and can withdraw.');

  await open(approver, 'approvals');
  await approver.getByRole('heading', { name: 'Assigned decisions' }).waitFor();
  assert.equal(await approver.getByRole('link', { name: 'Open final approval', exact: true }).count(), 0);
  await open(approver, workflowPath);
  await next(approver, 'Waiting for Compliance review').waitFor();
  assert.equal(await approver.locator('[data-decision=APPROVE]').count(), 0);

  async function recordDecision(page, label) {
    await action(page, label).click();
    const dialog = page.getByRole('dialog', { name: label, exact: true });
    await dialog.locator('[name=comments]').fill('TEST ONLY independent source decision.');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: label, exact: true }).click();
  }

  await open(reviewer, 'approvals');
  await reviewer.getByRole('link', { name: 'Open Compliance review', exact: true }).click();
  await next(reviewer, 'Your Compliance review').waitFor();
  assert.equal(new URL(reviewer.url()).hash, '#' + workflowPath);
  assert.equal(await reviewer.locator('[aria-current=step] strong').innerText(), 'Compliance review');
  assert.equal(await reviewer.locator('.edition-other-actions [data-decision]').count(), 3);
  await recordDecision(reviewer, 'Record Compliance review');
  await next(reviewer, 'Waiting for final approval').waitFor();
  assert.equal(await reviewer.locator('[data-decision=APPROVE]').count(), 0);
  checks.push('The named reviewer opens the exact edition from My decisions. The independent review unlocks approval and keeps the other decision actions available.');

  await open(approver, 'approvals');
  await approver.getByRole('link', { name: 'Open final approval', exact: true }).click();
  await next(approver, 'Your final approval').waitFor();
  assert.equal(new URL(approver.url()).hash, '#' + workflowPath);
  await approver.locator('.edition-next-step').screenshot({ path: path.join(out, 'approval-desktop.png') });
  await recordDecision(approver, 'Approve source edition');
  await next(approver, 'Source edition approved').waitFor();
  assert.deepEqual(decisions, ['SUBMIT', 'REVIEW', 'APPROVE']);
  assert.deepEqual(blocked, []);
  assert.deepEqual(errors, []);
  checks.push('Final approval appears only after review. The named approver opens the same edition, confirms independence, and sees the approved outcome.');
}

(async () => {
  await fs.mkdir(out, { recursive: true });
  try {
    await run();
    await fs.writeFile(path.join(out, 'validation.json'), JSON.stringify({
      evidence: 'Oracle UAT rollback fixture. The secondary domain blocker uses a browser response overlay.',
      checks, decisions, errors, blocked,
    }, null, 2) + '\n');
    console.log('Passed ' + checks.length + ' browser scenario groups.');
  } catch (error) {
    const redacted = Object.values(fixture?.credentials || {}).reduce(
      (value, credential) => value.split(credential.password).join('[redacted]'), String(error.stack));
    console.error(redacted);
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
})();
