import importlib.util
from pathlib import Path

import pytest


SPEC = importlib.util.spec_from_file_location("studio_launcher", Path(__file__).parents[1] / "scripts/start_studio.py")
launcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(launcher)


def test_lock_reader_accepts_exact_registry_pins(tmp_path):
    lock = tmp_path / "requirements.txt"
    lock.write_text("# fixed wheels\nmy_package==1.2.3\nexample.lib==4.5\n")
    assert launcher.locked_packages(lock) == {"my-package": "1.2.3", "example-lib": "4.5"}


@pytest.mark.parametrize("entry", ["thing>=1", "--extra-index-url https://example.com", "thing @ https://example.com/x.whl", "git+https://example.com/project.git", "thing==1\nthing==2"])
def test_lock_reader_refuses_urls_directives_and_conflicting_pins(tmp_path, entry):
    lock = tmp_path / "requirements.txt"
    lock.write_text(entry)
    with pytest.raises(RuntimeError):
        launcher.locked_packages(lock)


def test_port_validation_and_normalization():
    assert launcher.parse_port("8000") == 8000
    assert launcher.normalized_name("Typing_Extensions") == "typing-extensions"
    for value in ("broken", 80, 99999):
        with pytest.raises(RuntimeError):
            launcher.parse_port(value)


def test_existing_local_server_does_not_install_or_start_again(monkeypatch):
    monkeypatch.setattr(launcher, "health", lambda url: {"status": "ok"})
    monkeypatch.setattr(launcher, "bootstrap_environment", lambda: pytest.fail("Must not install for existing server"))
    monkeypatch.setattr(launcher.subprocess, "Popen", lambda *a, **kw: pytest.fail("Must not start duplicate server"))
    assert launcher.main(["--no-browser"]) == 0


def test_occupied_unknown_port_is_not_taken_over(monkeypatch):
    monkeypatch.setattr(launcher, "health", lambda url: None)
    monkeypatch.setattr(launcher, "port_open", lambda port: True)
    monkeypatch.setattr(launcher, "bootstrap_environment", lambda: pytest.fail("Must not install on occupied port"))
    assert launcher.main(["--no-browser"]) == 1
