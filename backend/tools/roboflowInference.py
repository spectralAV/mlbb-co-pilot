import argparse
import importlib.metadata
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path


DEFAULT_SERVER_URL = "http://localhost:9001"


def package_version(name: str):
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def command_available(name: str):
    return shutil.which(name) is not None


def docker_status(check: bool):
    available = command_available("docker")
    status = {
        "available": available,
        "running": None,
        "version": None,
        "warning": "" if available else "Docker CLI was not found on PATH.",
    }
    if not available or not check:
        return status
    try:
        result = subprocess.run(
            ["docker", "version", "--format", "{{.Server.Version}}"],
            check=True,
            capture_output=True,
            text=True,
            timeout=8,
        )
        status["running"] = True
        status["version"] = result.stdout.strip() or None
        status["warning"] = ""
    except Exception as error:
        status["running"] = False
        status["warning"] = f"Docker is installed but not reachable: {error}"
    return status


def server_status(server_url: str):
    base = server_url.rstrip("/")
    for suffix in ("/docs", "/redoc", "/"):
        url = f"{base}{suffix}"
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                return {
                    "url": base,
                    "reachable": True,
                    "probe": suffix,
                    "status": response.status,
                    "warning": "",
                }
        except urllib.error.HTTPError as error:
            return {
                "url": base,
                "reachable": True,
                "probe": suffix,
                "status": error.code,
                "warning": "",
            }
        except Exception:
            continue
    return {
        "url": base,
        "reachable": False,
        "probe": None,
        "status": None,
        "warning": "Roboflow Inference server is not reachable.",
    }


def status(project_root: Path, server_url: str, check_docker: bool):
    cli_version = package_version("inference-cli")
    sdk_version = package_version("inference-sdk")
    scripts_dir = project_root / "data" / "cv" / ".venv-roboflow" / "Scripts"
    return {
        "engine": "roboflow-inference",
        "python": sys.executable,
        "runtime": str(scripts_dir.parent),
        "packages": {
            "inferenceCli": {"available": cli_version is not None, "version": cli_version},
            "inferenceSdk": {"available": sdk_version is not None, "version": sdk_version},
        },
        "commands": {
            "inference": command_available("inference") or (scripts_dir / "inference.exe").exists(),
            "docker": command_available("docker"),
        },
        "docker": docker_status(check_docker),
        "server": server_status(server_url),
        "apiKeyConfigured": bool(os.environ.get("ROBOFLOW_API_KEY")),
        "notes": [
            "Use `npm run cv:roboflow:inference:install` to install the Python packages into the dedicated Roboflow runtime.",
            "Use `npm run cv:roboflow:inference:start` to start the local Docker-backed Roboflow Inference server.",
            "Set ROBOFLOW_API_KEY to access private Roboflow projects, fine-tuned models, Universe models, or hosted APIs.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description="Inspect Roboflow Inference integration status.")
    parser.add_argument("command", choices=["status"])
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--server-url", default=os.environ.get("ROBOFLOW_INFERENCE_URL", DEFAULT_SERVER_URL))
    parser.add_argument("--check-docker", action="store_true")
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    try:
        if args.command == "status":
            result = status(root, args.server_url, args.check_docker)
        else:
            raise RuntimeError(f"Unsupported command: {args.command}")
        print(json.dumps({"ok": True, "data": result}))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
