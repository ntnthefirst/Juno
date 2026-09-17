# Start here

Bureau has a plan, a design system and a set of working rules. It has no
application code yet. This is how to begin.

---

## 1. Read these three, in this order

| File | Why |
| --- | --- |
| [PLAN.md](PLAN.md) | The phases, what ships in each, and the test for when one is done |
| [docs/decisions.md](docs/decisions.md) | What is already decided, and what would have to change for it to be reopened |
| [CLAUDE.md](CLAUDE.md) | The rules a session loads automatically, and the index to the rest |

Twenty minutes. Worth it, because phase 0 assumes all three.

## 2. Decide the two things that are still open

Neither blocks phase 0, but both get more expensive the longer they wait.

- **The licence.** The repository has none, so it is all rights reserved by
  default. Decide before it goes public. The question that settles it: should a
  company be able to take Bureau, host it, and sell it back to people?
- **Where it lives online.** The plan assumes its own GitHub organisation rather
  than a personal account or the Digistra one, so the project outlives whichever
  business is current. Moving a repository after installers ship is painful,
  because the update feed points at the old location.

## 3. Build phase 0

Open a session in this folder and say what you want, or invoke a skill directly:

```
/feature-new clients
```

Phase 0 is the shell, the database and one real screen: Electron plus Vite, the
first Drizzle migration with the five mandatory columns, a `clients` service, its
IPC and MCP adapters, and a list you can actually put your own clients into.

It is deliberately small. The point is an application that opens and holds real
data by the end of the first week, not a perfect foundation nobody has run.

## 4. Then work a phase at a time

| You want | Say |
| --- | --- |
| A whole new domain | `/feature-new documents` |
| A new screen | `/screen-new` |
| An existing service exposed to the agent | `/mcp-tool-new` |
| A schema change | `/migration-new` |
| A contract or email template | `/template-new` |
| Commits for finished work | `/commit-work` |
| Pre-release check | `/ship-check` |

## 5. The two rules worth memorising

**The services layer is the API.** Every capability is written once as a service
function. The IPC bridge and the MCP server are thin adapters over it. A feature
the agent cannot drive is not finished.

**Five columns on every table, from the first migration.** UUIDv7 `id`,
`owner_id`, `created_at`, `updated_at`, `deleted_at`. Adding them now costs an
hour. Retrofitting them costs a rewrite.

---

## A note on scope

The plan is ordered by pain relieved, not by architecture, and every phase is
useful on its own. That ordering exists on purpose: the previous large project
here stalled at phase 7 of a much bigger plan, and the cause was size rather
than effort.

The way this one survives is that phase 1 is in daily use before phase 2 starts.
If a phase is not being used, the next phase is the wrong thing to build.
