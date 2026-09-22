import { defaultWsUrl, Net, PROTOCOL_VERSION } from '../js/net.js';

if (PROTOCOL_VERSION !== 5) {
  throw new Error('星球规则同步必须使用联机协议 v5');
}

globalThis.location = {
  protocol: 'http:',
  host: '127.0.0.1:8123',
  search: '',
};
if (defaultWsUrl() !== 'ws://127.0.0.1:8123/ws') {
  throw new Error('HTTP 页面没有使用同源 ws:// 地址');
}

globalThis.location = {
  protocol: 'https:',
  host: 'void-pulse.example',
  search: '',
};
if (defaultWsUrl() !== 'wss://void-pulse.example/ws') {
  throw new Error('HTTPS 页面没有使用同源 wss:// 地址');
}

globalThis.location = {
  protocol: 'https:',
  host: 'void-pulse.example',
  search: '?ws=ws%3A%2F%2Flocalhost%3A8124',
};
if (defaultWsUrl() !== 'ws://localhost:8124') {
  throw new Error('显式 WebSocket 调试地址没有生效');
}

const sent = [];
const net = new Net();
net.ws = { readyState: 1, send: (payload) => sent.push(JSON.parse(payload)) };
net.create('ROOM', '1234');
net.join('ROOM', '1234');
if (sent.some((message) => message.v !== PROTOCOL_VERSION)) {
  throw new Error('建房/加入没有携带当前联机协议版本');
}

console.log('✓ WebSocket URL 协议与同源路由正确');
net.dispatch(JSON.stringify({ t: 'created', id: 7, room: 'ROOM' }));
if (net.hostId !== 7) throw new Error('created 没有记录房主身份');
net.dispatch(JSON.stringify({ t: 'joined', id: 8, host: 7, room: 'ROOM' }));
if (net.hostId !== 7 || net.isHost) throw new Error('joined 没有记录服务器房主身份');
console.log('✓ 房主身份来自中继服务器的房间确认');
