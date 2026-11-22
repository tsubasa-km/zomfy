// Fake Slack, GitHub and Linear APIs for the Worker tests. The relay reaches them through the
// SOURCES_TRANSPORT binding; the tests drive them through `https://fake.test/_test/*`: `reset`,
// `state` (every call recorded), and `config` (canned answers, failures to return next). Plain JS,
// because auxiliary workers are not bundled.

import { DurableObject } from 'cloudflare:workers'

function fresh() {
  return {
    calls: [],
    nextId: 1000,
    failNext: [],
    // `slack:<method>` → a body to answer with; `github:<METHOD> <path>` → a body; `linear:<field>` → data.
    answers: {},
    tokens: 0
  }
}

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

/** A form body as an object; fields holding JSON (blocks, files) parsed. */
function parseForm(text) {
  const out = {}
  for (const [key, value] of new URLSearchParams(text)) {
    out[key] = /^[[{]/.test(value) ? (() => { try { return JSON.parse(value) } catch { return value } })() : value
  }
  return out
}

export class FakeApis extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.s = fresh()
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (url.host === 'fake.test') return this.control(url.pathname.replace('/_test/', ''), request)
    const text = request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text()
    const contentType = request.headers.get('Content-Type') ?? ''
    let body = text
    if (contentType.includes('application/x-www-form-urlencoded')) body = parseForm(text)
    else if (contentType.includes('application/json')) body = text ? JSON.parse(text) : null
    const call = {
      host: url.host,
      method: request.method,
      path: url.pathname + url.search,
      body,
      auth: request.headers.get('Authorization')
    }
    this.s.calls.push(call)
    const failIndex = this.s.failNext.findIndex((f) => (!f.host || f.host === url.host) && (!f.path || f.path === url.pathname) && (!f.method || f.method === request.method))
    if (failIndex >= 0) {
      const [f] = this.s.failNext.splice(failIndex, 1)
      return json(f.body ?? {}, f.status ?? 500, f.headers ?? {})
    }
    if (url.host === 'slack.com') return this.slack(url.pathname.replace('/api/', ''), body)
    if (url.host === 'hooks.slack.com' || url.host === 'files.slack.com') return new Response('ok')
    if (url.host === 'api.github.com') return this.github(request.method, url.pathname, body, call)
    if (url.host === 'api.linear.app') return this.linear(body)
    return json({ message: 'not found' }, 404)
  }

  id() {
    return String(++this.s.nextId)
  }

  slack(method, body) {
    const canned = this.s.answers[`slack:${method}`]
    if (canned) return json(canned)
    switch (method) {
      case 'chat.postMessage':
        return json({ ok: true, channel: body.channel, ts: `1700000${this.id()}.000100` })
      case 'users.info':
        return json({ ok: true, user: { id: body.user, name: body.user.toLowerCase(), profile: { display_name: `Name ${body.user}`, image_72: `https://avatars.test/${body.user}.png` } } })
      case 'conversations.replies':
      case 'conversations.history':
        return json({ ok: true, messages: [] })
      case 'files.getUploadURLExternal':
        return json({ ok: true, upload_url: `https://files.slack.com/upload/v1/${this.id()}`, file_id: `F${this.id()}` })
      case 'files.completeUploadExternal':
        return json({ ok: true, files: [{ id: body.files?.[0]?.id ?? 'F0' }] })
      case 'chat.scheduleMessage':
        return json({ ok: true, scheduled_message_id: `Q${this.id()}` })
      case 'canvases.create':
        return json({ ok: true, canvas_id: `CV${this.id()}` })
      default:
        return json({ ok: true })
    }
  }

  github(method, path, body, call) {
    const canned = this.s.answers[`github:${method} ${path}`]
    // `{__status, __body}` answers with a status; anything else is the body.
    if (canned) return canned.__status ? json(canned.__body ?? {}, canned.__status) : json(canned)
    let m
    if (method === 'POST' && (m = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path))) {
      this.s.tokens++
      return json({ token: `ghs_fake${this.s.tokens}_${m[1]}`, expires_at: new Date(Date.now() + 3600_000).toISOString() }, 201)
    }
    if (method === 'GET' && /\/issues\/\d+\/comments$/.test(path)) return json([])
    if (method === 'POST' && /\/comments$/.test(path)) return json({ id: Number(this.id()), html_url: `https://github.com${path}` }, 201)
    if (method === 'PATCH' && /\/comments\/\d+$/.test(path)) return json({ id: Number(path.split('/').pop()) })
    if (method === 'POST' && /\/reactions$/.test(path)) return json({ id: Number(this.id()), content: body?.content }, 201)
    if (method === 'DELETE') return new Response(null, { status: 204 })
    if (method === 'POST' && /\/pulls\/\d+\/reviews$/.test(path)) return json({ id: Number(this.id()) })
    void call
    return json({ message: 'Not Found' }, 404)
  }

  linear(body) {
    const query = String(body?.query ?? '')
    const field = /\{\s*(\w+)/.exec(query.replace(/^\s*(query|mutation)\s*\w*\s*(\([^)]*\))?/, ''))?.[1] ?? ''
    const canned = this.s.answers[`linear:${field}`]
    if (canned) return json(canned.errors ? canned : { data: { [field]: canned } })
    switch (field) {
      case 'viewer':
        return json({ data: { viewer: { id: 'lin-app', name: 'Zomfy', displayName: 'zomfy' } } })
      case 'commentCreate':
        return json({ data: { commentCreate: { success: true, comment: { id: `lc-${this.id()}`, url: 'https://linear.app/c' } } } })
      case 'commentUpdate':
        return json({ data: { commentUpdate: { success: true } } })
      case 'reactionCreate':
        return json({ data: { reactionCreate: { success: true } } })
      case 'issue':
        return json({ data: { issue: { id: body.variables?.id ?? 'iss-1', identifier: 'ENG-1', title: 'An issue', description: '', url: 'https://linear.app/acme/issue/ENG-1', team: { key: 'ENG' }, state: { name: 'Todo' }, comments: { nodes: [] } } } })
      case 'users':
        return json({ data: { users: { nodes: [{ id: 'lin-owner', name: 'Owner', displayName: 'owner', active: true }] } } })
      default:
        return json({ data: { [field]: null } })
    }
  }

  async control(what, request) {
    if (what === 'reset') {
      this.s = fresh()
      return json({ ok: true })
    }
    if (what === 'state') return json(this.s)
    if (what === 'config') {
      const patch = await request.json()
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'answers') this.s.answers = { ...this.s.answers, ...value }
        else this.s[key] = value
      }
      return json({ ok: true })
    }
    return json({ error: 'unknown' }, 404)
  }
}

export default {
  async fetch(request, env) {
    return env.FAKE.get(env.FAKE.idFromName('apis')).fetch(request)
  }
}
