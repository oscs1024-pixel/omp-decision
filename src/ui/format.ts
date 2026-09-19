import type { ToolCall } from "../review/types.js";

export function formatUserConfirmation(call: ToolCall, reason?: string): string {
  let targetDesc = "";
  if (call.toolName === "bash" && typeof call.input.command === "string") {
    const cmd = call.input.command.trim();
    targetDesc = cmd.length > 150 ? cmd.slice(0, 150) + "…" : cmd;
  } else if (typeof call.input.path === "string") {
    targetDesc = call.input.path;
  } else if (typeof call.input.input === "string") {
    const firstLine = call.input.input.trim().split("\n")[0] ?? "";
    targetDesc = firstLine.length > 100 ? firstLine.slice(0, 100) + "…" : firstLine;
  } else {
    const keys = Object.keys(call.input);
    targetDesc = keys.length > 0 ? `args: { ${keys.slice(0, 4).join(", ")} }` : "";
  }

  let explanation = reason ?? "此操作需要人工核准后方可执行。";
  if (reason?.includes("protected_path") || reason?.includes("protected by policy")) {
    explanation = `目标涉及受保护敏感文件 (${reason})，修改可能影响关键配置或生产环境。`;
  } else if (reason?.includes("below threshold") || reason?.includes("below_threshold")) {
    explanation = "语义模型对该调用的意图或执行范围存在不确定性，需要人工确认操作安全性。";
  } else if (reason?.includes("hazard") || reason?.includes("Hazard")) {
    explanation = `审查规则检测到潜在风险：${reason}。`;
  }

  return [
    `【操作申请】Agent 正在尝试调用工具: ${call.toolName}`,
    targetDesc ? `【执行目标】${targetDesc}` : "",
    `【拦截说明】${explanation}`,
    "",
    "是否允许 Agent 执行此操作？(按回车或确认以授权，按 ESC 或取消以阻断)",
  ].filter(Boolean).join("\n");
}
