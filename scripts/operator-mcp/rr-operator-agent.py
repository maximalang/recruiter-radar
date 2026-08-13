#!/usr/bin/env python3
"""Recruiter Radar local operator agent.

The agent is intentionally tiny and non-generic. It accepts newline-delimited JSON
only over a root-owned Unix socket and maps a fixed action enum to fixed argv
subprocesses. There is no shell execution, arbitrary path read, arbitrary Docker
command, arbitrary URL fetch, SQL, or environment dump capability.
"""

import grp
import json
import os
import re
import shutil
import socketserver
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, Tuple

SOCKET_PATH = Path("/run/recruiter-radar-operator/agent.sock")
STATE_DIR = Path("/var/lib/recruiter-radar-operator")
IDEMPOTENCY_PATH = STATE_DIR / "idempotency.json"
MAX_REQUEST_BYTES = 32 * 1024
MAX_LOG_LINES = 500
MAX_LOG_LINE_CHARS = 4000
MAX_IDEMPOTENCY_ENTRIES = 1000
IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60
MUTATIONS_ENABLED = os.environ.get("RR_OPERATOR_MUTATIONS_ENABLED") == "true"

CONTAINERS = {
    "web": "recruiter-radar-web-1",
    "db": "recruiter-radar-db-1",
    "n8n": "recruiter-radar-n8n-1",
    "redis": "recruiter-radar-redis-1",
    "firecrawl": "recruiter-radar-firecrawl-1",
}
RESTARTABLE = {"web", "n8n"}

SECRET_PATTERNS = [
    re.compile(r"(?i)(authorization\s*[:=]\s*bearer\s+)[^\s,;]+"),
    re.compile(r"(?i)((?:api[_-]?key|token|secret|password|passwd|cookie|session)[\w.-]*\s*[:=]\s*)[^\s,;]+"),
    re.compile(r"(?i)(postgres(?:ql)?://[^:\s/]+:)[^@\s]+(@)"),
    re.compile(r"(?i)(redis://(?::)?)[^@\s]+(@)"),
    re.compile(r"(?i)(set-cookie\s*:\s*)[^\r\n]+"),
]
EMAIL_PATTERN = re.compile(r"(?<![\w.+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?![\w.-])", re.I)
PHONE_PATTERN = re.compile(r"(?<!\d)(?:\+?7|8)[\s().-]*\d{3}[\s().-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}(?!\d)")
IDEMPOTENCY_PATTERN = re.compile(r"^[A-Za-z0-9:_-]{8,128}$")
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9:._-]{1,128}$")


class AgentError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def run(argv, timeout=6, check=False) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            argv,
            shell=False,
            check=check,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True,
            timeout=timeout,
            env={"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"},
        )
    except subprocess.TimeoutExpired as exc:
        raise AgentError("command_timeout") from exc
    except FileNotFoundError as exc:
        raise AgentError("command_unavailable") from exc
    except subprocess.CalledProcessError as exc:
        raise AgentError("command_failed") from exc


def scrub_text(value: str) -> str:
    text = value
    for pattern in SECRET_PATTERNS:
        if pattern.pattern.lower().startswith("(?i)(postgres") or pattern.pattern.lower().startswith("(?i)(redis"):
            text = pattern.sub(r"\1[REDACTED]\2", text)
        else:
            text = pattern.sub(r"\1[REDACTED]", text)
    text = EMAIL_PATTERN.sub("[REDACTED_EMAIL]", text)
    text = PHONE_PATTERN.sub("[REDACTED_PHONE]", text)
    return text


def parse_meminfo() -> Dict[str, int]:
    values: Dict[str, int] = {}
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as handle:
            for line in handle:
                key, raw = line.split(":", 1)
                parts = raw.strip().split()
                if parts and parts[0].isdigit():
                    values[key] = int(parts[0]) * 1024
    except (OSError, ValueError):
        return {}
    return values


