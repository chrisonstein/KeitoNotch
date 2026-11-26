import { describe, expect, it } from "vitest";
import { fixedProject, matchCustomer, recentTicketsOf, rememberCustomerTask, suggestForTicket, taskForOrganization } from "./ticketRules";
import type { Project, TimeEntry } from "./models";
import type { TicketRule } from "./prefs";

const serviceDesk: Project = { id: "sd", name: "CS - Service Desk", client: { id: "c1", name: "Customer support" } };
const otherDesk: Project = { id: "sd2", name: "Service desk (old)", client: { id: "c2", name: "Internal" } };
const internal: Project = { id: "int", name: "Internal hours", client: { id: "c3", name: "Example Co" } };
const mosaic: Project = { id: "mos", name: "Rollout", client: { id: "c4", name: "Acme" } };
const projects = [internal, otherDesk, serviceDesk, mosaic];

const entry = (key: string, projectId: string, taskId: string, taskName = "Task"): TimeEntry => ({
  id: `${key}-${projectId}`,
  project_id: projectId,
  task: { id: taskId, name: taskName },
  task_id: taskId,
  external_reference: { id: key },
});

/** What you'd set in Settings → Jira → Ticket rules for a service desk. */
const csdRule: TicketRule = { prefix: "CSD", projectId: "sd", projectName: "CS - Service Desk" };
const rules = [csdRule];

describe("fixedProject: a ticket rule from Settings", () => {
  it("finds the rule's project by id, whatever the key's case", () => {
    expect(fixedProject("CSD-1234", projects, rules)?.project.id).toBe("sd");
    expect(fixedProject("csd-9", projects, [{ ...csdRule, prefix: " csd " }])?.project.id).toBe("sd");
  });
  it("nothing for other prefixes, without rules, or when the project isn't trackable any more", () => {
    expect(fixedProject("MOS-12", projects, rules)).toBeUndefined();
    expect(fixedProject("CSD-1", projects, [])).toBeUndefined();
    expect(fixedProject("CSD-1", [internal, otherDesk, mosaic], rules)).toBeUndefined();
  });
});

describe("suggestForTicket", () => {
  it("no rules → nothing is built in: CSD is just another prefix", () => {
    expect(suggestForTicket("CSD-1", projects, [])).toBeUndefined();
    expect(suggestForTicket("CSD-2", projects, [entry("CSD-1", "int", "t-int")])?.project.id).toBe("int");
  });

  it("a rule without history → its project, fixed, task from the customer", () => {
    const s = suggestForTicket("CSD-1", projects, [], rules);
    expect(s).toMatchObject({ project: { id: "sd" }, fixed: true, customerTask: true, reason: "CSD → CS - Service Desk" });
    expect(s?.task).toBeUndefined();
  });

  it("a rule wins over another project you used for that prefix", () => {
    const s = suggestForTicket("CSD-2", projects, [entry("CSD-1", "int", "t-int")], rules);
    expect(s?.project.id).toBe("sd");
  });

  it("the same ticket logged before → same project and task (the customer)", () => {
    const s = suggestForTicket("CSD-5", projects, [entry("CSD-5", "sd", "t-acme", "Acme")], rules);
    expect(s?.project.id).toBe("sd");
    expect(s?.task).toEqual({ id: "t-acme", name: "Acme" });
    expect(s?.fixed).toBe(true);
  });

  it("an old entry of a ruled ticket on another project is ignored: the rule's project stays", () => {
    const s = suggestForTicket("CSD-5", projects, [entry("CSD-5", "int", "t-int")], rules);
    expect(s?.project.id).toBe("sd");
    expect(s?.task).toBeUndefined();
  });

  it("other prefixes follow the newest earlier ticket with that prefix, not fixed", () => {
    const s = suggestForTicket("MOS-77", projects, [entry("MOS-3", "mos", "t-dev"), entry("MOS-1", "int", "t-int")], rules);
    expect(s?.project.id).toBe("mos");
    expect(s?.fixed).toBe(false);
    expect(s?.customerTask).toBe(false);
    expect(s?.task).toBeUndefined();
  });

  it("nothing known → no suggestion", () => {
    expect(suggestForTicket("ABC-1", projects, [entry("MOS-3", "mos", "t")], rules)).toBeUndefined();
  });

  it("a prefix is not a substring match (CS ≠ CSD)", () => {
    expect(suggestForTicket("CS-1", projects, [entry("CSD-3", "sd", "t")], rules)).toBeUndefined();
  });
});

