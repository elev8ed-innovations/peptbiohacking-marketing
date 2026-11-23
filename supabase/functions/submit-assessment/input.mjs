export function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

export function validateAssessment(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid assessment')
  const body = { name: '', age: '', whatsapp: '', email: '', weight: '', height: '', sex: '', city: '', medications: '', activity: '', sleep: '', stress: '', peptide_experience: '', suggested_protocol: '', lang: '', goals: /** @type {string[]} */ ([]), symptoms: /** @type {string[]} */ ([]), recommended: /** @type {{name: string, pid: string, why: string}[]} */ ([]) }
  const limits = { name: 200, age: 8, whatsapp: 50, email: 254, weight: 12, height: 12, sex: 50, city: 200, medications: 4000, activity: 200, sleep: 200, stress: 200, peptide_experience: 2000, suggested_protocol: 4000, lang: 2 }
  for (const [key, limit] of Object.entries(limits)) {
    const value = input[key] ?? ''
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Invalid field')
    body[key] = String(value).trim()
    if (body[key].length > limit) throw new Error('Field too long')
  }
  for (const key of ['goals', 'symptoms']) {
    const value = input[key] ?? []
    if (!Array.isArray(value) || value.length > 30 || value.some(v => typeof v !== 'string' || v.length > 500)) throw new Error('Invalid list')
    body[key] = value
  }
  const recommended = input.recommended ?? []
  if (!Array.isArray(recommended) || recommended.length > 30) throw new Error('Invalid recommendations')
  body.recommended = recommended.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid recommendation')
    const result = { name: '', pid: '', why: '' }
    for (const key of ['name', 'pid', 'why']) {
      const value = item[key] ?? ''
      if (typeof value !== 'string' || value.length > 2000) throw new Error('Invalid recommendation')
      result[key] = value
    }
    return result
  })
  if (!body.name || (!body.whatsapp && !body.email)) throw new Error('Name and contact required')
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) throw new Error('Invalid email')
  body.lang = body.lang === 'en' ? 'en' : 'es'
  return body
}
