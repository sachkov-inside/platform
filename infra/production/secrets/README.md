# Production secret contract

Production ciphertext is repository-owned, but production values and age identities are not. The
owner-gated cutover creates the real `secrets.production.sops.json` with exactly the logical keys
from [`secret-policy.json`](secret-policy.json), encrypted to distinct host and offline recovery
recipients. No private key or decrypted source belongs in Git.

Create ciphertext without a plaintext file:

```bash
node scripts/production-secrets.mjs encrypt \
  --output config/production/secrets.production.sops.json \
  --host-recipient age1... \
  --offline-recipient age1... < /run/inside-secret-input.json
```

Materialize one generation into the host tmpfs-backed `/run` path. The command verifies two age
recipients before decrypting, rejects loose key permissions, writes only each service's declared
subset with mode `0400`, and atomically moves `current` after every file is durable.

```bash
sudo node scripts/production-secrets.mjs materialize \
  --encrypted config/production/secrets.production.sops.json \
  --runtime-root /run/inside/secrets \
  --generation v1 \
  --age-key-file /etc/inside/age/host.txt
```

Run `pnpm foundation:secrets:smoke` for a synthetic host/offline encryption and lost-host recovery.
