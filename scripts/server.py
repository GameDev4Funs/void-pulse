#!/usr/bin/env python3
"""VOID PULSE 同源服务器：静态页面与多人 WebSocket 共用一个端口。"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys

from relay_server import serve_websocket, websocket_accept


ROOT = Path(__file__).resolve().parent.parent


class GameHandler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/healthz':
            payload = json.dumps({'ok': True}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(payload)
            return
        if path == '/ws':
            if self.headers.get('Upgrade', '').lower() != 'websocket':
                self.send_error(426, 'WebSocket upgrade required')
                return
            key = self.headers.get('Sec-WebSocket-Key')
            if not key:
                self.send_error(400, 'Missing Sec-WebSocket-Key')
                return
            self.send_response(101, 'Switching Protocols')
            self.send_header('Upgrade', 'websocket')
            self.send_header('Connection', 'Upgrade')
            self.send_header('Sec-WebSocket-Accept', websocket_accept(key))
            self.end_headers()
            self.connection.settimeout(300)
            serve_websocket(self.connection)
            self.close_connection = True
            return
        super().do_GET()

    def end_headers(self):
        if self.path.split('?', 1)[0].endswith(('.html', '.js', '.css')):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stdout.write('[server] ' + fmt % args + '\n')
        sys.stdout.flush()


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    port = int(os.environ.get('PORT', sys.argv[1] if len(sys.argv) > 1 else 8123))
    handler = partial(GameHandler, directory=str(ROOT))
    server = Server(('0.0.0.0', port), handler)
    print(f'[server] VOID PULSE on http://0.0.0.0:{port} (WebSocket: /ws)', flush=True)
    server.serve_forever()
