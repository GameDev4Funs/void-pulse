#!/usr/bin/env python3
"""VOID PULSE 局域网房间中继服务器（纯标准库，无依赖）。
WebSocket 广播中继：房间制（房名+密码），每房最多 4 人，不涉游戏逻辑。"""
import socket
import socketserver
import threading
import hashlib
import base64
import json
import struct
import sys
import time

WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
MAX_MEMBERS = 4

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


def ws_handshake(sock, raw):
    key = None
    for line in raw.split('\r\n'):
        if line.lower().startswith('sec-websocket-key:'):
            key = line.split(':', 1)[1].strip()
    if not key:
        return False
    accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
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
        self.send_lock = threading.Lock()
        self.room = None

    def send(self, obj):
        try:
            with self.send_lock:
                self.sock.sendall(make_frame(1, json.dumps(obj, separators=(',', ':')).encode()))
            return True
        except OSError:
            return False


def broadcast(room, obj, exclude=None):
    for m in list(room['members'].values()):
        if exclude is not None and m.id == exclude:
            continue
        m.send(obj)


def remove_member(member):
    with rooms_lock:
        room = rooms.get(member.room) if member.room else None
        if not room:
            return
        room['members'].pop(member.id, None)
        is_host = room['host'] == member.id
        if not room['members'] or is_host:
            # 房主离开 → 解散房间
            for m in list(room['members'].values()):
                m.send({'t': 'host_left'})
                m.room = None
            rooms.pop(member.room, None)
        else:
            broadcast(room, {'t': 'peer_leave', 'id': member.id, 'name': member.name})
    member.room = None


def handle_message(member, msg):
    t = msg.get('t')
    if t == 'create':
        room_name = str(msg.get('room', ''))[:24]
        password = str(msg.get('pass', ''))[:16]
        if not room_name:
            member.send({'t': 'err', 'msg': '房间名无效'})
            return
        with rooms_lock:
            if room_name in rooms:
                member.send({'t': 'err', 'msg': '房间名已存在，换一个'})
                return
            rooms[room_name] = {'password': password, 'host': member.id, 'members': {member.id: member}}
            member.room = room_name
        member.send({'t': 'created', 'room': room_name, 'id': member.id})
    elif t == 'join':
        room_name = str(msg.get('room', ''))[:24]
        password = str(msg.get('pass', ''))[:16]
        with rooms_lock:
            room = rooms.get(room_name)
            if not room:
                member.send({'t': 'err', 'msg': '房间不存在'})
                return
            if room['password'] != password:
                member.send({'t': 'err', 'msg': '密码错误'})
                return
            if len(room['members']) >= MAX_MEMBERS:
                member.send({'t': 'err', 'msg': '房间已满（最多 4 人）'})
                return
            peers = [{'id': m.id, 'name': m.name} for m in room['members'].values()]
            room['members'][member.id] = member
            member.room = room_name
            host_id = room['host']
        member.send({'t': 'joined', 'room': room_name, 'id': member.id, 'host': host_id, 'peers': peers})
        with rooms_lock:
            room2 = rooms.get(room_name)
            if room2:
                broadcast(room2, {'t': 'peer_join', 'id': member.id, 'name': member.name}, exclude=member.id)
    elif t == 'msg':
        with rooms_lock:
            room = rooms.get(member.room) if member.room else None
            if room:
                broadcast(room, {'t': 'msg', 'from': member.id, 'data': msg.get('data')}, exclude=member.id)


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        sock = self.request
        sock.settimeout(300)
        try:
            raw = http_read_headers(sock)
            if not raw or 'upgrade' not in raw.lower():
                return
            if not ws_handshake(sock, raw):
                return
            member = Member(gen_id(), '?', sock)
            frag = b''
            while True:
                opcode, payload = read_frame(sock)
                if opcode == 8:   # close
                    try:
                        sock.sendall(make_frame(8, b''))
                    except OSError:
                        pass
                    break
                if opcode == 9:   # ping → pong
                    member.sock.sendall(make_frame(10, payload))
                    continue
                if opcode in (1, 2, 0):
                    frag += payload
                    if opcode != 0 and len(frag) > 262144:
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
            try:
                sock.close()
            except OSError:
                pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8124
    srv = Server(('0.0.0.0', port), Handler)
    print(f'[relay] listening on 0.0.0.0:{port}', flush=True)
    srv.serve_forever()
