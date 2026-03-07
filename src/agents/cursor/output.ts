import pc from "picocolors";

type CursorEvent = {
  type?: string;
  subtype?: string;
  text?: string;
  message?: { content?: Array<{ type?: string; text?: string }> };
  tool_call?: {
    readToolCall?: { args?: { path?: string } };
    writeToolCall?: { args?: { path?: string } };
    searchReplaceToolCall?: { args?: { path?: string } };
    [key: string]: unknown;
  };
};

const formatCursorLine = (line: string): string | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const obj = JSON.parse(trimmed) as CursorEvent;
    const type = obj.type;
    const subtype = obj.subtype;

    if (type === "system" && subtype === "init") {
      return pc.dim("  Starting agent...\n");
    }

    if (type === "user") return null;

    if (type === "thinking") return null;

    if (type === "assistant" && obj.message?.content) {
      const part = obj.message.content.find((c) => c.type === "text" && c.text);
      if (part && "text" in part && typeof part.text === "string" && part.text.trim()) {
        return `  ${part.text.trim()}\n`;
      }
      return null;
    }

    if (type === "tool_call" && subtype === "started" && obj.tool_call) {
      const tc = obj.tool_call;
      const path = (tc.readToolCall ?? tc.writeToolCall ?? tc.searchReplaceToolCall)?.args?.path;
      const label = tc.readToolCall ? "Reading" : tc.writeToolCall ? "Writing" : "Editing";
      const file = path ? path.split("/").slice(-2).join("/") : "";
      return pc.dim(`  ${label} ${file}\n`);
    }

    if (type === "result" && subtype === "success") {
      return pc.green("  ✓ Done.\n");
    }

    return null;
  } catch {
    return null;
  }
};

export { formatCursorLine };
