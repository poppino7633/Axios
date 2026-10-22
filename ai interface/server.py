"""HTTP server exposing the Axios AI operations to the browser extension.

Runs on one laptop; teammates' extensions on the same wifi call it at http://<this laptop's IP>:<port>.
When reachable from the network, every request except /health must send the shared team token
(AXIOS_TOKEN in .env) in an "X-Axios-Token" header.

Endpoints (all JSON in / JSON out):
    GET  /health    -> {"status": "ok", "provider": ..., "model": ..., "profile_saved": bool}
    GET  /profile   -> the saved profile
    POST /profile   -> body: user's needs input       -> condensed profile (also saved locally)
    POST /rate      -> body: job {"url","title","description",...} -> rating, work conditions, vagueness flag
    POST /guide     -> body: job {"url","title","description",...} -> application guide

Full reference for the extension: API.md

Usage:
    python server.py [--host 127.0.0.1] [--port 8765]   (defaults come from .env)
"""

import argparse
import hmac
import json
import os
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import main
import providers

LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")
TOKEN_HEADER = "X-Axios-Token"

POST_ROUTES = {
    "/profile": main.build_profile,
    "/rate": main.rate_job,
    "/guide": main.application_guide,
}


class Handler(BaseHTTPRequestHandler):
    token = None  # set in run(); None = no auth (loopback only)

    def _authorized(self):
        if self.token is None or self.path == "/health":
            return True
        if hmac.compare_digest(self.headers.get(TOKEN_HEADER, ""), self.token):
            return True
        self._send_json(401, {"error": f"missing or wrong {TOKEN_HEADER} header"})
        return False

    def _send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", f"Content-Type, {TOKEN_HEADER}")
        # Lets pages on public sites (e.g. ejobs.ro) reach this localhost server in Chrome.
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self):
        if not self._authorized():
            return
        if self.path == "/health":
            self._send_json(200, {
                "status": "ok",
                **providers.describe(),
                "profile_saved": main.PROFILE_PATH.exists(),
            })
        elif self.path == "/profile":
            try:
                self._send_json(200, main.load_profile())
            except RuntimeError as e:
                self._send_json(404, {"error": str(e)})
        else:
            self._send_json(404, {"error": f"unknown endpoint {self.path}"})

    def do_POST(self):
        if not self._authorized():
            return
        handler = POST_ROUTES.get(self.path)
        if handler is None:
            self._send_json(404, {"error": f"unknown endpoint {self.path}"})
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": "request body must be valid JSON"})
            return

        try:
            self._send_json(200, handler(data))
        except RuntimeError as e:
            # bad config, missing profile, or an error from the AI provider
            status = getattr(e, "status", None)
            self._send_json(502 if status and status >= 429 else 400, {"error": str(e)})
        except Exception as e:
            self._send_json(500, {"error": f"{type(e).__name__}: {e}"})


def lan_ip():
    """This machine's address on the local network (no packets are actually sent)."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        try:
            sock.connect(("10.255.255.255", 1))
            return sock.getsockname()[0]
        except OSError:
            return "127.0.0.1"


def run():
    parser = argparse.ArgumentParser(description="Axios AI server.")
    parser.add_argument("--host", default=os.environ.get("AXIOS_HOST", "0.0.0.0"),
                        help="0.0.0.0 = reachable from the wifi, 127.0.0.1 = this laptop only")
    parser.add_argument("--port", type=int, default=int(os.environ.get("AXIOS_PORT", 8765)))
    args = parser.parse_args()

    if args.host not in LOOPBACK_HOSTS:
        Handler.token = os.environ.get("AXIOS_TOKEN") or None
        if not Handler.token:
            raise SystemExit("AXIOS_TOKEN must be set in .env before exposing the server to the network "
                             "(anyone on the wifi could otherwise use the API key and read the saved profile). "
                             "Use --host 127.0.0.1 for local-only testing.")

    try:
        server = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as e:
        raise SystemExit(f"Can't listen on {args.host}:{args.port} ({e.strerror}). "
                         f"Is the server already running? Pick another port with AXIOS_PORT in .env or --port.")

    address = lan_ip() if args.host == "0.0.0.0" else args.host
    print(f"Axios AI server ({providers.describe()})")
    print(f"  URL for the extension: http://{address}:{args.port}")
    if Handler.token:
        print(f"  Every request needs header {TOKEN_HEADER}: <AXIOS_TOKEN from .env>")
    try:
        providers.get_config()
    except providers.ProviderError as e:
        print(f"WARNING: {e}")
    server.serve_forever()


if __name__ == "__main__":
    run()
