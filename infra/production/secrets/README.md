# Production secrets preparation

The repository owns only `.env.example` templates. Real values, encrypted files and age private
keys stay outside Git. During #244, the owner creates two age recipients: one private identity on
the host and one on separate encrypted recovery storage.

The host identity belongs at `/etc/inside/age/host.txt` with owner `root:root` and mode `0600`.
Encrypt each completed env file to both public recipients with SOPS and keep the ciphertext in the
password manager or approved encrypted storage. Decrypt it on the host into
`/etc/inside/foundation`; every resulting `.env` file must be `root:root` and mode `0600`.

Example for one file, after installing an owner-approved SOPS release during #244:

```bash
sops --encrypt \
  --input-type dotenv \
  --output-type dotenv \
  --age 'age1HOST,age1OFFLINE' \
  postgres.env >postgres.env.sops

sudo env SOPS_AGE_KEY_FILE=/etc/inside/age/host.txt \
  sops --decrypt --input-type dotenv --output-type dotenv postgres.env.sops \
  | sudo install -m 600 -o root -g root /dev/stdin \
      /etc/inside/foundation/postgres.env
```

Repeat for `logto-database.env` and `pgbackrest.env`. `database.env` and `logto.env` contain no
credentials but use the same root-owned delivery path so Compose has one configuration interface.
