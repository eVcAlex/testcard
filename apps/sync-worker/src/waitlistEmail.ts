/** The waitlist confirmation email. Table layout and inline styles so Gmail and Outlook render it; the logo is the hosted PNG. */
const BARS = ["#d0d4d8", "#d9c86a", "#4fb3a6", "#6bbf6b", "#b56bbf", "#e8402a", "#4a6fd0"];

export const WAITLIST_SUBJECT = "You're on the Testcard beta waitlist";

export const WAITLIST_TEXT = `You're on the list.

Thanks for joining the Testcard beta waitlist. We'll email you when the beta opens, with a link to get the app on your device. That's the only email we'll send until then.

See how to add a source: https://evicted.dev/setup

You're getting this because this address was added to the Testcard waitlist at evicted.dev. This address doesn't accept replies. To be removed, or for any question, email hello@evicted.dev.
`;

export const WAITLIST_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${WAITLIST_SUBJECT}</title></head>
<body style="margin:0;padding:0;background:#efe8d6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efe8d6;border-collapse:collapse;font-family:'Plus Jakarta Sans','Segoe UI',Helvetica,Arial,sans-serif;color:#1d1b15;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;border-collapse:collapse;">
<tr><td style="background:#11100d;padding:22px 28px;">
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
<td style="vertical-align:middle;padding-right:12px;"><img src="https://evicted.dev/icon.png" width="40" height="40" alt="" style="display:block;border:0;border-radius:9px;"></td>
<td style="vertical-align:middle;font-size:20px;font-weight:800;color:#e6e0d0;">Testcard</td>
</tr></table>
</td></tr>
<tr><td style="padding:0;line-height:0;font-size:0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${BARS.map((c) => `<td height="6" style="background:${c};font-size:0;line-height:0;">&nbsp;</td>`).join("")}</tr></table>
</td></tr>
<tr><td style="padding:36px 28px 8px 28px;">
<h2 style="margin:0 0 16px 0;font-size:26px;line-height:1.25;font-weight:800;color:#1d1b15;">You're on the list.</h2>
<p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#1d1b15;">Thanks for joining the Testcard beta waitlist. We'll email you when the beta opens, with a link to get the app on your device.</p>
<p style="margin:0 0 24px 0;font-size:16px;line-height:1.6;color:#1d1b15;">That's the only email we'll send until then.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
<td style="background:#1d1b15;border-radius:8px;"><a href="https://evicted.dev/setup" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:600;color:#efe8d6;text-decoration:none;">See how to add a source</a></td>
</tr></table>
</td></tr>
<tr><td style="padding:32px 28px 28px 28px;">
<div style="border-top:1px solid #cfc5ab;padding-top:16px;font-size:12.5px;line-height:1.6;color:#5c5646;">You're getting this because this address was added to the Testcard waitlist at evicted.dev. This address doesn't accept replies. To be removed, or for any question, email <a href="mailto:hello@evicted.dev" style="color:#5c5646;">hello@evicted.dev</a>.</div>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
