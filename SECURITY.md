# Security Policy

MLBB Co-Pilot is a local-first public alpha. Security reports are welcome, especially around local HTTP endpoints, file upload handling, module update validation, dependency risk, Electron packaging, and unsafe handling of credentials or logs.

## Supported Versions

| Version | Security support |
| --- | --- |
| `0.4.x` | Best-effort public alpha support |
| Earlier versions | Not supported |

## Reporting A Vulnerability

Use GitHub private vulnerability reporting if it is available for this repository. If private reporting is unavailable, open a public issue that only asks for a security contact and does not include exploit details.

Please include:

- Affected version or commit.
- Operating system and install path.
- Reproduction steps.
- Impact and affected component.
- Whether any token, private capture, local file, or third-party service is involved.

Do not post secrets, GMS authorization headers, private gameplay footage, private screenshots, or exploit payloads in public issues.

## Scope

In scope:

- Local API security issues.
- Unsafe file writes or path traversal.
- Module update validation bypasses.
- Dependency or packaging vulnerabilities.
- Electron shell risks.
- Accidental disclosure of secrets or private local data.

Out of scope:

- Issues requiring physical access to an unlocked machine.
- Game account enforcement, matchmaking, or platform moderation decisions.
- Requests to bypass Mobile Legends: Bang Bang protections or third-party terms.
