"""Makes the key pair that signs alerts pushed to staff phones, and saves it in .env.

    python generate_vapid_keys.py mailto:you@example.com

Run it once per deployment, from backend/. The private key goes straight into .env
and is never printed. In the cloud, copy the three VAPID_ lines from .env into the
host's environment settings. A new pair makes every phone subscribe again, so don't
regenerate it without a reason.
"""

import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid
from py_vapid.utils import b64urlencode

ENV_FILE = Path(__file__).parent / ".env"
_NAMES = ("VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT")


def main(argv: list[str]) -> int:
    subject = argv[0] if argv else ""
    if not subject.startswith(("mailto:", "https://")):
        print("Give a contact for the push services: mailto:you@example.com", file=sys.stderr)
        return 2

    existing = ENV_FILE.read_text(encoding="utf-8").splitlines() if ENV_FILE.exists() else []
    if any(line.startswith("VAPID_PRIVATE_KEY=") and line.split("=", 1)[1].strip() for line in existing):
        print(f"{ENV_FILE} already has a VAPID key; remove its VAPID_ lines first to replace it.", file=sys.stderr)
        return 1

    vapid = Vapid()
    vapid.generate_keys()
    private = b64urlencode(vapid.private_key.private_numbers().private_value.to_bytes(32, "big"))
    public = b64urlencode(
        vapid.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    )
    kept = [line for line in existing if not line.startswith(tuple(f"{name}=" for name in _NAMES))]
    lines = [*kept, f"VAPID_PUBLIC_KEY={public}", f"VAPID_PRIVATE_KEY={private}", f"VAPID_SUBJECT={subject}"]
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Saved a new VAPID key pair in {ENV_FILE}. Public key: {public}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
