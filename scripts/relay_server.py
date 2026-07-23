#!/usr/bin/env python3
"""VOID PULSE 局域网房间中继服务器（纯标准库，无依赖）。
WebSocket 广播中继：房间制（房名+密码），每房最多 4 人，不涉游戏逻辑。"""
import socket
import socketserver
import threading
import hashlib
import base64
from collections import deque
import json
import struct
import sys

WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
MAX_MEMBERS = 4
MAX_PENDING_FRAMES = 128

rooms = {}            # name -> {'password': str, 'host': int, 'members': {id: Member}}
rooms_lock = threading.Lock()
next_id_lock = threading.Lock()
next_id = [1]


def gen_id():
    with next_id_lock:
        i = next_id[0]
        next_id[0] += 1
        return i


def http_read_headers(sock):
    data = b''
    while b'\r\n\r\n' not in data:
        chunk = sock.recv(1024)
        if not chunk:
            return None
        data += chunk
        if len(data) > 16384:
            return None
    return data.decode('latin1')


def websocket_accept(key):
    return base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()


def ws_handshake(sock, raw):
    key = None
    for line in raw.split('\r\n'):
        if line.lower().startswith('sec-websocket-key:'):
            key = line.split(':', 1)[1].strip()
    if not key:
        return False
    accept = websocket_accept(key)
    resp = ('HTTP/1.1 101 Switching Protocols\r\n'
            'Upgrade: websocket\r\n'
            'Connection: Upgrade\r\n'
            f'Sec-WebSocket-Accept: {accept}\r\n\r\n')
    sock.sendall(resp.encode())
    return True


def recv_exact(sock, n):
    buf = b''
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError('closed')
        buf += chunk
    return buf


def read_frame(sock):
    """返回 (opcode, payload)。连接断开抛异常。"""
    b1, b2 = recv_exact(sock, 2)
    opcode = b1 & 0x0F
    masked = b2 & 0x80
    length = b2 & 0x7F
    if length == 126:
        length = struct.unpack('>H', recv_exact(sock, 2))[0]
    elif length == 127:
        length = struct.unpack('>Q', recv_exact(sock, 8))[0]
    mask = recv_exact(sock, 4) if masked else b'\x00' * 4
    payload = recv_exact(sock, length) if length else b''
    if masked:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return opcode, payload


def make_frame(opcode, payload: bytes):
    header = bytes([0x80 | opcode])
    n = len(payload)
    if n < 126:
        header += bytes([n])
    elif n < 65536:
        header += bytes([126]) + struct.pack('>H', n)
    else:
        header += bytes([127]) + struct.pack('>Q', n)
    return header + payload


class Member:
    def __init__(self, mid, name, sock):
        self.id = mid
        self.name = name
        self.sock = sock
        self.room = None
        self.pending = deque()
        self.pending_cond = threading.Condition()
        self.closed = False
        self.writer = threading.Thread(target=self._write_loop, daemon=True)
        self.writer.start()

    def _write_loop(self):
        try:
            while True:
                with self.pending_cond:
                    while not self.pending and not self.closed:
                        self.pending_cond.wait()
                    if self.closed and not self.pending:
                        return
                    _, frame = self.pending.popleft()
                self.sock.sendall(frame)
        except OSError:
            with self.pending_cond:
                self.closed = True
                self.pending.clear()
                self.pending_cond.notify_all()
            try:
                self.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def send_frame(self, frame, replace_key=None):
        """异步发送；高频状态帧只保留同类最新值，避免慢客户端拖垮房间。"""
        disconnect = False
        with self.pending_cond:
            if self.closed:
                return False
            if replace_key is not None:
                for i in range(len(self.pending) - 1, -1, -1):
                    if self.pending[i][0] == replace_key:
                        # 删除旧状态后从队尾重新排队，不能越过其间的生成/死亡等关键事件。
                        del self.pending[i]
                        break
            if len(self.pending) >= MAX_PENDING_FRAMES:
                for i, (key, _) in enumerate(self.pending):
                    if key is not None:
                        del self.pending[i]
                        break
                else:
                    if replace_key is not None:
                        # 队列全是关键事件时，宁可丢下一份会被后续覆盖的状态帧。
                        return False
                    # 关键事件也无法入队：断开慢客户端，避免静默丢事件后永久分叉。
                    self.closed = True
                    self.pending.clear()
                    self.pending_cond.notify_all()
                    disconnect = True
            if not disconnect:
                self.pending.append((replace_key, frame))
                self.pending_cond.notify()
                return True
        if disconnect:
            try:
                self.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        return False

    def send(self, obj):
        return self.send_frame(encode_message(obj), replace_key_for(obj))

    def stop_writer(self):
        with self.pending_cond:
            self.closed = True
            self.pending.clear()
            self.pending_cond.notify_all()


