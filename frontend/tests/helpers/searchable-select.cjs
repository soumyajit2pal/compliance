const assert = require('node:assert/strict');

/** Exercise the shared visible control while retaining native locators for assertions. */
function searchable(select) {
  const wrapper = select.locator('..');
  return { wrapper, input: wrapper.locator('input[role=combobox]'), popup: wrapper.locator('.searchable-select-popup') };
}
async function chooseOption(select, value, query) {
  const label = await select.locator('option').evaluateAll((options, value) => options.find(option => option.value === value)?.label, value);
  assert(label !== undefined, 'Requested option must exist in the authorised native list: ' + await select.getAttribute('name') + ' = ' + value);
  const control = searchable(select);
  await control.input.click();
  await control.input.fill(query === undefined ? label : query);
  await control.popup.getByRole('option', { name: label, exact: true }).click();
  assert.equal(await select.inputValue(), value);
  return control;
}
module.exports = { searchable, chooseOption };
