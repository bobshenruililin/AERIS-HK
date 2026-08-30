"""Entry point for running the AERIS-HK API/dashboard server."""

from __future__ import annotations

import os

import uvicorn


def main() -> None:
    host = os.environ.get("AERIS_HOST", "0.0.0.0")
    port = int(os.environ.get("AERIS_PORT", "8000"))
    uvicorn.run("aeris_hk.api:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
