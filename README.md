# Whereas

Whereas is a contract workflow tool you host yourself. Legal turns a Word agreement into a template, colleagues request an agreement by answering questions, legal reviews the result and sends it for signature.

This repository holds Stage 1: templates, requests, review, and signature. A repository of signed agreements, request analytics and playbooks come later.

## What works today

- **Templates.** Upload a .docx file. Select text in the document and turn it into a question, a conditional clause, alternative wording, a repeating block or a signature block. Nothing is installed in Word and the original file is never changed.
- **Requests.** Pick a template, answer its questions, and watch the agreement fill in as you type. Each request keeps the template version it started on.
- **Review.** Legal owns a request, answers its own questions, adds tasks, returns a request to the requester with a note, and downloads the agreement as Word or PDF.
- **Signature.** Send through DocuSign or DocuSeal, or send the document yourself and upload the signed copy. Status is polled, so no inbound webhook is needed.
- **Lists.** "To do", "Requested by me" and "All requests", with ID, name, status, tasks, requester, owner, template, date requested, last activity and signature status.

## Run it

You need Node 22 and pnpm. LibreOffice is optional and only used for PDF downloads.

```sh
pnpm install
pnpm build
pnpm start
```

Open http://localhost:3000. The first visit creates the admin account and can add a sample template.

Settings are environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `WHEREAS_DATA_DIR` | `./data` | Where the database, files and encryption key live |
| `WHEREAS_BASE_URL` | `http://localhost:PORT` | Public address. Use `https://` in production so cookies are marked secure |

Everything Whereas stores is inside the data directory. Back that directory up and you have backed up the install. Keep `secret.key` with it, because provider credentials cannot be read without it.

A `Dockerfile` is included. It has not been built in CI yet.

## Develop

```sh
pnpm dev        # server on 3000, web app on 5173
pnpm test       # unit and API tests
pnpm typecheck
pnpm e2e        # browser test against a running server, see e2e/run.mjs
```

The code is in three packages:

- `packages/core` is the document engine. It reads a .docx, applies a template definition and answers, and writes a .docx. It runs unchanged in the browser and on the server, which is why the preview matches the generated file.
- `apps/server` is the API, with SQLite and files on disk.
- `apps/web` is the React app.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design decisions and the plan for the desktop app.

## Known limits

- The DocuSign and DocuSeal integrations are tested against recorded request shapes, not against live accounts. Try each one in a sandbox before relying on it.
- Adobe Sign is not built yet.
- Marks can be placed in the body of a document and in tables. Headers, footers, footnotes and text boxes are left as they are.
- The on-screen preview is close to Word but not identical. The downloaded file is the real thing.
- Accounts are local email and password. Single sign-on is not built yet.
- No license has been chosen for this repository yet.
