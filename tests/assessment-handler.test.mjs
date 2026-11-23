import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'
import { escapeHtml, validateAssessment } from '../supabase/functions/submit-assessment/input.mjs'

function setup() {
  let handler, saved, email
  const chain = { insert: row => { saved = row; return chain }, select: () => chain, single: async () => ({ data: { id: 'test-id' }, error: null }) }
  const source = readFileSync(new URL('../supabase/functions/submit-assessment/index.ts', import.meta.url), 'utf8').replace(/^import .*;$/gm, '')
  vm.runInNewContext(stripTypeScriptTypes(source), {
    serve: fn => { handler = fn }, createClient: () => ({ from: () => chain }),
    escapeHtml, validateAssessment, Response, TextDecoder, Uint8Array, console,
    Deno: { env: { get: () => 'test-only' } },
    fetch: async (_url, options) => { email = JSON.parse(options.body); return new Response('{}', { status: 200 }) },
  })
  return { run: req => handler(req), saved: () => saved, email: () => email }
}
test('valid request preserves the save/email workflow while escaping content', async () => {
  const app = setup()
  const response = await app.run(new Request('https://test.invalid', { method: 'POST', body: JSON.stringify({ name: '<img src=x>', email: 'test@example.com', goals: ['<script>'], unknown: 'discard' }) }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).ok, true)
  assert.equal(app.saved().raw.unknown, undefined)
  assert.ok(app.email().html.includes('&lt;img src=x&gt;'))
  assert.ok(!app.email().html.includes('<script>'))
})
test('invalid and oversized requests never reach storage or email', async () => {
  for (const body of ['{}', 'not json', 'x'.repeat(32769)]) {
    const app = setup()
    const response = await app.run(new Request('https://test.invalid', { method: 'POST', body }))
    assert.equal(response.status, 400)
    assert.equal(app.saved(), undefined)
    assert.equal(app.email(), undefined)
  }
})
