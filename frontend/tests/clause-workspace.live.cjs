// Read-only verification against existing local UAT records.
const { chromium } = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { base, uatContextOptions } = require('./helpers/uat.cjs');
const { chooseOption } = require('./helpers/searchable-select.cjs');
const dist = path.resolve(__dirname, '../dist');
const output = path.resolve(process.env.CBD_CLAUSE_LIVE_OUTPUT || path.join(os.tmpdir(), 'cbd-clause-browser-live'));

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ ...uatContextOptions, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const reads = [];
  const errors = [];
  const blocked = [];
  let signedIn = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    const read = ['GET', 'HEAD', 'OPTIONS'].includes(request.method());
    const auth = ['/api/auth/login', '/api/auth/logout'].includes(url.pathname);
    if (url.origin !== base || !read && !auth) {
      blocked.push(url.pathname);
      return route.abort();
    }
    if (url.pathname.startsWith('/api/')) reads.push(url.pathname);
    return route.continue();
  });
  async function get(route) {
    const response = await page.request.get(base + '/api' + route);
    assert.equal(response.status(), 200, 'GET ' + route);
    return response.json();
  }
  async function readAsset(route, filename) {
    const response = await page.request.get(base + route);
    assert.equal(response.status(), 200, 'GET ' + route);
    assert((await response.body()).equals(await fs.readFile(filename)));
  }
  const logout = () => page.getByRole('button', { name: 'Sign out', exact: true });
  try {
    assert.equal((await get('/health')).environment, 'uat');
    const index = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
    await readAsset('/', path.join(dist, 'index.html'));
    const assets = [...index.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1]);
    for (const asset of assets) await readAsset(asset, path.join(dist, asset.slice('/assets/'.length)));
    const demo = await get('/auth/demo-users');
    const account = ['reviewer', 'author', 'approver', 'cco'].map(username => demo.users.find(user => user.username === username &&
      user.password_autofill_available && !user.must_change_password)).find(Boolean);
    assert(account, 'No compatible public demo sign-in.');
    await page.goto(base + '/#clauses');
    await page.locator('#demo-user').selectOption(account.username);
    await page.locator('#login').getByRole('button', { name: /^Sign in/ }).click();
    await page.getByRole('heading', { name: 'Find a clause', exact: true }).waitFor();
    signedIn = true;
    const searchBox = page.getByRole('searchbox', { name: 'Search clauses' });
    const browse = page.getByRole('heading', { name: 'Browse an instrument', exact: true });
    assert((await searchBox.boundingBox()).y < (await browse.boundingBox()).y);
    assert(!reads.some(value => /^\/api\/(clause-browser|clauses|source-editions)/.test(value)));
    const instruments = await get('/instruments');
    let candidate, roots;
    for (const instrument of instruments) {
      const params = new URLSearchParams({ instrument: instrument.id, edition: 'all' });
      const batch = await get('/clause-browser?' + params);
      assert(batch.items.length <= 25);
      if (batch.items.length) { candidate = instrument; roots = batch.items; break; }
    }
    assert(candidate, 'No existing authorised source contains a clause.');
    const root = roots.find(row => row.has_children) || roots[0];
    await chooseOption(page.getByLabel('Instrument', { exact: true }), candidate.id, candidate.code);
    await page.locator('#clause-filters [name=edition][value=current]').waitFor({ state: 'attached' });
    await page.getByLabel('Source edition', { exact: true }).selectOption(root.instrument_version_id);
    const rootRow = page.locator('[data-clause-row="' + root.id + '"]');
    await rootRow.waitFor();
    assert((await page.locator('.clause-browser-tree .clause-tree-node').count()) <= 25);
    let target = root.id;
    if (root.has_children) {
      const response = page.waitForResponse(r => new URL(r.url()).searchParams.get('parent') === root.id);
      await rootRow.locator(':scope > .clause-browser-row button').click();
      const children = (await (await response).json()).items;
      assert(children.length > 0 && children.length <= 25);
      assert(children.every(row => row.parent_clause_id === root.id && row.instrument_version_id === root.instrument_version_id));
      target = children[0].id;
    }
    const detail = await get('/clause-browser/' + target);
    await page.goto(base + '/#clauses?clause=' + target);
    await page.locator('#working-clause-heading').waitFor();
    assert.equal(await page.locator('#clause-source-edition').inputValue(), detail.edition.id);
    assert.equal(await page.locator('[data-clause-row="' + target + '"] [aria-current=true]').count(), 1);
    assert(await page.getByText('Original regulatory text', { exact: true }).isVisible());
    assert(await page.getByText('Bank’s internal interpretation', { exact: true }).isVisible());
    await page.goto(base + '/#clauses');
    await page.locator('#clause-filters [name=instrument][value=all]').waitFor({ state: 'attached' });
    await searchBox.fill(detail.clause.code);
    await page.getByText('Search options', { exact: true }).click();
    await page.getByLabel('Search type', { exact: true }).selectOption('reference');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const result = page.getByRole('navigation', { name: 'Clause search results' }).getByRole('link', { name: new RegExp(detail.clause.code) });
    await result.click();
    await page.locator('#working-clause-heading').waitFor();
    assert.equal(await page.locator('#clause-source-edition').inputValue(), detail.edition.id);
    await page.getByRole('link', { name: 'Back to results', exact: true }).click();
    await result.waitFor();
    assert.equal(await searchBox.inputValue(), detail.clause.code);
    assert(!reads.includes('/api/clauses'));
    const lookup = new URLSearchParams({ mode: 'search', search_type: 'reference', q: detail.clause.code });
    const references = await get('/clause-browser?' + lookup);
    assert(references.items.some(row => row.id === target));
    lookup.set('search_type', 'phrase');
    lookup.set('q', (detail.clause.heading || detail.clause.clause_text).trim().split(/\s+/).slice(0, 4).join(' '));
    const phrases = await get('/clause-browser?' + lookup);
    assert(phrases.items.some(row => row.id === target));
    await logout().click();
    await page.locator('#login').waitFor();
    signedIn = false;
    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, []);
    const report = {
      evidence: 'Existing local HTTPS UAT records and public demo sign-in',
      checked_at: new Date().toISOString(), matched_assets: assets.length,
      initial_clause_reads: 0, tested_root_batch: roots.length,
      expanded_existing_branch: Boolean(root.has_children), exact_edition_deep_link: true,
      indexed_reference_and_phrase: true, search_first_and_reader_return: true,
      business_writes: 0,
    };
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally {
    if (signedIn) await logout().click({ timeout: 3000 }).catch(() => {});
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