def system_health() -> Dict[str, Any]:
    disk = shutil.disk_usage("/")
    memory = parse_meminfo()
    total = memory.get("MemTotal", 0)
    available = memory.get("MemAvailable", 0)
    swap_total = memory.get("SwapTotal", 0)
    swap_free = memory.get("SwapFree", 0)
    try:
        with open("/proc/uptime", "r", encoding="utf-8") as handle:
            uptime_seconds = int(float(handle.read().split()[0]))
    except (OSError, ValueError, IndexError):
        uptime_seconds = None
    try:
        load1, load5, load15 = os.getloadavg()
    except OSError:
        load1 = load5 = load15 = 0.0
    process_count = 0
    try:
        process_count = sum(1 for entry in os.listdir("/proc") if entry.isdigit())
    except OSError:
        pass
    return {
        "uptimeSeconds": uptime_seconds,
        "loadAverage": {"oneMinute": load1, "fiveMinutes": load5, "fifteenMinutes": load15},
        "memory": {
            "totalBytes": total,
            "availableBytes": available,
            "usedRatio": None if not total else round((total - available) / total, 4),
        },
        "swap": {
            "totalBytes": swap_total,
            "usedBytes": max(0, swap_total - swap_free),
        },
        "disk": {
            "totalBytes": disk.total,
            "freeBytes": disk.free,
            "usedRatio": round(disk.used / disk.total, 4) if disk.total else None,
        },
        "processCount": process_count,
    }


def require_service(args: Dict[str, Any]) -> Tuple[str, str]:
    service = args.get("service")
    if not isinstance(service, str) or service not in CONTAINERS:
        raise AgentError("invalid_service")
    return service, CONTAINERS[service]


def inspect_service(service: str, container: str) -> Dict[str, Any]:
    proc = run([
        "docker", "inspect", "--format",
        "{{json .State}}|{{.Config.Image}}|{{.Image}}",
        container,
    ])
    if proc.returncode != 0:
        return {"service": service, "present": False, "state": "missing"}
    raw = proc.stdout.strip()
    state_json, image_ref, image_id = (raw.split("|", 2) + ["", "", ""])[:3]
    try:
        state = json.loads(state_json)
    except json.JSONDecodeError:
        state = {}
    health = state.get("Health") if isinstance(state, dict) else None
    return {
        "service": service,
        "present": True,
        "state": state.get("Status") if isinstance(state, dict) else "unknown",
        "running": bool(state.get("Running")) if isinstance(state, dict) else False,
        "restarting": bool(state.get("Restarting")) if isinstance(state, dict) else False,
        "exitCode": state.get("ExitCode") if isinstance(state, dict) else None,
        "startedAt": state.get("StartedAt") if isinstance(state, dict) else None,
        "health": health.get("Status") if isinstance(health, dict) else None,
        "imageRef": scrub_text(image_ref)[:300] or None,
        "imageId": image_id[:100] or None,
    }


def service_state(args: Dict[str, Any]) -> Dict[str, Any]:
    service, container = require_service(args)
    return inspect_service(service, container)


def recent_logs(args: Dict[str, Any]) -> Dict[str, Any]:
    service, container = require_service(args)
    since_seconds = args.get("sinceSeconds", 900)
    limit = args.get("limit", 120)
    if not isinstance(since_seconds, int) or isinstance(since_seconds, bool) or not 60 <= since_seconds <= 86400:
        raise AgentError("invalid_since")
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_LOG_LINES:
        raise AgentError("invalid_limit")
    proc = run([
        "docker", "logs", "--since", f"{since_seconds}s", "--tail", str(limit), container,
    ], timeout=8)
    if proc.returncode != 0:
        if "No such container" in proc.stderr:
            return {"service": service, "present": False, "lines": []}
        raise AgentError("logs_unavailable")
    combined = "\n".join(part for part in [proc.stdout, proc.stderr] if part)
    lines = []
    for line in combined.splitlines()[-limit:]:
        sanitized = scrub_text(line)[:MAX_LOG_LINE_CHARS]
        lines.append(sanitized)
    return {
        "service": service,
        "present": True,
        "sinceSeconds": since_seconds,
        "limit": limit,
        "lineCount": len(lines),
        "lines": lines,
        "sanitized": True,
        "untrustedContent": True,
    }


def resource_usage(args: Dict[str, Any]) -> Dict[str, Any]:
    requested = args.get("services")
    if requested is None:
        services = list(CONTAINERS.keys())
    elif isinstance(requested, list) and requested and all(isinstance(item, str) and item in CONTAINERS for item in requested):
        services = list(dict.fromkeys(requested))[: len(CONTAINERS)]
    else:
        raise AgentError("invalid_services")

    rows = []
    for service in services:
        container = CONTAINERS[service]
        proc = run([
            "docker", "stats", "--no-stream", "--format", "{{json .}}", container,
        ], timeout=6)
        if proc.returncode != 0:
            rows.append({"service": service, "present": False})
            continue
        try:
            stats = json.loads(proc.stdout.strip())
        except json.JSONDecodeError:
            rows.append({"service": service, "present": True, "available": False})
            continue
        rows.append({
            "service": service,
            "present": True,
            "cpuPercent": stats.get("CPUPerc"),
            "memoryUsage": stats.get("MemUsage"),
            "memoryPercent": stats.get("MemPerc"),
            "pids": stats.get("PIDs"),
        })
    return {"services": rows}