describe("taskForOrganization: the customer task in Service Desk", () => {
  const tasks = [
    { id: "1", name: "Acme" },
    { id: "2", name: "Globex" },
    { id: "3", name: "Initech Groep" },
    { id: "4", name: "Phone call" },
    { id: "5", name: "Acme Energies" },
  ];
  it("exact name, ignoring case and legal form", () => {
    expect(taskForOrganization(["Globex B.V."], tasks)?.id).toBe("2");
    expect(taskForOrganization(["acme"], tasks)?.id).toBe("1");
  });
  it("one task containing the organisation (or the other way round)", () => {
    expect(taskForOrganization(["Initech"], tasks)?.id).toBe("3");
  });
  it("ambiguous or unknown → undefined, you pick", () => {
    expect(taskForOrganization(["Energies"], [...tasks, { id: "6", name: "Energies NL" }])).toBeUndefined();
    expect(taskForOrganization(["Unknown Corp"], tasks)).toBeUndefined();
    expect(taskForOrganization([], tasks)).toBeUndefined();
  });
  it("tries the next organisation when the first has no match", () => {
    expect(taskForOrganization(["Unknown", "Globex"], tasks)?.id).toBe("2");
  });
  it("two organisations with each their own task → undefined, whatever Jira's order", () => {
    expect(taskForOrganization(["Acme", "Globex"], tasks)).toBeUndefined();
    expect(taskForOrganization(["Globex", "Acme"], tasks)).toBeUndefined();
  });
  it("two organisations that land on the same task → that task", () => {
    expect(taskForOrganization(["Globex", "Globex B.V."], tasks)?.id).toBe("2");
  });
  it("a longer Jira name with a region: the task it starts with, not a task with a later word", () => {
    const withRegion = [...tasks, { id: "7", name: "Europe Logistics" }, { id: "8", name: "Europe" }];
    expect(taskForOrganization(["Acme-europe"], withRegion)?.id).toBe("1");
    expect(taskForOrganization(["Acme Energies NL"], tasks)?.id).toBe("5");
  });
  it("tasks that merely contain the name stay unclear", () => {
    expect(taskForOrganization(["Energies"], [...tasks, { id: "6", name: "Energies NL" }])).toBeUndefined();
  });
});

describe("matchCustomer: what the form and Claude get back", () => {
  const tasks = [
    { id: "1", name: "Acme" },
    { id: "2", name: "Acme Energies" },
    { id: "3", name: "Globex" },
  ];
  it("no single match: the customer names and the look-alike tasks, for 'did you mean'", () => {
    // "Acme" is where the name starts, but "Acme Systems Services" holds the whole name: unclear.
    const m = matchCustomer(["Acme Systems"], [...tasks, { id: "4", name: "Acme Systems Services" }]);
    expect(m.task).toBeUndefined();
    expect(m.orgs).toEqual(["Acme Systems"]);
    expect(m.candidates.map((t) => t.id)).toEqual(["1", "4"]);
  });
  it("Jira names no customer → no task, no orgs (the form then uses the last task)", () => {
    expect(matchCustomer([], tasks)).toEqual({ task: undefined, orgs: [], candidates: [], remembered: false });
  });
  it("a remembered pick wins over the name match, only on its own project", () => {
    const learned = rememberCustomerTask([], "Initrode B.V.", "sd", tasks[2], tasks);
    expect(matchCustomer(["initrode"], tasks, "sd", learned)).toMatchObject({ task: { id: "3" }, remembered: true });
    expect(matchCustomer(["initrode"], tasks, "other", learned).task).toBeUndefined();
  });
  it("a remembered task that no longer exists falls back to the name match", () => {
    const learned = rememberCustomerTask([], "Acme", "sd", { id: "gone", name: "Old" }, tasks);
    expect(matchCustomer(["Acme"], tasks, "sd", learned)).toMatchObject({ task: { id: "1" }, remembered: false });
  });
});

describe("rememberCustomerTask", () => {
  const tasks = [
    { id: "1", name: "Acme" },
    { id: "3", name: "Globex" },
  ];
  it("stores a pick the name match wouldn't make, newest first, one per customer and project", () => {
    let l = rememberCustomerTask([], "Initrode", "sd", tasks[1], tasks);
    l = rememberCustomerTask(l, "Hooli", "sd", tasks[0], tasks);
    l = rememberCustomerTask(l, "INITRODE B.V.", "sd", tasks[0], tasks);
    expect(l.map((x) => `${x.org}→${x.taskId}`)).toEqual(["initrode→1", "hooli→1"]);
    expect(l[0]).toMatchObject({ orgName: "INITRODE B.V.", taskName: "Acme" });
  });
  it("a pick the name match makes anyway isn't stored, and clears an old memory", () => {
    const l = rememberCustomerTask([], "Acme", "sd", tasks[1], tasks);
    expect(l).toHaveLength(1);
    expect(rememberCustomerTask(l, "Acme", "sd", tasks[0], tasks)).toEqual([]);
  });
});

describe("recentTicketsOf: the tickets you logged lately", () => {
  const e = (id: string, ref?: { id: string; display_name?: string }): TimeEntry => ({ id, external_reference: ref ?? null });
  it("newest first, each once, title without the key, non-Jira links skipped", () => {
    const history = [
      e("1", { id: "CSD-12", display_name: "CSD-12 Printer offline" }),
      e("2"),
      e("3", { id: "csd-12", display_name: "CSD-12 Printer offline" }),
      e("4", { id: "https://example.com/x" }),
      e("5", { id: "MOS-3", display_name: "MOS-3: Release notes" }),
      e("6", { id: "ABC-1", display_name: "Plain title" }),
    ];
    expect(recentTicketsOf(history, 5)).toEqual([
      { key: "CSD-12", summary: "Printer offline" },
      { key: "MOS-3", summary: "Release notes" },
      { key: "ABC-1", summary: "Plain title" },
    ]);
  });
  it("stops at the limit", () => {
    const history = ["AB-1", "AB-2", "AB-3"].map((k, i) => e(String(i), { id: k }));
    expect(recentTicketsOf(history, 2).map((t) => t.key)).toEqual(["AB-1", "AB-2"]);
  });
});
