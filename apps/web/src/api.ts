import wretch, { type WretchError } from "wretch";

const http = wretch().headers({ accept: "application/json" });

export const linkSession = (lookup: string) => http.url(`/link/session?lookup=${encodeURIComponent(lookup)}`).get().json<{ salt: string }>();
export const linkApprove = (body: { lookup: string; blob: string; iv: string }) => http.url("/link/approve").post(body).json();
export const signIn = (email: string, password: string) => http.url("/auth/sign-in/email").post({ email, password }).res();
export const signUp = (email: string, password: string) => http.url("/auth/sign-up/email").post({ email, password, name: email }).res();

/** HTTP status when the server answered with an error; undefined for network failures. */
export const errorStatus = (e: unknown): number | undefined => (e as Partial<WretchError>)?.status;
/** better-auth puts a human message in the JSON body of its errors. */
export const errorMessage = (e: unknown): string | undefined => {
  const message = (e as { json?: { message?: unknown } })?.json?.message;
  return typeof message === "string" && message !== "" ? message : undefined;
};
