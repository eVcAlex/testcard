const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/; // the same rule the Worker applies to /app/:file

export function parseDesktop(yml: string): { version: string; file: string } | undefined {
  const version = /^version: (.+)$/m.exec(yml)?.[1]?.trim();
  const file = /^path: (.+)$/m.exec(yml)?.[1]?.trim();
  return version !== undefined && file !== undefined && SAFE_FILE.test(file) ? { version, file } : undefined;
}

export function parseAndroid(json: unknown): { file: string } | undefined {
  const file = (json as { apks?: { firetv?: unknown } } | null)?.apks?.firetv;
  return typeof file === "string" && SAFE_FILE.test(file) ? { file } : undefined;
}
