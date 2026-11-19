"""Receives promo frames from the game page: POST /frame?shot=NAME&i=N with a JPEG data URL as the body; saves frames/NAME/NNNNN.jpg."""
import base64
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frames")


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        name = os.path.basename(urlparse(self.path).path)
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
        if not name.endswith(".js") or not os.path.exists(path):
            self.send_response(404)
            self._cors()
            self.end_headers()
            return
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/javascript")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        with open(path, "rb") as f:
            self.wfile.write(f.read())

    def do_POST(self):
        q = parse_qs(urlparse(self.path).query)
        shot = "".join(c for c in q.get("shot", ["x"])[0] if c.isalnum() or c in "-_")
        i = int(q.get("i", ["0"])[0])
        body = self.rfile.read(int(self.headers.get("Content-Length", "0"))).decode()
        data = base64.b64decode(body.split(",", 1)[1])
        d = os.path.join(ROOT, shot)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"{i:05d}.jpg"), "wb") as f:
            f.write(data)
        self.send_response(200)
        self._cors()
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 5198), Handler).serve_forever()
