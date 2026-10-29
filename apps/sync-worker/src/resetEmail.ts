/** The password reset email. Plain table layout and inline styles, like the waitlist mail. The link carries the reset token: never log it. */
export const RESET_SUBJECT = "Reset your Testcard password";

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function resetText(url: string): string {
  return `Someone asked to reset the password for this Testcard account. If that was you, open this link within an hour to choose a new one:

${url}

Before you do: your sources and profiles are kept scrambled with your password, so after a reset they are cleared from our servers. Testcard puts them back from any device you were signed in on. Your favourites and watch history are kept.

If you didn't ask for this, ignore this email; your password has not changed.

This address doesn't accept replies. For any question, email hello@evicted.dev.
`;
}

export function resetHtml(url: string): string {
  const link = escapeHtml(url);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${RESET_SUBJECT}</title></head>
<body style="margin:0;padding:0;background:#efe8d6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efe8d6;border-collapse:collapse;font-family:'Plus Jakarta Sans','Segoe UI',Helvetica,Arial,sans-serif;color:#1d1b15;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;border-collapse:collapse;">
<tr><td style="background:#11100d;padding:22px 28px;font-size:20px;font-weight:800;color:#e6e0d0;">Testcard</td></tr>
<tr><td style="padding:36px 28px 8px 28px;">
<h2 style="margin:0 0 16px 0;font-size:24px;line-height:1.25;font-weight:800;">Reset your password</h2>
<p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;">Someone asked to reset the password for this Testcard account. If that was you, choose a new one within an hour.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 20px 0;"><tr>
<td style="background:#1d1b15;border-radius:8px;"><a href="${link}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:600;color:#efe8d6;text-decoration:none;">Choose a new password</a></td>
</tr></table>
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">Your sources and profiles are kept scrambled with your password, so after a reset they are cleared from our servers. Testcard puts them back from any device you were signed in on. Your favourites and watch history are kept.</p>
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">If you didn't ask for this, ignore this email; your password has not changed.</p>
</td></tr>
<tr><td style="padding:16px 28px 28px 28px;">
<div style="border-top:1px solid #cfc5ab;padding-top:16px;font-size:12.5px;line-height:1.6;color:#5c5646;">This address doesn't accept replies. For any question, email <a href="mailto:hello@evicted.dev" style="color:#5c5646;">hello@evicted.dev</a>.</div>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
