"""AI Task Prioritizer Lambda handler.

Routes:
  POST /prioritize  -> ranks a list of tasks with Amazon Bedrock (Nova) and stores the run
  GET  /history     -> returns the most recent prioritization runs

Deployed via AWS SAM (see template.yaml).
"""

import json
import os
import re
import uuid
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

TABLE_NAME = os.environ["TABLE_NAME"]
MODEL_ID = os.environ.get("MODEL_ID", "amazon.nova-lite-v1:0")
CORS_ORIGIN = os.environ.get("CORS_ORIGIN", "*")

_dynamodb = boto3.resource("dynamodb")
_table = _dynamodb.Table(TABLE_NAME)
_bedrock = boto3.client("bedrock-runtime")

HISTORY_PK = "history"
MAX_TASKS = 25

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


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": CORS_ORIGIN,
        },
        "body": json.dumps(body, default=str),
    }


def _extract_json(text):
    """Pull the first JSON object out of the model's response text."""
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else text
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("No JSON object found in model output.")
    return json.loads(candidate[start : end + 1])


def _invoke_model(tasks):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    user_message = f"Today is {today}. Prioritize these tasks:\n" + "\n".join(
        f"- {t}" for t in tasks
    )
    body = {
        "schemaVersion": "messages-v1",
        "system": [{"text": SYSTEM_PROMPT}],
        "messages": [{"role": "user", "content": [{"text": user_message}]}],
        "inferenceConfig": {"maxTokens": 1500, "temperature": 0.2, "topP": 0.9},
    }
    result = _bedrock.invoke_model(modelId=MODEL_ID, body=json.dumps(body))
    payload = json.loads(result["body"].read())
    text = payload["output"]["message"]["content"][0]["text"]
    parsed = _extract_json(text)
    ranked = parsed.get("tasks", [])
    if not isinstance(ranked, list):
        raise ValueError("Model output 'tasks' was not a list.")
    return ranked


def _handle_prioritize(event):
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _response(400, {"error": "Request body must be valid JSON."})

    raw_tasks = body.get("tasks")
    if isinstance(raw_tasks, str):
        raw_tasks = raw_tasks.splitlines()
    if not isinstance(raw_tasks, list):
        return _response(400, {"error": "Provide 'tasks' as a list or newline-separated string."})

    tasks = [str(t).strip() for t in raw_tasks if str(t).strip()]
    if not tasks:
        return _response(400, {"error": "No tasks provided."})
    if len(tasks) > MAX_TASKS:
        return _response(400, {"error": f"Too many tasks (max {MAX_TASKS})."})

    try:
        ranked = _invoke_model(tasks)
    except ClientError as exc:
        return _response(502, {"error": f"Bedrock error: {exc.response['Error']['Message']}"})
    except (ValueError, KeyError, json.JSONDecodeError) as exc:
        return _response(502, {"error": f"Could not parse model response: {exc}"})

    run_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    item = {
        "pk": HISTORY_PK,
        "createdAt": created_at,
        "id": run_id,
        "input": tasks,
        "result": ranked,
    }
    try:
        _table.put_item(Item=item)
    except ClientError as exc:
        return _response(500, {"error": f"Failed to save run: {exc.response['Error']['Message']}"})

    return _response(200, {"id": run_id, "createdAt": created_at, "tasks": ranked})


def _handle_history():
    try:
        query = _table.query(
            KeyConditionExpression=Key("pk").eq(HISTORY_PK),
            ScanIndexForward=False,
            Limit=5,
        )
    except ClientError as exc:
        return _response(500, {"error": f"Failed to load history: {exc.response['Error']['Message']}"})

    runs = [
        {
            "id": i.get("id"),
            "createdAt": i.get("createdAt"),
            "input": i.get("input", []),
            "result": i.get("result", []),
        }
        for i in query.get("Items", [])
    ]
    return _response(200, {"runs": runs})


def handler(event, _context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    path = event.get("requestContext", {}).get("http", {}).get("path", "")

    if method == "OPTIONS":
        return _response(200, {})
    if method == "POST" and path.endswith("/prioritize"):
        return _handle_prioritize(event)
    if method == "GET" and path.endswith("/history"):
        return _handle_history()
    return _response(404, {"error": "Not found."})
