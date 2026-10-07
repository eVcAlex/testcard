import { deriveLinkLookup, isValidLinkCode, normaliseLinkCode, sealLinkSecrets } from "@testcard/core/src/sync/linkCrypto.ts";
import { errorMessage, errorStatus, linkApprove, linkSession, signIn, signUp } from "../api.ts";

export type Mode = "signin" | "signup";
export type Field = "code" | "email" | "password" | "confirm";

export class LinkError extends Error {
  constructor(message: string, readonly field?: Field, readonly accountCreated = false, readonly switchToSignin = false) {
    super(message);
  }
}

const CODE_GONE = "That code was not found, or it has expired. Ask your TV for a new one.";
const OFFLINE = "Could not reach Testcard. Check your connection and try again.";

/** Signs the person in (or up) and hands the TV a sealed copy of the credentials. Throws LinkError for anything to show. */
export async function linkTv(input: { code: string; email: string; password: string; confirm: string; mode: Mode }): Promise<void> {
  const code = normaliseLinkCode(input.code);
  const email = input.email.trim();
  const { password } = input;
  const signup = input.mode === "signup";

  if (!isValidLinkCode(code)) throw new LinkError("That code is not 8 letters and numbers. Check your TV and try again.", "code");
  if (!email) throw new LinkError("Enter the email you use for Testcard.", "email");
  if (!password) throw new LinkError("Enter your password.", "password");
  if (signup && password.length < 8) throw new LinkError("Use at least 8 characters for your password.", "password");
  if (signup && password !== input.confirm) throw new LinkError("The two passwords do not match.", "confirm");

  let created = false;
  try {
    const lookup = await deriveLinkLookup(code);

    // The code is known good before an account is made, so an expired code never leaves an account behind.
    let session: { salt: string };
    try {
      session = await linkSession(lookup);
    } catch (e) {
      throw errorStatus(e) !== undefined ? new LinkError(CODE_GONE, "code") : e;
    }

    try {
      await (signup ? signUp(email, password) : signIn(email, password));
      created = signup;
    } catch (e) {
      const status = errorStatus(e);
      if (status === undefined) throw e;
      if (!signup) throw new LinkError("That email and password do not match a Testcard account.", "password");
      if (status === 422 || status === 409) {
        throw new LinkError("There is already an account with that email. Enter its password to sign in instead.", "password", false, true);
      }
      throw new LinkError(errorMessage(e) ?? "Could not create the account. Check your details and try again.", "password");
    }

    const sealed = await sealLinkSecrets({ email, password }, code, session.salt);
    try {
      await linkApprove({ lookup, ...sealed });
    } catch (e) {
      if (errorStatus(e) === undefined) throw e;
      // The account exists now, so the next try is a sign-in, not another sign-up.
      throw new LinkError(
        created ? "Your account was created, but the code ran out. Ask your TV for a new code, then sign in." : CODE_GONE,
        "code",
        created,
        created,
      );
    }
  } catch (e) {
    if (e instanceof LinkError) throw e;
    throw new LinkError(OFFLINE);
  }
}
