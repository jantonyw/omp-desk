# Security Policy

## Credentials

- **Do not paste API keys**, tokens, or other secrets into omp-desk, screenshots, issues, or pull requests.
- Provider credentials and agent config live in **omp** / `~/.omp` (for example `~/.omp/agent/config.yml`), **not** in this app. omp-desk only shells `omp --mode rpc-ui`.

## Reporting a vulnerability

Please report security issues privately when possible:

1. Prefer a **[GitHub private security advisory](https://github.com/jantonyw/omp-desk/security/advisories/new)** on this repository (if available for your account).
2. If private advisories are unavailable, open a **GitHub issue** titled clearly (e.g. `Security: …`) and avoid including exploit details or secrets in the public body — offer to follow up privately.

We will acknowledge reports and work on a fix as capacity allows. Thank you for helping keep users safe.
