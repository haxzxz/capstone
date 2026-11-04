from pathlib import Path
from cryptography.fernet import Fernet

# Run from the backend directory; this uses the key created by the API for telemetry export.
key = Path("telemetry.key").read_bytes().strip()
encrypted_csv = Path("school-zone-telemetry.csv.enc").read_bytes()
csv_data = Fernet(key).decrypt(encrypted_csv)
Path("school-zone-telemetry.csv").write_bytes(csv_data)
