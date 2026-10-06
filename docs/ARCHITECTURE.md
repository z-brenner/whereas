# Architecture

This document records the decisions behind Whereas and the reasons for them. It is meant to be read before changing anything structural.

## The shape of the system

Whereas is one server process with one data directory. The server holds a SQLite database, a folder of files named by their SHA-256 hash, and an encryption key. The web app is static files served by the same process. There are no other services.

This shape was chosen because the product has to run in three places with one codebase: on a company's own server, in a container, and later on a single laptop inside a desktop app. A design that needs Postgres, a queue and object storage cannot do the third.

## Why the document stays a Word file

A contract template is uploaded as a .docx file and stays a .docx file. Whereas never converts it to Markdown, HTML or any other format for storage.

Legal documents depend on things that only Word's format carries reliably: multi-level numbering, defined-term styling, tables, signature blocks, section breaks and tracked changes. Counterparties also send redlines back as Word files. Any intermediate format would lose some of this, and the loss would show up as an agreement that no longer looks like the firm's paper.

The template is therefore stored in two parts:

1. The original .docx, byte for byte, never modified.
2. A JSON definition that describes what changes from one agreement to the next.

The definition points at ranges of text in the document by paragraph number and character offset. Each range also records the text it covered, so that a mismatch is detected and reported instead of silently producing a wrong agreement.

A request stores only its answers as JSON. The agreement is generated on demand by applying the definition and the answers to a copy of the original file.

### The five kinds of mark

| Mark | What it does |
| --- | --- |
| Question | Replaces the text with the answer to a question |
| Condition | Keeps a phrase, paragraph or table row only when a rule holds |
| Wording | Replaces the text with wording chosen by the answer to a question |
| Repeat | Repeats whole paragraphs or table rows once per entry in a list |
| Signature | Marks where a signer signs, initials or dates |

Rules can be nested, so "A and (B or C)" is expressible. Questions can themselves be conditional. An answer to a question that is no longer asked is ignored during generation, so a stale answer cannot steer the document.

Removing a conditional paragraph removes the paragraph element itself. Word then renumbers the clauses that follow, and cross-references keep working.

### One definition of text

The file `packages/core/src/model.ts` contains the only code that decides what a paragraph is and what its text is. The on-screen renderer, the template builder and the generator all call it. This is what guarantees that a selection made on screen refers to the same characters when the document is generated.

### Signature positions

Signature marks become text that the signature provider recognises. DocuSeal reads field tags. DocuSign reads anchor strings, which Whereas writes in white so signers do not see them. Because the position is text in the document, it moves with the text when clauses are added or removed. Fixed page coordinates would not.

Both providers accept Word files and convert them. PDF conversion inside Whereas is therefore only needed for downloads, and Whereas works without LibreOffice.

## Requests

A request moves through these states:

```
draft -> submitted -> in_review -> awaiting_signature -> completed
            ^             |
            +-- returned <+
any open state -> cancelled
```

A request keeps the template version it started on. Publishing a new version of a template never changes a request that is already in progress.

Every change to a request appends a row to an activity log. The "last activity" column is the time of the newest row.

Signature steps wait on an outside provider, so two of them could otherwise interleave on one request. Each one runs alone per request and reads the request again before it writes.

## Security

- Passwords are hashed with scrypt. Sessions are random tokens stored as hashes.
- Every change requires a custom request header, which a browser will not send across sites. This blocks forged requests without a token exchange.
- Requesters see only their own requests and the signed copy. Working drafts and other people's requests stay with legal.
- Provider credentials are encrypted with a key kept in a separate file, and are never sent back to the browser.
- Uploads are limited in size before they are read, and archives that expand beyond a sane size are refused.
- Answers are cleaned of control characters, because one stray character from pasted text would make the generated file unreadable.

## The desktop app and working without a server

The desktop app has not been built. The plan is a Tauri shell that starts this same server on the local machine and points a window at it. A single person then has the whole product on a laptop with nothing to host.

Sharing between people without a server is a harder problem, and two common answers were rejected:

- **Peer to peer.** Both people must be online at once, or a relay must hold messages. A relay is a server. Key exchange and firewall traversal add failure modes that are hard to explain to a legal team.
- **Using each person's mailbox as the transport.** This needs mailbox permissions that IT departments often refuse. Mail is filtered, delayed and reordered, and none of that is visible to the app.

Counterparties never need Whereas at all, because the signature provider delivers the document to them. The only people who share state are colleagues inside one organisation.

For those colleagues, the planned approach is a shared workspace folder on storage the organisation already runs, such as SharePoint, OneDrive or a network drive. Each change is written as a new file that is never edited afterwards. Sync tools handle that pattern safely, where they would corrupt a shared database file. Access control and backup come from the storage the organisation already trusts.

One limit should be stated plainly. Requesters are usually many, and asking each of them to install a desktop app is a poor fit. The folder approach suits a small legal team. An organisation with many requesters should run the server.

## What is not verified

- The DocuSign and DocuSeal adapters are tested against the request and response shapes in each provider's documentation. They have not been run against live accounts.
- The Dockerfile has not been built.
- The design mirrors common document-automation behaviour and the request list columns given in the brief. It was not checked feature by feature against Summize, whose help centre is not public.
