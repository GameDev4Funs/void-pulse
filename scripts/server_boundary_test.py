#!/usr/bin/env python3
"""实际 HTTP 边界回归：仅发布运行资源，GET/HEAD 同步限制。"""
from functools import partial
from http.client import HTTPConnection
from pathlib import Path
import tempfile
import threading
import unittest

from server import GameHandler, Server
from relay_server import handle_message, remove_member, rooms, rooms_lock
from relay_queue_test import RecorderMember


class QuietHandler(GameHandler):
    def log_message(self, *_args):
        pass


class StaticBoundaryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name) / 'public'
        cls.root.mkdir()
        for name in ('index.html', 'css/style.css', 'js/main.js', 'vendor/three/three.module.min.js',
                     'assets/actors/player.png', 'assets/actors/source/original.png', '.git/config',
                     'scripts/server.py', 'notes.csv', 'js/.private.js'):
            f = cls.root / name
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text('fixture')
        outside = Path(cls.tmp.name) / 'outside.png'
        outside.write_text('private')
        (cls.root / 'assets' / 'escape.png').symlink_to(outside)
        (cls.root / 'js' / 'secret.js').symlink_to(cls.root / '.git' / 'config')
        cls.server = Server(('127.0.0.1', 0), partial(QuietHandler, directory=str(cls.root)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.tmp.cleanup()

    def request(self, path, method='GET'):
        c = HTTPConnection('127.0.0.1', self.server.server_port, timeout=2)
        try:
            c.request(method, path)
            response = c.getresponse()
            status, body = response.status, response.read()
            return status, body
        finally:
            c.close()

    def test_runtime_assets_and_health_remain_available(self):
        for method in ('GET', 'HEAD'):
            for path in ('/', '/index.html', '/css/style.css', '/js/main.js?cache=1',
                         '/vendor/three/three.module.min.js', '/assets/actors/player.png', '/healthz'):
                with self.subTest(method=method, path=path):
                    status, body = self.request(path, method)
                    self.assertEqual(status, 200)
                    if method == 'HEAD':
                        self.assertEqual(body, b'')

    def test_private_files_and_directory_listing_are_blocked(self):
        for method in ('GET', 'HEAD'):
            for path in ('/.git/config', '/scripts/server.py', '/notes.csv', '/assets/actors/source/original.png',
                         '/js/.private.js', '/assets/', '/vendor/', '/js/', '/assets/escape.png', '/js/secret.js',
                         '/assets/%2e%2e/.git/config', '/js/%2eprivate.js', '/assets/%2e%2e%5c.git/config',
                         '/assets/actors/%73ource/original.png'):
                with self.subTest(method=method, path=path):
                    self.assertEqual(self.request(path, method)[0], 404)

    def test_websocket_requires_upgrade(self):
        self.assertEqual(self.request('/ws')[0], 426)


class RoomBoundaryTest(unittest.TestCase):
    def tearDown(self):
        with rooms_lock:
            rooms.clear()

    def test_repeat_create_join_cannot_orphan_membership(self):
        host, guest = RecorderMember(1, 'host'), RecorderMember(2, 'guest')
        handle_message(host, {'t': 'create', 'room': 'ONE', 'v': 6})
        handle_message(guest, {'t': 'join', 'room': 'ONE', 'v': 6})
        for member in (host, guest):
            for kind in ('create', 'join'):
                handle_message(member, {'t': kind, 'room': 'TWO', 'v': 6})
                self.assertEqual(member.sent[-1]['t'], 'err')
                self.assertEqual(member.room, 'ONE')
                self.assertNotIn('TWO', rooms)
        remove_member(host)
        self.assertEqual(rooms, {})
        self.assertIsNone(guest.room)

    def test_guest_cannot_forge_authoritative_events(self):
        host, guest = RecorderMember(1, 'host'), RecorderMember(2, 'guest')
        handle_message(host, {'t': 'create', 'room': 'ONE', 'v': 6})
        handle_message(guest, {'t': 'join', 'room': 'ONE', 'v': 6})
        host.sent.clear()
        for kind in ('mission', 'endless', 'lobby', 'bossWindup', 'forcedeath', 'peeraway', 'de', 'ceb', 'snap'):
            handle_message(guest, {'t': 'msg', 'data': {'k': kind}})
        self.assertEqual(host.sent, [])
        handle_message(guest, {'t': 'msg', 'data': {'k': 'guestaway'}})
        self.assertEqual(host.sent[-1]['data']['k'], 'guestaway')
        handle_message(host, {'t': 'msg', 'data': {'k': 'mission'}})
        self.assertEqual(guest.sent[-1]['data']['k'], 'mission')


if __name__ == '__main__':
    unittest.main()
