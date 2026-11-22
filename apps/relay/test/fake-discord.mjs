// A fake Discord for the Worker tests: the REST routes the relay calls and a Gateway WebSocket that
// follows Discord's protocol (HELLO, IDENTIFY → READY, RESUME → replay + RESUMED, heartbeats).
// It runs as an auxiliary worker; the relay reaches it through the DISCORD_TRANSPORT binding and the
// tests drive it through `/_test/*`. Plain JS, because auxiliary workers are not bundled.

import { DurableObject } from 'cloudflare:workers'

const APP_ID = '1000'

function fresh() {
  return {
    seq: 0,
    events: [],
    frames: [],
    connections: 0,
    sessions: 0,
    rest: [],
    nextId: 5000,
    replayAll: false,
    noAck: false,
    heartbeatMs: 45000,
    channels: {},
    messages: {},
    failNext: []
  }
}

export class FakeDiscord extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.s = fresh()
    this.socket = null
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') return this.gateway(url)
    if (url.pathname.startsWith('/_test/')) return this.control(url.pathname.slice(7), request)
    if (url.pathname.startsWith('/api/v10/')) return this.rest(request, url)
    return Response.json({ message: 'not found' }, { status: 404 })
  }

  // --- Gateway ---

  gateway(url) {
    const { 0: client, 1: server } = new WebSocketPair()
    server.accept()
    this.s.connections++
    this.socket?.close(1000, 'replaced')
    this.socket = server
    server.addEventListener('message', (event) => this.onFrame(server, JSON.parse(event.data), url))
    server.send(JSON.stringify({ op: 10, d: { heartbeat_interval: this.s.heartbeatMs } }))
    return new Response(null, { status: 101, webSocket: client })
  }

  dispatch(ws, t, d) {
    const s = ++this.s.seq
    this.s.events.push({ s, t, d })
    ws?.send(JSON.stringify({ op: 0, t, s, d }))
  }

  onFrame(ws, frame, url) {
    this.s.frames.push({ ...frame, host: url.host })
    if (frame.op === 1 && !this.s.noAck) ws.send(JSON.stringify({ op: 11 }))
    if (frame.op === 2) {
      this.s.sessions++
      this.dispatch(ws, 'READY', {
        v: 10,
        session_id: `sess-${this.s.sessions}`,
        resume_gateway_url: 'wss://resume.gateway.fake',
        user: { id: APP_ID, username: 'Zomfy', bot: true },
        application: { id: APP_ID }
      })
    }
    if (frame.op === 6) {
      const from = this.s.replayAll ? 0 : frame.d.seq
      for (const event of this.s.events.filter((e) => e.s > from && e.t !== 'READY')) {
        ws.send(JSON.stringify({ op: 0, t: event.t, s: event.s, d: event.d }))
      }
      const s = ++this.s.seq
      ws.send(JSON.stringify({ op: 0, t: 'RESUMED', s, d: {} }))
    }
  }

  // --- Test control ---

  async control(what, request) {
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}
    switch (what) {
      case 'reset':
        this.socket?.close(1000, 'reset')
        this.socket = null
        this.s = fresh()
        return Response.json({ ok: true })
      case 'config':
        Object.assign(this.s, body)
        return Response.json({ ok: true })
      case 'dispatch':
        this.dispatch(this.socket, body.t, body.d)
        return Response.json({ s: this.s.seq })
      case 'op':
        this.socket?.send(JSON.stringify(body))
        return Response.json({ ok: true })
      case 'close':
        this.socket?.close(body.code ?? 4000, body.reason ?? 'test')
        this.socket = null
        return Response.json({ ok: true })
      case 'state':
        return Response.json({ ...this.s, open: Boolean(this.socket) })
    }
    return Response.json({ error: 'unknown' }, { status: 404 })
  }

  // --- REST ---

  async rest(request, url) {
    const path = url.pathname.slice('/api/v10'.length)
    let body = null
    const type = request.headers.get('Content-Type') ?? ''
    if (type.startsWith('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('files[0]')
      body = { payload: JSON.parse(String(form.get('payload_json'))), file: file ? await file.text() : null }
    } else if (request.method !== 'GET') {
      body = await request.json().catch(() => null)
    }
    this.s.rest.push({ method: request.method, path: path + url.search, body, auth: request.headers.get('Authorization') })

    const fail = this.s.failNext.findIndex((f) => f.method === request.method && path.startsWith(f.path))
    if (fail >= 0) {
      const [f] = this.s.failNext.splice(fail, 1)
      return Response.json(f.body ?? {}, { status: f.status, headers: f.headers ?? {} })
    }

    const id = () => String(++this.s.nextId)
    let m
    if (request.method === 'GET' && path === '/gateway/bot') return Response.json({ url: 'wss://gateway.fake', shards: 1 })
    if (request.method === 'GET' && (m = /^\/channels\/([^/]+)$/.exec(path))) return Response.json({ id: m[1], type: this.s.channels[m[1]] ?? 0 })
    if (request.method === 'GET' && (m = /^\/channels\/([^/]+)\/messages$/.exec(path))) return Response.json(this.s.messages[m[1]] ?? [])
    if (request.method === 'POST' && (m = /^\/channels\/([^/]+)\/messages$/.exec(path))) return Response.json({ id: id(), channel_id: m[1] })
    if (request.method === 'PATCH' && (m = /^\/channels\/([^/]+)\/messages\/([^/]+)$/.exec(path))) return Response.json({ id: m[2], channel_id: m[1] })
    if (request.method === 'POST' && (m = /^\/channels\/([^/]+)\/messages\/([^/]+)\/threads$/.exec(path))) return Response.json({ id: m[2], type: 11, parent_id: m[1] })
    if (request.method === 'POST' && path === '/users/@me/channels') return Response.json({ id: `dm-${body?.recipient_id}`, type: 1 })
    if (request.method === 'PUT' && /^\/applications\/[^/]+\/commands$/.test(path)) return Response.json([])
    if (request.method === 'GET' && (m = /^\/webhooks\/[^/]+\/([^/]+)\/messages\/@original$/.exec(path))) return Response.json({ id: `orig-${m[1]}` })
    return Response.json({ message: 'Unknown route', code: 0 }, { status: 404 })
  }
}

export default {
  fetch(request, env) {
    return env.FAKE.get(env.FAKE.idFromName('fake')).fetch(request)
  }
}
