#!/usr/bin/env python3
"""VOID PULSE 同源服务器：静态页面与多人 WebSocket 共用一个端口。"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
from urllib.parse import unquote, urlsplit

from relay_server import serve_websocket, websocket_accept


ROOT = Path(__file__).resolve().parent.parent


class GameHandler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def _static_path_allowed(self):
        # 只发布游戏运行所需资源；解码后逐段校验，禁止隐藏路径、原图、遍历与符号链接逃逸。
        path = unquote(urlsplit(self.path).path)
        if '\\' in path or '\x00' in path:
            return False
        parts = path.strip('/').split('/') if path != '/' else ['index.html']
        if any(not part or part.startswith('.') or part == 'source' for part in parts):
            return False
        suffix = Path(parts[-1]).suffix.lower()
        allowed = (parts == ['index.html']
                   or (parts[0] in ('css', 'js', 'vendor') and suffix in ('.js', '.css'))
                   or (parts[0] == 'assets' and suffix in ('.png', '.jpg', '.jpeg', '.webp', '.svg', '.ogg', '.mp3', '.wav')))
        if not allowed:
            return False
        root = Path(self.directory).resolve()
        candidate = root.joinpath(*parts)
        try:
            candidate.resolve().relative_to(root)
        except (ValueError, OSError):
            return False
        # 不通过符号链接发布任何文件，即使它最终仍落在仓库内部。
        current = root
        for part in parts:
            current = current / part
            if current.is_symlink():
                return False
        return candidate.is_file()

    def _health(self, head=False):
        payload = json.dumps({'ok': True}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if not head:
            self.wfile.write(payload)

    def do_HEAD(self):
        if urlsplit(self.path).path == '/healthz':
            self._health(head=True)
        elif self._static_path_allowed():
            super().do_HEAD()
        else:
            self.send_error(404, 'Not found')

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/healthz':
            self._health()
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
        if not self._static_path_allowed():
            self.send_error(404, 'Not found')
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
