import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { JevClient } from "../providers/jev/client.js";
import { DiscoveryRuntime, defaultSkillRoots } from "./runtime.js";
function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], details: value };
}

export function registerDiscoveryTools(pi: ExtensionAPI): void {
  const runtime = new DiscoveryRuntime({
    list: () => pi.getAllTools()
      .filter((tool) => tool.name !== "decision_find_tools" && tool.name !== "decision_find_skill")
      .map((tool) => ({ name: tool.name, description: tool.description })),
  }, new JevClient());

  const params = pi.typebox.Type.Object({
    query: pi.typebox.Type.String({ description: "Describe the capability you need." }),
    limit: pi.typebox.Type.Optional(pi.typebox.Type.Integer({ minimum: 1, maximum: 20 })),
  });

  pi.registerTool({
    name: "decision_find_tools",
    label: "Find Tools",
    description: "Find OMP tools relevant to a capability or task. Use when the needed tool name is unknown.",
    parameters: params,
    approval: "read",
    loadMode: "discoverable",
    async execute(_id, rawParams) {
      const params = rawParams as { query: string; limit?: number };
      const value = await runtime.findTools(params.query, params.limit ?? 8);
      try {
        const active = pi.getActiveTools();
        const discovered = value.matches.filter((m) => m.score >= 5).map((m) => m.name);
        const toActivate = discovered.filter((name) => !active.includes(name));
        if (toActivate.length > 0) {
          await pi.setActiveTools([...active, ...toActivate]);
        }
      } catch {
        // Safe fallback if setActiveTools is unsupported or restricted
      }
      return result(value);
    },
  });

  pi.registerTool({
    name: "decision_find_skill",
    label: "Find Skill",
    description: "Find OMP/Pi skills relevant to a task from project and user skill directories.",
    parameters: params,
    approval: "read",
    loadMode: "discoverable",
    async execute(_id, rawParams, _signal, _update, ctx) {
      const params = rawParams as { query: string; limit?: number };
      const value = await runtime.findSkills(params.query, defaultSkillRoots(ctx.cwd), params.limit ?? 8);
      return result(value);
    },
  });
}
