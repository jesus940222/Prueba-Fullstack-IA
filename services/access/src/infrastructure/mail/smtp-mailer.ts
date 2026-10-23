import nodemailer from "nodemailer";
import type { Mailer } from "../../application/ports";
import { AccessError } from "../../domain/access-error";

export function createSmtpMailer(url: string): Mailer {
  const transport = url === "" ? null : nodemailer.createTransport(url);
  return {
    async send(message) {
      if (!transport) {
        throw new AccessError("DEPENDENCY_UNAVAILABLE", "El correo local no está disponible");
      }
      try {
      await transport.sendMail({
        from: "Portal local <no-reply@portal.local>",
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      } catch {
        throw new AccessError("DEPENDENCY_UNAVAILABLE", "El correo local no está disponible");
      }
    },
  };
}
