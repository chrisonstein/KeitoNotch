---
name: keito
description: Log time or control the timer in Keito through the Keito Notch app on this Windows PC — "log 30 minutes on CSD-1234", "start a timer on ABC-12", "stop the timer", "what's running", "how much did I log today", "klok op", "boek een half uur", "timer stoppen", "wat heb ik vandaag geboekt". Uses the running app, so its ticket rules apply and the change shows in the notch with Undo.
---

# Keito via Keito Notch

Keito Notch (installed per user) ships a small command, `keito.ps1`, that hands a command to the **running**
app. The app books with the same rules as its form: the same ticket as before → the same project and task;
a ticket like earlier ones of that Jira project → that project; and the user's ticket rules from Settings →
Jira (e.g. `CSD-…` → Service Desk, with the customer from Jira's Organizations field as the task: a task
picked for that customer before, else the task with that name). Every booking shows a toast with **Undo** in
the notch.

Run it with PowerShell 7:

```
pwsh -NoProfile -File "$env:LOCALAPPDATA\Keito Notch\keito.ps1" <command> [args]
```

From Git Bash: `pwsh -NoProfile -File "$LOCALAPPDATA/Keito Notch/keito.ps1" status`.

| Command | Does |
|---|---|
| `status` | running timer (ticket, project, client, task, minutes) and today's entries |
| `start CSD-1234 [-Notes ".."]` | starts a timer on that ticket. **A running timer is stopped** (the message names it); Undo restores it |
| `log CSD-1234 30m [-Date yesterday] [-Notes ".."]` | books a fixed duration: `30m`, `1h`, `1h30`, `1.5h`, `1:30` |
| `stop` | stops the running timer |
| `-Project ".." -Task ".."` | with start/log: pick by name when the rules don't know, or to override them |

Without `-Notes` the ticket's Jira title becomes the note.

## Output and what to do with it

One JSON line: `{"ok":true|false,"message":"…",…}`.

- **Exit 0**: done. Tell the user the `message` (it names ticket, project and task) and that Undo is in the notch.
- **Exit 1**: refused, nothing was booked. The `message` says why, e.g. `No project known for ABC-12 yet`,
  or for a ruled ticket whose customer didn't settle the task:
  `Jira's customer for CSD-12 is "Acme-europe"; no single task matches it (closest: Acme, Acme Energies).
  Which task on Service Desk? Pass -Task "<name>"; the app remembers it for "Acme-europe". Options: …`
  (every task is listed; "Jira names no customer" means the ticket's Organizations field is empty).
  **Ask the user which task** — show the customer Jira gave and the closest names, not the whole list — and
  run it again with `-Task "<name>"` (a part of the name is enough when only one task contains it).
  **Never guess a project or task yourself**, not even when one name looks obviously right.
- **The task is then remembered** for that Jira customer (the success message says "Next tickets of … go to …
  too"), so the next ticket of that customer works without `-Task`. The user can see and remove these in
  Settings → Jira → *Remembered customers*.
- **Exit 2**: no answer (app not running, not installed, or busy). The outcome is **unknown**: run
  `status` first and only repeat a `log` when it's clearly not there, otherwise the time is booked twice.

## Rules

- Booking time is the user's work record: only book what the user asked for, with the duration they said.
  When they're vague ("log some time on that ticket"), ask how long.
- Confirm a `log` on another day than today in your reply (the date is in the message).
- `start` while a timer runs stops that timer: when the user didn't mention switching, say which one stopped
  (it's in the message) so they can Undo.
- `status` shows client names: fine in the user's own session; don't paste it into anything that leaves the machine.
- This only works on the Windows PC where Keito Notch runs; elsewhere the command isn't there (exit 2).

## Where this skill lives

It's a link (junction) to the copy installed with the app, `%LOCALAPPDATA%\Keito Notch\claude-skill`, so it
updates with the app. If it's gone (the link was removed), put it back with
`keito.ps1 install-skill` (all sessions: `~/.claude/skills`) or `keito.ps1 install-skill -SkillsDir
<folder>\.claude\skills` (only sessions started under that folder).
