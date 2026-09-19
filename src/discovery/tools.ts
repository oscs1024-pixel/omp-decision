import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
 import { DiscoveryRuntime, defaultSkillRoots } from "./runtime.js";

 
function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], details: value };
}

export function registerDiscoveryTools(pi: ExtensionAPI): void {
  const Params = pi.zod.object({
    query: pi.zod.string().describe("Describe the capability you need."),
    limit: pi.zod.number().int().min(1).max(20).optional(),
  });
  const runtime = new DiscoveryRuntime({
    list: () => pi.getAllTools()
      .filter((tool) => tool.name !== "decision_find_tools" && tool.name !== "decision_find_skill")
      .map((tool) => ({ name: tool.name, description: tool.description, source: tool.sourceInfo.source, active: pi.getActiveTools().includes(tool.name) })),
  });

  pi.registerTool({
    name: "decision_find_tools",
    label: "Find Tools",
    description: "Find OMP tools relevant to a capability or task. Use when the needed tool name is unknown.",
    parameters: Params,
    approval: "read",
    loadMode: "discoverable",
    async execute(_id, params) {
      const value = runtime.findTools(params.query, params.limit ?? 8);
      return result(value);
    },
  });

  pi.registerTool({
    name: "decision_find_skill",
    label: "Find Skill",
    description: "Find OMP/Pi skills relevant to a task from project and user skill directories.",
    parameters: Params,
    approval: "read",
    loadMode: "discoverable",
    async execute(_id, params, _signal, _update, ctx) {
      const value = await runtime.findSkills(params.query, defaultSkillRoots(ctx.cwd), params.limit ?? 8);
      return result(value);
    },
  });
}
