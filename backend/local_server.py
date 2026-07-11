"""Local dev server for the AI Task Prioritizer.

Runs the full app on your machine WITHOUT deploying to AWS:
  - Serves the static frontend (../frontend)
  - Handles POST /prioritize by calling Amazon Bedrock (Nova) with your AWS creds
  - Handles GET /history from a local JSON file (stand-in for DynamoDB)

Usage (from the backend/ folder):
    python local_server.py
Then open http://localhost:8000

Requires: AWS credentials configured (aws configure) with Bedrock Nova access.
The production path (Lambda + API Gateway + DynamoDB) lives in template.yaml / src/app.py.
"""

import json
import os
import re
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from dotenv import load_dotenv

# Load .env from the backend/ folder (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, etc.)
load_dotenv(Path(__file__).parent / ".env")

import boto3
from botocore.exceptions import ClientError, NoCredentialsError

MODEL_ID = os.environ.get("MODEL_ID", "amazon.nova-lite-v1:0")
REGION = os.environ.get("AWS_REGION", "us-east-1")
PORT = int(os.environ.get("PORT", "8000"))

FRONTEND_DIR = (Path(__file__).parent.parent / "frontend").resolve()
HISTORY_FILE = Path(__file__).parent / ".local_history.json"
MAX_TASKS = 25

_bedrock = boto3.client("bedrock-runtime", region_name=REGION)

SYSTEM_PROMPT = (
    "You are a productivity assistant that prioritizes to-do lists. "
    "Today's date is provided in the user message. "
    "For each task, judge urgency (time sensitivity) and impact (value or consequence). "
    "Also estimate how long the task will take and suggest a reasonable due date. "
    "Return ONLY valid JSON, no prose, no markdown fences. "
    "The JSON must be an object with a single key \"tasks\" whose value is an array. "
    "Each array item must have exactly these keys: "
    "task (string, echo the original), "
    "priority (integer 1-5, where 1 is do-first / most important), "
    "urgency (one of \"low\", \"medium\", \"high\"), "
    "impact (one of \"low\", \"medium\", \"high\"), "
    "estimatedMinutes (integer, realistic estimate of minutes to complete), "
    "suggestedDueDate (string, ISO date like \"2026-07-12\" based on urgency; use today for critical items), "
    "category (one of \"work\", \"personal\", \"health\", \"finance\", \"learning\", \"admin\"), "
    "quickWin (boolean, true if task takes <=15 minutes AND has medium-or-higher impact), "
    "reasoning (one short sentence). "
    "Order the array from highest priority (1) to lowest."
)

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


def _extract_json(text):
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else text
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("No JSON object found in model output.")
    return json.loads(candidate[start : end + 1])


def _invoke_model(tasks):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    user_message = f"Today is {today}. Prioritize these tasks:\n" + "\n".join(f"- {t}" for t in tasks)
    body = {
        "schemaVersion": "messages-v1",
        "system": [{"text": SYSTEM_PROMPT}],
        "messages": [{"role": "user", "content": [{"text": user_message}]}],
        "inferenceConfig": {"maxTokens": 1500, "temperature": 0.2, "topP": 0.9},
    }
    result = _bedrock.invoke_model(modelId=MODEL_ID, body=json.dumps(body))
    payload = json.loads(result["body"].read())
    text = payload["output"]["message"]["content"][0]["text"]
    ranked = _extract_json(text).get("tasks", [])
    if not isinstance(ranked, list):
        raise ValueError("Model output 'tasks' was not a list.")
    return ranked


def _load_history():
    if HISTORY_FILE.exists():
        try:
            return json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return []
    return []


def _save_run(item):
    runs = _load_history()
    runs.insert(0, item)
    HISTORY_FILE.write_text(json.dumps(runs[:50], indent=2), encoding="utf-8")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # noqa: N802 - quieter logs
        print(f"[{self.address_string()}] {fmt % args}")

    def _send_json(self, status, payload):
        body = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        if self.path.rstrip("/") == "/history" or self.path == "/history":
            runs = _load_history()[:5]
            self._send_json(200, {"runs": runs})
            return
        self._serve_static()

    def do_POST(self):  # noqa: N802
        if self.path.rstrip("/") != "/prioritize":
            self._send_json(404, {"error": "Not found."})
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            data = json.loads(raw or "{}")
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Request body must be valid JSON."})
            return

        tasks = data.get("tasks")
        if isinstance(tasks, str):
            tasks = tasks.splitlines()
        if not isinstance(tasks, list):
            self._send_json(400, {"error": "Provide 'tasks' as a list or newline string."})
            return

        tasks = [str(t).strip() for t in tasks if str(t).strip()]
        if not tasks:
            self._send_json(400, {"error": "No tasks provided."})
            return
        if len(tasks) > MAX_TASKS:
            self._send_json(400, {"error": f"Too many tasks (max {MAX_TASKS})."})
            return

        try:
            ranked = _invoke_model(tasks)
        except NoCredentialsError:
            self._send_json(500, {"error": "No AWS credentials found. Run 'aws configure'."})
            return
        except ClientError as exc:
            self._send_json(502, {"error": f"Bedrock error: {exc.response['Error']['Message']}"})
            return
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            self._send_json(502, {"error": f"Could not parse model response: {exc}"})
            return

        item = {
            "id": str(uuid.uuid4()),
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "input": tasks,
            "result": ranked,
        }
        _save_run(item)
        self._send_json(200, {"id": item["id"], "createdAt": item["createdAt"], "tasks": ranked})

    def _serve_static(self):
        rel = self.path.split("?", 1)[0].lstrip("/")
        if rel in ("", "/"):
            rel = "index.html"
        target = (FRONTEND_DIR / rel).resolve()
        if not str(target).startswith(str(FRONTEND_DIR)) or not target.is_file():
            self.send_error(404, "Not found")
            return
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(target.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    print(f"AI Task Prioritizer (local) — model={MODEL_ID} region={REGION}")
    print(f"Serving {FRONTEND_DIR}")
    print(f"Open http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
