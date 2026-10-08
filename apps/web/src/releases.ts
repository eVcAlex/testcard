const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/; // the same rule the Worker applies to /app/:file
const SHA256 = /^[0-9a-fA-F]{64}$/;

const sha = (value: unknown): { sha256: string } | Record<string, never> =>
  typeof value === "string" && SHA256.test(value.trim()) ? { sha256: value.trim().toLowerCase() } : {};

/** `sha256` is optional: a `sha256: <64 hex>` line in latest.yml. electron-builder's own `sha512` is not shown. */
export function parseDesktop(yml: string): { version: string; file: string; sha256?: string } | undefined {
  const version = /^version: (.+)$/m.exec(yml)?.[1]?.trim();
  const file = /^path: (.+)$/m.exec(yml)?.[1]?.trim();
  return version !== undefined && file !== undefined && SAFE_FILE.test(file) ? { version, file, ...sha(/^sha256: (.+)$/m.exec(yml)?.[1]) } : undefined;
}

/** `sha256` is optional: `sha256: { firetv: "<64 hex>" }` beside `apks`. */
export function parseAndroid(json: unknown): { file: string; sha256?: string } | undefined {
  const root = json as { apks?: { firetv?: unknown }; sha256?: { firetv?: unknown } } | null;
  const file = root?.apks?.firetv;
  return typeof file === "string" && SAFE_FILE.test(file) ? { file, ...sha(root?.sha256?.firetv) } : undefined;
}
