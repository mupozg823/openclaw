type MatrixTarget =
  | { kind: "room"; id: string }
  | { kind: "user"; id: string };

function stripPrefix(value: string, prefix: string): string {
  return value.toLowerCase().startsWith(prefix) ? value.slice(prefix.length) : value;
}

function parseMatrixTarget(raw: string): MatrixTarget | null {
  let value = raw.trim();
  if (!value) {
    return null;
  }
  value = stripPrefix(value, "matrix:");
  if (!value) {
    return null;
  }
  if (value.toLowerCase().startsWith("room:")) {
    const id = value.slice("room:".length).trim();
    return id ? { kind: "room", id } : null;
  }
  if (value.toLowerCase().startsWith("channel:")) {
    const id = value.slice("channel:".length).trim();
    return id ? { kind: "room", id } : null;
  }
  if (value.toLowerCase().startsWith("user:")) {
    const id = value.slice("user:".length).trim();
    return id ? { kind: "user", id } : null;
  }
  if (value.startsWith("!") || value.startsWith("#")) {
    return { kind: "room", id: value };
  }
  if (value.startsWith("@")) {
    return { kind: "user", id: value };
  }
  return { kind: "room", id: value };
}

export function isMatrixQualifiedUserId(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.startsWith("@") && trimmed.includes(":");
}

export function normalizeMatrixDirectoryUserId(raw: string): string | null {
  const parsed = parseMatrixTarget(raw);
  if (!parsed || parsed.kind !== "user") {
    return null;
  }
  return `user:${parsed.id}`;
}

export function normalizeMatrixDirectoryGroupId(raw: string): string | null {
  const parsed = parseMatrixTarget(raw);
  if (!parsed || parsed.kind !== "room") {
    return null;
  }
  return `room:${parsed.id}`;
}

export function normalizeMatrixMessagingTarget(raw: string): string {
  const parsed = parseMatrixTarget(raw);
  if (!parsed) {
    throw new Error("Matrix target is required");
  }
  return `${parsed.kind}:${parsed.id}`;
}

export function resolveMatrixDirectUserId(params: {
  from?: string;
  to?: string;
  chatType?: string;
}): string | undefined {
  if (params.chatType?.trim().toLowerCase() !== "direct") {
    return undefined;
  }
  const from = typeof params.from === "string" ? parseMatrixTarget(params.from) : null;
  if (from?.kind === "user") {
    return from.id;
  }
  const to = typeof params.to === "string" ? parseMatrixTarget(params.to) : null;
  return to?.kind === "user" ? to.id : undefined;
}

export function resolveMatrixTargetIdentity(raw: string): MatrixTarget | null {
  return parseMatrixTarget(raw);
}
