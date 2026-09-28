"""Earth Engine initialisation for local runs and GitHub Actions."""

import json
import os

import ee

from .config import GEE_PROJECT


def init(deadline_s: int = 180) -> None:
    """Locally: run `earthengine authenticate` once and set GEE_PROJECT.
    In CI: set GEE_SERVICE_ACCOUNT_KEY to the service-account JSON key."""
    key = os.environ.get("GEE_SERVICE_ACCOUNT_KEY")
    if key:
        info = json.loads(key)
        creds = ee.ServiceAccountCredentials(info["client_email"], key_data=key)
        ee.Initialize(creds, project=GEE_PROJECT or info.get("project_id"))
    else:
        if not GEE_PROJECT:
            raise SystemExit("Set GEE_PROJECT to your Earth Engine Cloud project id.")
        ee.Initialize(project=GEE_PROJECT)
    # Fail (and let callers retry) instead of hanging forever on a stuck request.
    ee.data.setDeadline(deadline_s * 1000)
