"""Public HTTPS address via a localhost.run SSH tunnel, reconnected automatically when it drops."""
import asyncio
import logging
import re
import shutil
from typing import Awaitable, Callable

from . import config

log = logging.getLogger("musique.tunnel")

URL_RE = re.compile(rb"https://[a-z0-9-]+\.lhr\.life")


def _ssh() -> str:
    return shutil.which("ssh") or r"C:\Windows\System32\OpenSSH\ssh.exe"


async def run(on_url: Callable[[str], Awaitable[None]]) -> None:
    delay = 2
    while True:
        proc = await asyncio.create_subprocess_exec(
            _ssh(), "-T",
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", "ServerAliveInterval=30",
            "-o", "ServerAliveCountMax=3",
            "-o", "ExitOnForwardFailure=yes",
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=15",  # a service that accepts the connection but never answers must not hang the reconnect loop
            "-R", f"80:127.0.0.1:{config.PORT}",
            "nokey@localhost.run",
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        try:
            async for line in proc.stdout:
                m = URL_RE.search(line)
                if m and m.group().decode() != config.PUBLIC_API_URL:
                    url = m.group().decode()
                    log.info("tunnel up: %s", url)
                    await on_url(url)
                    delay = 2
        except asyncio.CancelledError:
            proc.kill()
            raise
        finally:
            if proc.returncode is None:
                proc.kill()
        await proc.wait()
        log.warning("tunnel closed, reconnecting in %ss", delay)
        await asyncio.sleep(delay)
        delay = min(delay * 2, 60)
