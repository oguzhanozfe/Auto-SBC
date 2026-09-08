#!/usr/bin/env python3
"""Explicit-launch bootstrap: project-local venv, locked wheels, localhost UI."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser


ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "requirements-lock.txt"
PYTHON_MIN = (3, 12)
EXPECTED_VERSION = "27.0.0-preview"


def normalized_name(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def locked_packages(path=LOCK):
    """Allow exact PyPI package pins only; never accept URLs or pip directives."""
    packages = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = re.fullmatch(r"([A-Za-z0-9][A-Za-z0-9_.-]*)==([A-Za-z0-9][A-Za-z0-9_.+!-]*)", line)
        if not match:
            raise RuntimeError("Kilit dosyasında desteklenmeyen bir paket tanımı var.")
        name, version = match.groups()
        key = normalized_name(name)
        if key in packages and packages[key] != version:
            raise RuntimeError("Kilit dosyasında çelişen paket sürümleri var.")
        packages[key] = version
    if not packages:
        raise RuntimeError("Paket kilit dosyası boş.")
    return packages


def python_version(executable):
    try:
        result = subprocess.run([str(executable), "-c", "import json,sys;print(json.dumps(list(sys.version_info[:2])))"],
                                capture_output=True, text=True, timeout=10, check=True)
        return tuple(json.loads(result.stdout.strip()))
    except (OSError, subprocess.SubprocessError, ValueError):
        return (0, 0)


def venv_python(root=ROOT):
    return Path(root) / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def runtime_candidates():
    supplied = os.environ.get("AUTOSBC_PYTHON")
    if supplied:
        yield Path(supplied)
    yield Path(sys.executable)
    # Codex's bundled runtime is a fallback, never modified by this launcher.
    yield Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
    for name in ("python3.13", "python3.12", "python3", "python"):
        found = shutil.which(name)
        if found:
            yield Path(found)


def choose_python():
    seen = set()
    for candidate in runtime_candidates():
        if str(candidate) in seen:
            continue
        seen.add(str(candidate))
        if python_version(candidate) >= PYTHON_MIN:
            return candidate
    raise RuntimeError("Python 3.12 veya daha yenisi bulunamadı. Python'u kurup yeniden açın.")


def installed_packages(executable):
    code = "import importlib.metadata,json;print(json.dumps({d.metadata['Name']:d.version for d in importlib.metadata.distributions()}))"
    result = subprocess.run([str(executable), "-c", code], capture_output=True, text=True, timeout=20, check=True)
    return {normalized_name(name): version for name, version in json.loads(result.stdout).items()}


def missing_packages(executable, expected):
    installed = installed_packages(executable)
    return [name for name, version in expected.items() if installed.get(name) != version]


def bootstrap_environment():
    expected = locked_packages()
    executable = venv_python()
    if not executable.is_file():
        if executable.parent.parent.exists():
            raise RuntimeError(".venv klasörü mevcut ama Python'u çalışmıyor. Eski .venv klasörünü yeniden adlandırıp tekrar deneyin.")
        runtime = choose_python()
        print("İlk kurulum: projenin kendi Python ortamı hazırlanıyor…", flush=True)
        subprocess.run([str(runtime), "-m", "venv", str(ROOT / ".venv")], check=True)
    if python_version(executable) < PYTHON_MIN:
        raise RuntimeError("Projedeki .venv Python 3.12 veya daha yenisini gerektiriyor. Eski .venv klasörünü yeniden adlandırıp tekrar deneyin.")
    missing = missing_packages(executable, expected)
    if missing:
        print("İlk kurulum: kilitli paketler PyPI'den indiriliyor. Bu birkaç dakika sürebilir…", flush=True)
        pip_env = {key: value for key, value in os.environ.items()
                   if not key.startswith("PIP_") and key not in {"PYTHONHOME", "PYTHONPATH"}}
        pip_env["PIP_CONFIG_FILE"] = os.devnull
        pip_env["PYTHONNOUSERSITE"] = "1"
        subprocess.run([str(executable), "-m", "pip", "install", "--require-virtualenv",
                        "--disable-pip-version-check", "--index-url", "https://pypi.org/simple",
                        "--only-binary=:all:", "--no-deps", "-r", str(LOCK)],
                       env=pip_env, cwd=ROOT, check=True)
        if missing_packages(executable, expected):
            raise RuntimeError("Bazı paketler beklenen sürümde kurulamadı.")
    return executable


def health(url):
    try:
        # Ignore system proxy settings for a loopback-only check.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(url + "/health", timeout=2) as response:
            result = json.load(response)
        if result.get("status") == "ok" and result.get("version") == EXPECTED_VERSION:
            return result
    except (OSError, urllib.error.URLError, ValueError):
        pass
    return None


def port_open(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except OSError:
        return False


def parse_port(value):
    try:
        port = int(value)
    except (TypeError, ValueError) as exc:
        raise RuntimeError("AUTOSBC_PORT geçerli bir bağlantı noktası olmalı.") from exc
    if not 1024 <= port <= 65535:
        raise RuntimeError("AUTOSBC_PORT 1024–65535 arasında olmalı.")
    return port


def main(argv=None):
    parser = argparse.ArgumentParser(description="Auto-SBC Studio'yu proje içi ortamıyla başlatır.")
    parser.add_argument("--check", action="store_true", help="Kurulum yapmadan veya sunucu açmadan ortamı kontrol et.")
    parser.add_argument("--no-browser", action="store_true", help="Tarayıcıyı otomatik açma.")
    args = parser.parse_args(argv)
    try:
        port = parse_port(os.environ.get("AUTOSBC_PORT", "8000"))
        url = "http://127.0.0.1:" + str(port)
        if args.check:
            expected = locked_packages()
            executable = venv_python()
            missing = missing_packages(executable, expected) if executable.is_file() else list(expected)
            print(json.dumps({"project": str(ROOT), "python": str(executable),
                              "pythonVersion": python_version(executable), "missingPackages": missing,
                              "serverReady": bool(health(url)), "url": url}, ensure_ascii=False, indent=2))
            return 0 if not missing and python_version(executable) >= PYTHON_MIN else 1
        if health(url):
            print("Auto-SBC Studio zaten çalışıyor: " + url)
            if not args.no_browser:
                webbrowser.open(url)
            return 0
        if port_open(port):
            raise RuntimeError(f"{port} bağlantı noktasını başka bir uygulama kullanıyor. Bu uygulama durdurulmadı.")
        executable = bootstrap_environment()
        print("Auto-SBC Studio açılıyor: " + url, flush=True)
        print("Bu pencere açıkken çalışır. Durdurmak için Ctrl+C kullanın.", flush=True)
        process = subprocess.Popen([str(executable), "-m", "uvicorn", "backend.main:app",
                                    "--host", "127.0.0.1", "--port", str(port), "--log-level", "info"], cwd=ROOT)
        try:
            deadline = time.monotonic() + 40
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("Sunucu başlatılamadı. Yukarıdaki hata ayrıntılarını kontrol edin.")
                if health(url):
                    if not args.no_browser:
                        webbrowser.open(url)
                    return process.wait()
                time.sleep(0.3)
            raise RuntimeError("Sunucu zamanında hazır olmadı. Yukarıdaki hata ayrıntılarını kontrol edin.")
        except KeyboardInterrupt:
            print("\nAuto-SBC Studio durduruluyor…", flush=True)
            return 0
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
    except (RuntimeError, OSError, subprocess.SubprocessError) as exc:
        print("\nBaşlatılamadı: " + str(exc), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
