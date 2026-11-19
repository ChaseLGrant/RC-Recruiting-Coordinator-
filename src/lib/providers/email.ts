// Email delivery abstraction. RC never sends automatically; this is only
// called by an explicit coach "Send" after approval + compliance checks.

export interface EmailProvider {
  name: string;
  send(m: { to: string; subject: string; text: string }): Promise<{ id: string }>;
}

class ResendProvider implements EmailProvider {
  name = "Resend";
  constructor(private key: string, private from: string) {}
  async send(m: { to: string; subject: string; text: string }) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text }),
    });
    if (!res.ok) throw new Error(`Email provider error ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { id: string };
    return { id: j.id };
  }
}

export function getEmailProvider(env = process.env): EmailProvider | null {
  if (env.RESEND_API_KEY && env.RC_EMAIL_FROM) return new ResendProvider(env.RESEND_API_KEY, env.RC_EMAIL_FROM);
  return null;
}
