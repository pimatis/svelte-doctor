import pc from "picocolors";

type ClaudeEvent = {
  type?: string;
  subtype?: string;
  message?: { content?: Array<{ type?: string; text?: string }> };
  content?: Array<{ type?: string; text?: string }>;
  tool_call?: { name?: string; args?: { path?: string } };
  [key: string]: unknown;
};

const formatClaudeLine = (line: string): string | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const obj = JSON.parse(trimmed) as ClaudeEvent;
    const type = obj.type;
    const subtype = obj.subtype;

    if (type === "message_start" || (type === "system" && subtype === "init")) {
      return pc.dim("  Starting agent...\n");
    }

    if (type === "message_delta" && obj.content) {
      const part = obj.content.find((c) => c.type === "text" && c.text);
      if (part && "text" in part && typeof part.text === "string" && part.text.trim()) {
        return `  ${part.text.trim()}\n`;
      }
      return null;
    }

    if (type === "assistant" && obj.message?.content) {
      const part = obj.message.content.find((c) => c.type === "text" && c.text);
      if (part && "text" in part && typeof part.text === "string" && part.text.trim()) {
        return `  ${part.text.trim()}\n`;
      }
      return null;
    }

    if ((type === "tool_use" || type === "tool_call") && subtype === "started") {
      const name = obj.tool_call?.name ?? "tool";
      const path = obj.tool_call?.args?.path;
      const file = path ? path.split("/").slice(-2).join("/") : "";
      return pc.dim(`  ${name} ${file}\n`);
    }

    if (type === "message_stop" || (type === "result" && subtype === "success")) {
      return pc.green("  ✓ Done.\n");
    }

    return null;
  } catch {
    return null;
  }
};

export { formatClaudeLine };
