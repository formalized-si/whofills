# Security policy

## Two kinds of report

**An agent that gets through** is not a vulnerability in this sense. It is the research question, and the most useful
thing you can send. Open a public issue with the agent, model and version, the prompt, the configuration and what the
server log recorded ([CONTRIBUTING.md](CONTRIBUTING.md)).

**A flaw in the library itself** should be reported privately. Examples: a way to forge a server-accepted token without
running the page, a way to read or change another visitor's decision, script injection through an attribute or a
`fallbackHtml` value, or a secret that can leak to the client. Write to us through the contact details at
[formalized.si/about](https://formalized.si/about/#contact) with the version, a minimal reproduction and the impact.
Please do not open a public issue for these until a fix is out.

## What to expect

We will reply, agree on a disclosure date with you, and credit you in the release notes unless you ask us not to.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | Yes |

## Known limits

Client signals can be forged by code written against this library, and code can decode the moving digits by comparing
frames. The README lists these under [Limits](README.md#limits); they are not new reports.
