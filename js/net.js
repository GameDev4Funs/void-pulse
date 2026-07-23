// ============ 网络层：WebSocket 房间客户端 ============
const WORDS = ['NEBULA', 'PULSAR', 'QUASAR', 'NOVA', 'ORION', 'VEGA', 'LYRA', 'CYGNUS', 'DRACO', 'PHOENIX', 'ANDROMEDA', 'COSMOS', 'AURORA', 'ZENITH', 'ECLIPSE', 'STELLAR'];

export function genRoomCode() {
  const w = WORDS[Math.floor(Math.random() * WORDS.length)];
  return `${w}-${Math.floor(10 + Math.random() * 90)}`;
}
export function genPassword() {
  return String(Math.floor(1000 + Math.random() * 9000));
}
export function defaultWsUrl() {
  const override = new URLSearchParams(location.search).get('ws');
  if (override) return override;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

export class Net {
  constructor() {
    this.ws = null;
    this.id = 0;
    this.isHost = false;
    this.room = '';
    this.handlers = new Map();
    this.connected = false;
  }

  on(type, cb) { this.handlers.set(type, cb); }
  emit(type, arg) { const cb = this.handlers.get(type); if (cb) cb(arg); }

  connect(url) {
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        this.ws = new WebSocket(url);
      } catch (e) { reject(e); return; }
      const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('连接中继服务器超时')); } }, 6000);
      this.ws.onopen = () => { settled = true; clearTimeout(timer); this.connected = true; resolve(); };
      this.ws.onerror = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('无法连接中继服务器')); } };
      this.ws.onclose = () => {
        this.connected = false;
        this.emit('closed');
      };
      this.ws.onmessage = (ev) => this.dispatch(ev.data);
    });
  }

  dispatch(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.t) {
      case 'created':
        this.id = msg.id; this.isHost = true; this.room = msg.room;
        this.emit('created', msg);
        break;
      case 'joined':
        this.id = msg.id; this.isHost = false; this.room = msg.room;
        this.emit('joined', msg);
        break;
      case 'err':
        this.emit('err', msg.msg);
        break;
      case 'msg':
        this.emit('msg', { from: msg.from, data: msg.data });
        break;
      case 'peer_join':
        this.emit('peer_join', msg);
        break;
      case 'peer_leave':
        this.emit('peer_leave', msg);
        break;
      case 'host_left':
        this.emit('host_left');
        break;
    }
  }

  sendName(name) {
    this._send({ t: 'name', name });
  }

  create(room, pass) {
    this._send({ t: 'create', room, pass });
  }

  join(room, pass) {
    this._send({ t: 'join', room, pass });
  }

  send(data) {
    this._send({ t: 'msg', data });
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  close() {
    try { this.ws && this.ws.close(); } catch {}
  }
}
