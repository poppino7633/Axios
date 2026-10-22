"""Local HTTP server exposing the Axios AI operations to the browser extension.

Endpoints (all JSON in / JSON out):
    GET  /health    -> {"status": "ok", "model": ..., "profile_saved": bool}
    GET  /profile   -> the saved profile
    POST /profile   -> body: user's needs input       -> condensed profile (also saved locally)
    POST /rate      -> body: job {"url","title","text"} -> rating, work conditions, vagueness flag
    POST /guide     -> body: job {"url","title","text"} -> application guide

Usage:
    python server.py [--host 127.0.0.1] [--port 8765]   (defaults come from .env)
"""

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import main

POST_ROUTES = {
    "/profile": main.build_profile,
    "/rate": main.rate_job,
    "/guide": main.application_guide,
}


class Handler(BaseHTTPRequestHandler):
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
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # Lets pages on public sites (e.g. ejobs.ro) reach this localhost server in Chrome.
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {
                "status": "ok",
                "model": main.DEFAULT_MODEL,
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
            # missing token, missing profile, or an error from Hugging Face
            self._send_json(502 if "Hugging Face" in str(e) else 400, {"error": str(e)})
        except Exception as e:
            self._send_json(500, {"error": f"{type(e).__name__}: {e}"})


def run():
    parser = argparse.ArgumentParser(description="Axios AI local server.")
    parser.add_argument("--host", default=main.os.environ.get("AXIOS_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(main.os.environ.get("AXIOS_PORT", 8765)))
    args = parser.parse_args()

    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print(f"WARNING: listening on {args.host} exposes the server (and the saved profile) to the whole network")

    try:
        server = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as e:
        raise SystemExit(f"Can't listen on {args.host}:{args.port} ({e.strerror}). "
                         f"Is the server already running? Pick another port with AXIOS_PORT in .env or --port.")
    print(f"Axios AI server on http://{args.host}:{args.port} (model: {main.DEFAULT_MODEL})")
    if not main.os.environ.get("HF_TOKEN"):
        print("WARNING: HF_TOKEN is not set; add it to 'ai interface/.env' (see .env.example)")
    server.serve_forever()


if __name__ == "__main__":
    run()
