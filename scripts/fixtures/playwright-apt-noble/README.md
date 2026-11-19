# Offline Noble APT contract data

Public Ubuntu Noble release metadata, downloaded 2026-11-18 from the official archive:

- https://archive.ubuntu.com/ubuntu/dists/noble/InRelease
- https://archive.ubuntu.com/ubuntu/dists/noble/restricted/binary-amd64/Packages.xz

The original Noble release has Date 2024-04-25 and no Valid-Until field. Do not disable signature or date checks. The test uses the existing Ubuntu archive keyring, a file: repository, and real apt-get; it installs no packages. Hosts without Linux/Ubuntu keyring explicitly skip this native case. Ubuntu tooling CI must actually execute it.

The package archive SHA256 is aa3f9520f4e46cdcd610c7f0ce9450cda430f20085b028845e95122e9d61680c, 93924 bytes, also listed in the signed InRelease. InRelease SHA256 is cdb2f31d809f589719a53c6ad15f255b27569c4059542ada282aaa21b8e164b0. These bytes remain upstream signed data, not a generated test signature or a new trusted key.

The native test isolates only its test list/cache files, preserves normal dpkg status and system configuration, and captures Acquire debug solely in subprocess memory. It exposes only allowlisted Dir/DirEtc facts. It checks the effective root defaults, chosen offline source and retained unrelated index. It does not establish a real Playwright package installation or a Microsoft429 cause. Separate networkless diagnosis on pinned Noble reproduced the original relative lists/partial failure with unmodified default state paths.

This synthetic `file:` source explicitly selects `target=Packages`, matching the payload supplied here. The test adds the ordinary CNF target declaration per invocation to prove that source-specific selection works even with extra defaults enabled. It does not disable system targets or change production source lists. A local missing-CNF failure on the unrestricted fixture and success with this source option establish the fixture boundary, not the exact cause of the GitHub runner failure. Failure output contains only the fixed phase, exit and a proven allowlisted category, or `unknown`; raw debug, arguments, paths, environment and URLs stay in process memory.
