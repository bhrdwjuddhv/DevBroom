# Security Policy

DevBroom deletes files from your computer. A bug in the wrong place can destroy data, so security
reports are taken seriously and handled quickly.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x | Yes |
| < 1.0 | No |

## What counts as a security issue here

Please report privately, **not** as a public issue:

- Any path that lets DevBroom scan or delete outside a user-selected folder.
- A way to bypass the drive-root / home-root / system-folder guards.
- Symlink or junction handling that lets deletion escape the intended tree.
- A way for the renderer to reach the filesystem outside the `preload.js` bridge, or any remote-code
  execution through the Electron layer.
- Anything that would cause the app to send data off the machine (DevBroom has no telemetry — if you
  find a network call other than an AI-model download you explicitly started, that is a security bug).

Ordinary crashes, UI glitches, and wrong size calculations are normal bugs — please open a regular
issue for those.

## How to report

Please report privately through **GitHub's private vulnerability reporting**:

1. Go to <https://github.com/bhrdwjuddhv/DevBroom/security/advisories/new>
2. Describe the issue and how to reproduce it.

That form is private — only the maintainer can see it — and it lets us discuss a fix before anything
becomes public. If the form is unavailable to you, open a normal issue saying only *"security issue,
please enable private reporting"* with **no technical details**, and you'll be contacted there.

Please include:

- What the issue is and why it's dangerous.
- Steps to reproduce, ideally with a throwaway folder tree.
- Your OS, DevBroom version (Settings → About), and how you installed it.

Please do not post a working exploit publicly until a fix has shipped.

## What to expect

- **Within 48 hours** — acknowledgement that the report arrived.
- **Within 7 days** — an assessment and a rough fix timeline.
- **On release** — credit in the release notes, unless you'd rather stay anonymous.

DevBroom is a free, unpaid open-source project, so there is no bug bounty — just genuine gratitude and
a public thank-you.
