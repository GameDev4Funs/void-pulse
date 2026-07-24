import { defaultWsUrl, Net, PROTOCOL_VERSION } from '../js/net.js';

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
