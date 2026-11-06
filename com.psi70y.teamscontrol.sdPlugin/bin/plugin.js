#!/usr/bin/env node
/*
 * Teams Control — a Microsoft Teams plugin for AJAZZ Stream Dock and Elgato Stream Deck.
 *
 * Runs as a plain Node.js process (no embedded browser), so Teams' local third-party API
 * accepts its connection. Talks to:
 *   - the Stream Dock / Stream Deck app over its plugin WebSocket (-port -pluginUUID -registerEvent -info)
 *   - Teams' third-party API at ws://127.0.0.1:8124 (protocol 2.0.0)
 * No npm dependencies: a minimal RFC 6455 WebSocket client is built in.
 */
'use strict';

const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TOKEN_FILE = path.join(ROOT, 'teams-token.json');
const LOG_FILE = path.join(ROOT, 'logs', 'plugin.log');

const TEAMS_PORT = 8124;
const IDENTITY = {
  'protocol-version': '2.0.0',
  manufacturer: 'Teams Control',
  device: 'Stream Deck',
  app: 'Teams Control',
  'app-version': '1.0.0',
};
const LEAVE_HOLD_MS = 900;

// ---------------------------------------------------------------- logging
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
try { if (fs.statSync(LOG_FILE).size > 1_000_000) fs.renameSync(LOG_FILE, LOG_FILE + '.1'); } catch {}
function log(...args) {
  const line = `${new Date().toISOString()} ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}
const redact = (s) => String(s).replace(/token=[^&]+/, 'token=<redacted>');

// ---------------------------------------------------------------- minimal WebSocket client
class MiniWS {
  constructor(host, port, pathAndQuery) {
    this.host = host; this.port = port; this.pathAndQuery = pathAndQuery;
    this.onopen = () => {}; this.onmessage = () => {}; this.onclose = () => {};
    this.open = false; this.closed = false;
    this._buf = Buffer.alloc(0); this._frag = []; this._fragOp = 0;
    this._connect();
  }

  _connect() {
    const key = crypto.randomBytes(16).toString('base64');
    const expect = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    const sock = this.sock = net.createConnection({ host: this.host, port: this.port });
    sock.setNoDelay(true);
    let handshaken = false;
    sock.on('connect', () => {
      sock.write(
        `GET ${this.pathAndQuery} HTTP/1.1\r\n` +
        `Host: ${this.host}:${this.port}\r\n` +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    sock.on('data', (chunk) => {
      this._buf = Buffer.concat([this._buf, chunk]);
      if (!handshaken) {
        const end = this._buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = this._buf.subarray(0, end).toString('latin1');
        this._buf = this._buf.subarray(end + 4);
        const status = head.split('\r\n')[0];
        const accept = /sec-websocket-accept:\s*(\S+)/i.exec(head);
        if (!/^HTTP\/1\.1 101/.test(status) || !accept || accept[1] !== expect) {
          this.rejectStatus = status;
          sock.destroy();
          return;
        }
        handshaken = true; this.open = true;
        this.onopen();
      }
      this._parse();
    });
    sock.on('error', (e) => { this.lastError = e.message; });
    sock.on('close', () => {
      if (this.closed) return;
      this.closed = true; this.open = false;
      this.onclose(this.closeCode || 1006, this.closeReason || this.rejectStatus || this.lastError || '');
    });
  }

  _parse() {
    for (;;) {
      const b = this._buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      let mask = null;
      if (masked) { if (b.length < off + 4) return; mask = b.subarray(off, off + 4); off += 4; }
      if (b.length < off + len) return;
      const payload = Buffer.from(b.subarray(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this._buf = b.subarray(off + len);

      if (op === 0x8) {
        this.closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        this.closeReason = payload.subarray(2).toString('utf8');
        this._send(0x8, payload.subarray(0, 2));
        this.sock.end();
      } else if (op === 0x9) {
        this._send(0xA, payload);
      } else if (op === 0x1 || op === 0x2 || op === 0x0) {
        if (op !== 0) { this._frag = []; this._fragOp = op; }
        this._frag.push(payload);
        if (fin) {
          const data = Buffer.concat(this._frag); this._frag = [];
          if (this._fragOp === 0x1) this.onmessage(data.toString('utf8'));
        }
      }
    }
  }

  _send(op, payload) {
    if (!this.sock || this.sock.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) { header = Buffer.alloc(2); header[1] = 0x80 | len; }
    else if (len < 65536) { header = Buffer.alloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
    header[0] = 0x80 | op;
    const mask = crypto.randomBytes(4);
    const body = Buffer.from(payload);
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
    this.sock.write(Buffer.concat([header, mask, body]));
  }

  send(text) { if (this.open) this._send(0x1, Buffer.from(text, 'utf8')); }
  close() { if (this.open) { const p = Buffer.alloc(2); p.writeUInt16BE(1000); this._send(0x8, p); } try { this.sock.end(); } catch {} }
}

// ---------------------------------------------------------------- icons
const iconCache = new Map();
function icon(rel) {
  if (iconCache.has(rel)) return iconCache.get(rel);
  let data = null;
  for (const cand of [rel + '@2x.png', rel + '.png']) {
    try { data = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'icons', cand)).toString('base64'); break; } catch {}
  }
  iconCache.set(rel, data);
  return data;
}
const dis = (on) => (on ? '' : 'Disabled');

// ---------------------------------------------------------------- actions
const P = 'com.psi70y.teamscontrol.';
const held = new Set();   // contexts held for push-to-talk / push-to-mute
const armed = new Map();  // hold-to-leave contexts -> timer

const reaction = (name, type) => ({
  teams: 'send-reaction', param: type, perm: 'canReact',
  img: (_s, on) => `react/${name}${dis(on)}`,
});

function bringTeamsForward() {
  const [cmd, args] = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', 'msteams:']]
    : ['open', ['-a', 'Microsoft Teams']];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

const ACTIONS = {
  [P + 'mute']: { teams: 'toggle-mute', perm: 'canToggleMute',
    img: (s, on) => `mute/${s.isMuted ? 'Muted' : 'Unmuted'}${dis(on)}` },
  [P + 'camera']: { teams: 'toggle-video', perm: 'canToggleVideo',
    img: (s, on) => `camera/${s.isVideoOn ? 'On' : 'Off'}${dis(on)}` },
  [P + 'hand']: { teams: 'toggle-hand', perm: 'canToggleHand',
    img: (s, on) => `hand/${s.isHandRaised ? 'Up' : 'Down'}${dis(on)}` },
  [P + 'blur']: { teams: 'toggle-background-blur', perm: 'canToggleBlur',
    img: (s, on) => `blur/${s.isBackgroundBlurred ? 'On' : 'Off'}${dis(on)}` },
  [P + 'leave']: { teams: 'leave-call', perm: 'canLeave',
    img: (_s, on) => `leave/Leave${dis(on)}` },
  [P + 'applause']: reaction('Applause', 'applause'),
  [P + 'laugh']: reaction('Laugh', 'laugh'),
  [P + 'like']: reaction('Like', 'like'),
  [P + 'love']: reaction('Love', 'love'),
  [P + 'wow']: reaction('Wow', 'wow'),
  [P + 'chat']: { teams: 'toggle-ui', param: 'chat', perm: 'canToggleChat',
    img: (_s, on) => `chat/Chat${dis(on)}` },
  [P + 'sharetray']: { teams: 'toggle-ui', param: 'share-tray', perm: 'canToggleShareTray',
    img: (_s, on) => `share/Tray${dis(on)}` },
  [P + 'stopsharing']: { teams: 'stop-sharing', perm: 'canStopSharing',
    enabled: (s) => !!s.isSharing,
    img: (_s, on) => `share/Stop${dis(on)}` },

  // Hold to talk: unmute while held, mute again on release.
  [P + 'pushtotalk']: { perm: 'canToggleMute',
    down: (ctx) => { if (meetingState.isMuted) { held.add(ctx); sendTeamsAction('toggle-mute'); } },
    up: (ctx) => { if (held.delete(ctx)) sendTeamsAction('toggle-mute'); },
    img: (s, on) => (!on ? 'ptt/IdleDisabled' : s.isMuted === false ? 'ptt/Live' : 'ptt/Idle') },

  // Hold to mute (cough button): mute while held, unmute again on release.
  [P + 'pushtomute']: { perm: 'canToggleMute',
    down: (ctx) => { if (meetingState.isMuted === false) { held.add(ctx); sendTeamsAction('toggle-mute'); } },
    up: (ctx) => { if (held.delete(ctx)) sendTeamsAction('toggle-mute'); },
    img: (s, on) => (!on ? 'ptm/IdleDisabled' : s.isMuted ? 'ptm/Held' : 'ptm/Idle') },

  // Privacy: mute and camera off in one press (never turns them back on).
  [P + 'privacy']: { perm: null,
    enabled: () => !!(permissions.canToggleMute || permissions.canToggleVideo),
    down: () => {
      if (meetingState.isMuted === false) sendTeamsAction('toggle-mute');
      if (meetingState.isVideoOn) sendTeamsAction('toggle-video');
    },
    img: (_s, on) => `privacy/Privacy${dis(on)}` },

  // Leave only after holding for LEAVE_HOLD_MS.
  [P + 'holdtoleave']: { perm: 'canLeave',
    down: (ctx) => {
      clearTimeout(armed.get(ctx));
      armed.set(ctx, setTimeout(() => { armed.delete(ctx); render(ctx); sendTeamsAction('leave-call'); }, LEAVE_HOLD_MS));
      render(ctx);
    },
    up: (ctx) => { if (armed.has(ctx)) { clearTimeout(armed.get(ctx)); armed.delete(ctx); render(ctx); } },
    img: (_s, on, ctx) => (!on ? 'holdleave/IdleDisabled' : armed.has(ctx) ? 'holdleave/Armed' : 'holdleave/Idle') },

  // Status display: in meeting / recording / unread chat. Press to bring Teams to the front.
  [P + 'status']: { perm: null,
    down: () => bringTeamsForward(),
    img: (s) => (teamsConnected
      ? `status/${s.isInMeeting ? 1 : 0}${s.isRecordingOn ? 1 : 0}${s.hasUnreadMessages ? 1 : 0}`
      : 'status/Offline') },
};

// ---------------------------------------------------------------- state
const keys = new Map();   // context -> action uuid
let meetingState = {};
let permissions = {};
let teamsConnected = false;
let globalSettings = {};

function loadToken() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')).token || null; } catch { return null; }
}
function saveToken(token) {
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token, saved: new Date().toISOString() }), { mode: 0o600 }); } catch (e) { log('token save failed', e.message); }
}
let token = loadToken();

// ---------------------------------------------------------------- Stream Dock / Stream Deck connection
const args = {};
for (let i = 2; i < process.argv.length - 1; i++) {
  if (process.argv[i].startsWith('-')) args[process.argv[i].replace(/^-+/, '')] = process.argv[i + 1];
}
if (require.main === module) {
  log('starting; node', process.version, process.platform, 'args:', Object.keys(args).join(','));
  if (!args.port || !args.pluginUUID || !args.registerEvent) {
    log('missing launch arguments, exiting');
    process.exit(1);
  }
}

let sd = null;
const sdSend = (obj) => sd && sd.send(JSON.stringify(obj));

function render(context) {
  const a = ACTIONS[keys.get(context)];
  if (!a) return;
  const on = teamsConnected && (a.perm === null || !!permissions[a.perm]) && (!a.enabled || a.enabled(meetingState));
  const img = icon(a.img(meetingState, on, context));
  if (img) sdSend({ event: 'setImage', context, payload: { image: img, target: 0 } });
}
const renderAll = () => { for (const c of keys.keys()) render(c); };

function startStreamDeck() {
  sd = new MiniWS('127.0.0.1', Number(args.port), '/');
  sd.onopen = () => {
    log('connected to Stream Dock / Stream Deck');
    sdSend({ event: args.registerEvent, uuid: args.pluginUUID });
    sdSend({ event: 'getGlobalSettings', context: args.pluginUUID });
    connectTeams();
  };
  sd.onclose = (code, reason) => { log('host connection closed', code, reason, '- exiting'); process.exit(0); };
  sd.onmessage = (text) => {
    let m; try { m = JSON.parse(text); } catch { return; }
    const a = ACTIONS[m.action];
    switch (m.event) {
      case 'willAppear':
        if (a) { keys.set(m.context, m.action); render(m.context); }
        break;
      case 'willDisappear':
        keys.delete(m.context); held.delete(m.context);
        if (armed.has(m.context)) { clearTimeout(armed.get(m.context)); armed.delete(m.context); }
        break;
      case 'keyDown':
        if (!a) break;
        if (a.down) a.down(m.context); else sendTeamsAction(a.teams, a.param);
        break;
      case 'keyUp':
        if (a && a.up) a.up(m.context);
        break;
      case 'didReceiveGlobalSettings':
        globalSettings = (m.payload && m.payload.settings) || {};
        break;
    }
  };
}

// ---------------------------------------------------------------- Teams connection
let teams = null, requestId = 1, backoff = 1000, reconnectTimer = null;

function connectTeams() {
  clearTimeout(reconnectTimer);
  const q = new URLSearchParams(token ? { token, ...IDENTITY } : IDENTITY).toString();
  log('connecting to Teams', redact(q));
  const ws = teams = new MiniWS('127.0.0.1', TEAMS_PORT, '/?' + q);
  ws.onopen = () => {
    log('connected to Teams');
    teamsConnected = true; backoff = 1000;
    ws.send(JSON.stringify({ action: 'query-state', parameters: {}, requestId: requestId++ }));
    renderAll();
  };
  ws.onmessage = (text) => {
    let m; try { m = JSON.parse(text); } catch { return; }
    if (m.tokenRefresh) {
      token = m.tokenRefresh; saveToken(token);
      globalSettings.teamsControlToken = token;
      sdSend({ event: 'setGlobalSettings', context: args.pluginUUID, payload: globalSettings });
      log('received and saved new Teams token (paired)');
    }
    if (m.meetingUpdate) {
      permissions = m.meetingUpdate.meetingPermissions || {};
      meetingState = m.meetingUpdate.meetingState || {};
      renderAll();
    }
    if (m.errorMsg) log('Teams error:', m.errorMsg);
  };
  ws.onclose = (code, reason) => {
    teamsConnected = false; permissions = {}; renderAll();
    log('Teams connection closed', code, reason);
    if (/403/.test(reason) && token) {
      log('token rejected; clearing it so Teams can pair again');
      token = null; saveToken(null);
    }
    if (teams === ws) {
      reconnectTimer = setTimeout(connectTeams, backoff);
      backoff = Math.min(backoff * 2, 15000);
    }
  };
}

function sendTeamsAction(action, param) {
  if (module.exports._sent) return module.exports._sent(action, param);
  if (!teams || !teams.open) { log('key pressed but Teams not connected:', action); connectTeams(); return; }
  log('-> Teams', action, param || '');
  teams.send(JSON.stringify({ action, parameters: param ? { type: param } : {}, requestId: requestId++ }));
}

process.on('uncaughtException', (e) => log('uncaught', e.stack || e.message));
process.on('SIGTERM', () => { try { teams && teams.close(); } catch {} process.exit(0); });

if (require.main === module) {
  startStreamDeck();
} else {
  // Hooks for exercising the actions without a live Teams connection.
  module.exports = {
    ACTIONS, P, held, armed,
    _set: (s, p, c) => { meetingState = s; permissions = p || permissions; teamsConnected = c !== false; },
    _hookSend: (fn) => { module.exports._sent = fn; },
  };
}
