export function renderSecurityEmail(input: {
  to: string;
  title: string;
  code: string;
  expiresMinutes: number;
  portalUrl: string;
  purpose: string;
}): { to: string; subject: string; text: string; html: string } {
  const text = [
    "Portal local",
    input.title,
    "",
    `Código: ${input.code}`,
    `Caduca en ${input.expiresMinutes} minutos.`,
    input.purpose,
    "Si no solicitaste este mensaje, ignóralo.",
    input.portalUrl,
  ].join("\n");
  const html = `<!DOCTYPE html><html lang="es-MX"><body style="margin:0;background:#f4f4f5;font-family:Arial,sans-serif;color:#18181b">
<table role="presentation" width="100%"><tr><td align="center" style="padding:24px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;padding:24px">
<tr><td><p style="margin:0 0 8px;font-size:14px">Portal local</p>
<h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(input.title)}</h1>
<p style="margin:0 0 12px;font-size:28px;letter-spacing:2px;font-weight:700">${escapeHtml(input.code)}</p>
<p style="margin:0 0 8px">Caduca en ${input.expiresMinutes} minutos.</p>
<p style="margin:0 0 8px">${escapeHtml(input.purpose)}</p>
<p style="margin:0;color:#52525b">Si no solicitaste este mensaje, ignóralo.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { to: input.to, subject: input.title, text, html };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
    return entities[character] ?? character;
  });
}
