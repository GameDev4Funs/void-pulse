#!/usr/bin/env python3
"""中继慢发送队列回归：验证状态帧合并顺序和关键事件不静默丢失。"""
import json
from pathlib import Path
import sys
import threading
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from relay_server import MAX_PENDING_FRAMES, Member, encode_message, handle_message, rooms, rooms_lock


def decode_frame(frame):
    length = frame[1] & 0x7f
    offset = 2
    if length == 126:
        length = int.from_bytes(frame[offset:offset + 2], 'big')
        offset += 2
    elif length == 127:
        length = int.from_bytes(frame[offset:offset + 8], 'big')
        offset += 8
    return json.loads(frame[offset:offset + length].decode())


class SlowSocket:
    def __init__(self):
        self.started = threading.Event()
        self.release = threading.Event()
        self.shutdown_called = threading.Event()
        self.sent = []

    def sendall(self, frame):
        self.started.set()
        self.release.wait(2)
        self.sent.append(frame)

    def shutdown(self, _how):
        self.shutdown_called.set()
        self.release.set()


class RecorderMember:
    def __init__(self, mid, name):
        self.id = mid
        self.name = name
        self.room = None
        self.sent = []

    def send(self, obj):
        self.sent.append(obj)
        return True

    def send_frame(self, frame, replace_key=None):
        self.sent.append(decode_frame(frame))
        return True


def state(kind, seq):
    return {'t': 'msg', 'from': 1, 'data': {'k': kind, 'seq': seq}}


class RelayQueueTest(unittest.TestCase):
    def tearDown(self):
        with rooms_lock:
            rooms.clear()

    def test_room_rejects_mismatched_protocol_version(self):
        host = RecorderMember(1, 'host')
        old_guest = RecorderMember(2, 'old')
        handle_message(host, {'t': 'create', 'room': 'VERSION-ROOM', 'pass': '1234', 'v': 2})
        handle_message(old_guest, {'t': 'join', 'room': 'VERSION-ROOM', 'pass': '1234', 'v': 1})

        self.assertIsNone(old_guest.room)
        self.assertEqual(old_guest.sent[-1]['t'], 'err')
        self.assertIn('版本不一致', old_guest.sent[-1]['msg'])

    def test_replaced_snapshot_moves_after_intervening_event(self):
        sock = SlowSocket()
        member = Member(2, 'slow', sock)
        member.send({'t': 'block'})
        self.assertTrue(sock.started.wait(1))

        member.send(state('snap', 1))
        member.send({'t': 'msg', 'from': 1, 'data': {'k': 'sp', 'id': 7}})
        member.send(state('snap', 2))
        with member.pending_cond:
            queued = [decode_frame(frame) for _, frame in member.pending]
        self.assertEqual([item['data']['k'] for item in queued], ['sp', 'snap'])
        self.assertEqual(queued[-1]['data']['seq'], 2)

        sock.release.set()
        deadline = time.time() + 1
        while len(sock.sent) < 3 and time.time() < deadline:
            time.sleep(0.01)
        member.stop_writer()
        self.assertEqual([decode_frame(frame).get('data', {}).get('k') for frame in sock.sent], [None, 'sp', 'snap'])

    def test_critical_overflow_disconnects_instead_of_silent_drop(self):
        sock = SlowSocket()
        member = Member(2, 'slow', sock)
        member.send({'t': 'block'})
        self.assertTrue(sock.started.wait(1))
        for seq in range(MAX_PENDING_FRAMES):
            self.assertTrue(member.send({'t': 'msg', 'from': 1, 'data': {'k': 'sp', 'id': seq}}))

        self.assertFalse(member.send({'t': 'host_left'}))
        self.assertTrue(sock.shutdown_called.wait(1))
        self.assertTrue(member.closed)
        member.stop_writer()

    def test_state_frame_drops_without_disconnect_when_critical_queue_is_full(self):
        sock = SlowSocket()
        member = Member(2, 'slow', sock)
        member.send({'t': 'block'})
        self.assertTrue(sock.started.wait(1))
        for seq in range(MAX_PENDING_FRAMES):
            member.send({'t': 'msg', 'from': 1, 'data': {'k': 'sp', 'id': seq}})

        self.assertFalse(member.send_frame(encode_message(state('snap', 9)), '1:snap'))
        self.assertFalse(member.closed)
        member.stop_writer()
        sock.release.set()


if __name__ == '__main__':
    unittest.main()
