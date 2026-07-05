export type ResponseStatus = "success" | "partial" | "failed";

export interface EnvelopeOptions {
  status: ResponseStatus;
  credits?: number | null;
  appliedDefaults?: string[];
  nextStep?: string;
  body: string;
}

export function wrapResponse(options: EnvelopeOptions): string {
  const header: string[] = [`Status: ${options.status}`];

  if (options.credits !== undefined && options.credits !== null) {
    header.push(`Credits: ${options.credits}`);
  }

  if (options.appliedDefaults?.length) {
    header.push(`Applied routing: ${options.appliedDefaults.join("; ")}`);
  }

  header.push("---");

  const parts = [...header, options.body];

  if (options.nextStep) {
    parts.push("---", `Next: ${options.nextStep}`);
  }

  return parts.join("\n");
}

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface McpToolTextResult {
  [key: string]: unknown;
  content: McpTextContent[];
  isError?: boolean;
}

export function mcpTextResult(text: string, isError = false): McpToolTextResult {
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  };
}
