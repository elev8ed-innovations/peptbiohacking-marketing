import test from 'node:test'
import assert from 'node:assert/strict'
import { validateAssessment, escapeHtml } from '../supabase/functions/submit-assessment/input.mjs'
const valid = { name: 'Test Patient', email: 'test@example.com', age: '30', goals: ['test'], recommended: [{ name: 'example', pid: 'x', why: 'test' }] }
test('accepts current assessment shape and stores only known fields', () => {
  const value = validateAssessment({ ...valid, injected: 'discard me' })
  assert.equal(value.name, valid.name)
  assert.equal(value.lang, 'es')
  assert.equal(value.injected, undefined)
})
test('rejects malformed, excessive and uncontactable submissions', () => {
  for (const input of [null, [], {}, { ...valid, goals: {} }, { ...valid, medications: 'x'.repeat(4001) }, { ...valid, recommended: [null] }, { ...valid, email: 'invalid' }]) assert.throws(() => validateAssessment(input))
})
test('HTML from user fields is rendered as text', () => {
  assert.equal(escapeHtml('<img src="x" onerror=\'x\'>&'), '&lt;img src=&quot;x&quot; onerror=&#39;x&#39;&gt;&amp;')
})