def encode_message(obj):
    return make_frame(1, json.dumps(obj, separators=(',', ':')).encode())


def replace_key_for(obj):
    if obj.get('t') != 'msg':
        return None
    data = obj.get('data')
    if not isinstance(data, dict):
        return None
    kind = data.get('k')
    if kind in ('snap', 'p'):
        return f"{obj.get('from', 0)}:{kind}"
    return None


def broadcast(members, obj):
    frame = encode_message(obj)
    replace_key = replace_key_for(obj)
    for member in members:
        member.send_frame(frame, replace_key)


def remove_member(member):
    recipients = []
    notice = None
    with rooms_lock:
        room = rooms.get(member.room) if member.room else None
        if not room:
            return
        room['members'].pop(member.id, None)
        is_host = room['host'] == member.id
        if not room['members'] or is_host:
            # 房主离开 → 解散房间
            recipients = list(room['members'].values())
            notice = {'t': 'host_left'}
            for m in recipients:
                m.room = None
            rooms.pop(member.room, None)
        else:
            recipients = list(room['members'].values())
            notice = {'t': 'peer_leave', 'id': member.id, 'name': member.name}
    member.room = None
    if notice:
        broadcast(recipients, notice)


def handle_message(member, msg):
    t = msg.get('t')
    if t == 'create':
        room_name = str(msg.get('room', ''))[:24]
        password = str(msg.get('pass', ''))[:16]
        if not room_name:
            member.send({'t': 'err', 'msg': '房间名无效'})
            return
        error = None
        with rooms_lock:
            if room_name in rooms:
                error = '房间名已存在，换一个'
            else:
                rooms[room_name] = {'password': password, 'host': member.id, 'members': {member.id: member}}
                member.room = room_name
        if error:
            member.send({'t': 'err', 'msg': error})
        else:
            member.send({'t': 'created', 'room': room_name, 'id': member.id})
    elif t == 'join':
        room_name = str(msg.get('room', ''))[:24]
        password = str(msg.get('pass', ''))[:16]
        error = None
        peers = []
        recipients = []
        host_id = 0
        with rooms_lock:
            room = rooms.get(room_name)
            if not room:
                error = '房间不存在'
            elif room['password'] != password:
                error = '密码错误'
            elif len(room['members']) >= MAX_MEMBERS:
                error = '房间已满（最多 4 人）'
            else:
                peers = [{'id': m.id, 'name': m.name} for m in room['members'].values()]
                recipients = list(room['members'].values())
                room['members'][member.id] = member
                member.room = room_name
                host_id = room['host']
        if error:
            member.send({'t': 'err', 'msg': error})
        else:
            member.send({'t': 'joined', 'room': room_name, 'id': member.id, 'host': host_id, 'peers': peers})
            broadcast(recipients, {'t': 'peer_join', 'id': member.id, 'name': member.name})
    elif t == 'msg':
        recipients = []
        with rooms_lock:
            room = rooms.get(member.room) if member.room else None
            if room:
                recipients = [m for m in room['members'].values() if m.id != member.id]
        if recipients:
            broadcast(recipients, {'t': 'msg', 'from': member.id, 'data': msg.get('data')})


def serve_websocket(sock):
    """在已完成 Upgrade 的 socket 上运行一个联机会话。"""
    member = Member(gen_id(), '?', sock)
    frag = b''
    try:
        while True:
            opcode, payload = read_frame(sock)
            if opcode == 8:   # close
                member.send_frame(make_frame(8, b''))
                break
            if opcode == 9:   # ping → pong
                member.send_frame(make_frame(10, payload))
                continue
            if opcode in (1, 2, 0):
                frag += payload
                if len(frag) > 262144:
                    break
                try:
                    msg = json.loads(frag.decode())
                    frag = b''
                except (UnicodeDecodeError, json.JSONDecodeError):
                    continue
                if msg.get('t') == 'name':
                    member.name = str(msg.get('name', '?'))[:16]
                    continue
                handle_message(member, msg)
    except (ConnectionError, OSError):
        pass
    finally:
        try:
            remove_member(member)
        except Exception:
            pass
        member.stop_writer()
        try:
            sock.close()
        except OSError:
            pass


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        sock = self.request
        sock.settimeout(300)
        raw = http_read_headers(sock)
        if not raw or 'upgrade' not in raw.lower():
            return
        if ws_handshake(sock, raw):
            serve_websocket(sock)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8124
    srv = Server(('0.0.0.0', port), Handler)
    print(f'[relay] listening on 0.0.0.0:{port}', flush=True)
    srv.serve_forever()
