# Contributing

A flaw in the library itself (token forgery, script injection, a leaking secret) goes to [SECURITY.md](SECURITY.md), not to a
public issue.

**Found an agent that gets through?** Open an issue with the agent, model and version, the prompt, the configuration you tested, and
what the server log recorded. A reproducible bypass is the most useful contribution you can make.

**Found a person it hurts?** That matters more. If the SDK blocks, confuses or slows anyone using a screen reader, voice control,
switch access, a password manager or anything else, open an issue. We treat these as release blockers.

**Changing the SDK.** Run `npm test` and `npm run mutants`. A new behaviour needs a test that fails without it. A new signal must
keep the property tests in `tests/features.prop.test.ts` passing, and if it collides with a group of people, add that group as a new property.

**Rules the SDK keeps.** It never branches on user agent or IP, never probes for extensions or assistive technology, never records key
identities or coordinates, and does not block on a behavioural score alone without offering a way through. `tests/static.test.ts` enforces most of this.

**Claims.** Any number in the docs needs a run behind it in `bench/results`, and a new experiment writes down its prediction first, in
`docs/experiments/predictions.md`.
