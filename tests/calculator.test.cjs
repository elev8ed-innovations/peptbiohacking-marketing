const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../calculadora.html'), 'utf8');
function calculator() {
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], { value: '', textContent: '', innerHTML: '', style: {} }]));
  const context = { document: { getElementById: id => elements[id] || null }, T: { es: {} }, LANG: 'es' };
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('function getVialMg()'), html.indexOf('function resetCalc()')), context);
  elements.vialMg.value = '10'; elements.bacMl.value = '2'; elements.doseMcg.value = '250';
  return { elements, calc: () => context.calc() };
}
test('renders the default dilution calculation against actual HTML IDs', () => {
  const { elements: e, calc } = calculator(); calc();
  assert.equal(e.resultUnits.textContent, '5 UI');
  assert.equal(e.resConc.textContent, '5.00 mg/ml');
  assert.equal(e.resVol.textContent, '0.050 ml');
  assert.equal(e.resMcgUnit.textContent, '50.0 mcg');
});
test('clears all results on missing input', () => {
  const { elements: e, calc } = calculator(); calc(); e.doseMcg.value = ''; calc();
  for (const id of ['resultUnits', 'resConc', 'resMcgMl', 'resVol', 'resMcgUnit']) assert.equal(e[id].textContent, '—');
});