def reverse_proxy_state() -> Dict[str, Any]:
    active = run(["systemctl", "is-active", "caddy"], timeout=4)
    validate = run(["caddy", "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"], timeout=6)
    version = run(["caddy", "version"], timeout=4)
    return {
        "serviceState": active.stdout.strip() if active.returncode == 0 else "inactive_or_unknown",
        "configurationValid": validate.returncode == 0,
        "version": scrub_text(version.stdout.strip())[:120] if version.returncode == 0 else None,
    }


def load_idempotency() -> Dict[str, Any]:
    try:
        data = json.loads(IDEMPOTENCY_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_idempotency(data: Dict[str, Any]) -> None:
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    now = int(time.time())
    live = {
        key: value for key, value in data.items()
        if isinstance(value, dict) and now - int(value.get("timestamp", 0)) <= IDEMPOTENCY_TTL_SECONDS
    }
    if len(live) > MAX_IDEMPOTENCY_ENTRIES:
        ordered = sorted(live.items(), key=lambda item: int(item[1].get("timestamp", 0)), reverse=True)
        live = dict(ordered[:MAX_IDEMPOTENCY_ENTRIES])
    temp = IDEMPOTENCY_PATH.with_suffix(".tmp")
    temp.write_text(json.dumps(live, separators=(",", ":")), encoding="utf-8")
    os.chmod(temp, 0o600)
    os.replace(temp, IDEMPOTENCY_PATH)


def mutation_key(args: Dict[str, Any], action: str, target: str) -> Tuple[str, Dict[str, Any]]:
    if not MUTATIONS_ENABLED:
        raise AgentError("mutations_disabled")
    key = args.get("idempotencyKey")
    if not isinstance(key, str) or not IDEMPOTENCY_PATTERN.fullmatch(key):
        raise AgentError("invalid_idempotency_key")
    state = load_idempotency()
    previous = state.get(key)
    if isinstance(previous, dict):
        if previous.get("action") != action or previous.get("target") != target:
            raise AgentError("idempotency_conflict")
        return key, state
    return key, state


def restart_service(args: Dict[str, Any]) -> Dict[str, Any]:
    service, container = require_service(args)
    if service not in RESTARTABLE:
        raise AgentError("service_not_restartable")
    key, state = mutation_key(args, "restart_service", service)
    previous = state.get(key)
    if isinstance(previous, dict) and "result" in previous:
        return {"replayed": True, **previous["result"]}

    before = inspect_service(service, container)
    if not before.get("present") or not before.get("running"):
        raise AgentError("restart_precondition_failed")
    proc = run(["docker", "restart", "--time", "20", container], timeout=35)
    if proc.returncode != 0:
        raise AgentError("restart_failed")
    deadline = time.time() + 30
    after = inspect_service(service, container)
    while time.time() < deadline and not after.get("running"):
        time.sleep(1)
        after = inspect_service(service, container)
    if not after.get("running"):
        raise AgentError("restart_postcondition_failed")
    result = {"service": service, "before": before, "after": after, "replayed": False}
    state[key] = {"action": "restart_service", "target": service, "timestamp": int(time.time()), "result": result}
    save_idempotency(state)
    return result


def reload_proxy(args: Dict[str, Any]) -> Dict[str, Any]:
    key, state = mutation_key(args, "reload_proxy", "caddy")
    previous = state.get(key)
    if isinstance(previous, dict) and "result" in previous:
        return {"replayed": True, **previous["result"]}

    before = reverse_proxy_state()
    if not before.get("configurationValid"):
        raise AgentError("proxy_validation_failed")
    reload_result = run(["systemctl", "reload", "caddy"], timeout=10)
    if reload_result.returncode != 0:
        raise AgentError("proxy_reload_failed")
    after = reverse_proxy_state()
    if after.get("serviceState") != "active" or not after.get("configurationValid"):
        raise AgentError("proxy_reload_postcondition_failed")
    result = {"before": before, "after": after, "replayed": False}
    state[key] = {"action": "reload_proxy", "target": "caddy", "timestamp": int(time.time()), "result": result}
    save_idempotency(state)
    return result


def dispatch(action: str, args: Dict[str, Any]) -> Any:
    if action == "system_health":
        if args:
            raise AgentError("unexpected_arguments")
        return system_health()
    if action == "service_state":
        return service_state(args)
    if action == "recent_logs":
        return recent_logs(args)
    if action == "resource_usage":
        return resource_usage(args)
    if action == "reverse_proxy_state":
        if args:
            raise AgentError("unexpected_arguments")
        return reverse_proxy_state()
    if action == "restart_service":
        return restart_service(args)
    if action == "reload_proxy":
        allowed = {"idempotencyKey"}
        if any(key not in allowed for key in args):
            raise AgentError("unexpected_arguments")
        return reload_proxy(args)
    raise AgentError("unknown_action")


def audit(request_id: str, action: str, args: Dict[str, Any], status: str, duration_ms: int, error: str = "") -> None:
    safe_args: Dict[str, Any] = {}
    for key in ("service", "sinceSeconds", "limit", "services"):
        if key in args:
            safe_args[key] = args[key]
    if "idempotencyKey" in args:
        safe_args["idempotencyKeyPresent"] = True
    event = {
        "event": "rr_operator_agent_audit",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "requestId": request_id,
        "action": action,
        "args": safe_args,
        "status": status,
        "durationMs": duration_ms,
    }
    if error:
        event["error"] = error
    print(json.dumps(event, separators=(",", ":")), flush=True)


def audit_internal_exception(request_id: str, action: str, exc: Exception) -> None:
    event: Dict[str, Any] = {
        "event": "rr_operator_agent_internal_error",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "requestId": request_id,
        "action": action,
        "exceptionType": type(exc).__name__,
    }
    if isinstance(exc, OSError) and isinstance(exc.errno, int):
        event["errno"] = exc.errno
    print(json.dumps(event, separators=(",", ":")), flush=True)


class Handler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        started = time.monotonic()
        request_id = "invalid"
        action = "invalid"
        args: Dict[str, Any] = {}
        try:
            line = self.rfile.readline(MAX_REQUEST_BYTES + 1)
            if not line or len(line) > MAX_REQUEST_BYTES or not line.endswith(b"\n"):
                raise AgentError("invalid_request_size")
            payload = json.loads(line.decode("utf-8"))
            if not isinstance(payload, dict):
                raise AgentError("invalid_request")
            request_id_value = payload.get("requestId")
            action_value = payload.get("action")
            args_value = payload.get("args", {})
            if not isinstance(request_id_value, str) or not REQUEST_ID_PATTERN.fullmatch(request_id_value):
                raise AgentError("invalid_request_id")
            if not isinstance(action_value, str):
                raise AgentError("invalid_action")
            if not isinstance(args_value, dict):
                raise AgentError("invalid_arguments")
            request_id = request_id_value
            action = action_value
            args = args_value
            result = dispatch(action, args)
            response = {"ok": True, "result": result}
            audit(request_id, action, args, "ok", int((time.monotonic() - started) * 1000))
        except AgentError as exc:
            response = {"ok": False, "error": exc.code}
            audit(request_id, action, args, "error", int((time.monotonic() - started) * 1000), exc.code)
        except (json.JSONDecodeError, UnicodeDecodeError):
            response = {"ok": False, "error": "invalid_json"}
            audit(request_id, action, args, "error", int((time.monotonic() - started) * 1000), "invalid_json")
        except Exception as exc:
            response = {"ok": False, "error": "internal_error"}
            audit_internal_exception(request_id, action, exc)
            audit(request_id, action, args, "error", int((time.monotonic() - started) * 1000), "internal_error")
        encoded = (json.dumps(response, separators=(",", ":")) + "\n").encode("utf-8")
        self.wfile.write(encoded)


class ThreadingUnixServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    if os.geteuid() != 0:
        raise SystemExit("rr-operator-agent must run as root so fixed Docker/Caddy adapters can work")
    group = grp.getgrnam("rr-operator")
    SOCKET_PATH.parent.mkdir(mode=0o770, parents=True, exist_ok=True)
    os.chown(SOCKET_PATH.parent, 0, group.gr_gid)
    os.chmod(SOCKET_PATH.parent, 0o770)
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    if SOCKET_PATH.exists() or SOCKET_PATH.is_socket():
        SOCKET_PATH.unlink()
    with ThreadingUnixServer(str(SOCKET_PATH), Handler) as server:
        os.chown(SOCKET_PATH, 0, group.gr_gid)
        os.chmod(SOCKET_PATH, 0o660)
        print(json.dumps({"event": "rr_operator_agent_started", "mutationsEnabled": MUTATIONS_ENABLED}), flush=True)
        server.serve_forever(poll_interval=0.25)


if __name__ == "__main__":
    main()
