import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

type TailnetAccess = { host: string; logins: string[] };

export class AuthService {
  readonly internalToken = randomBytes(32).toString("hex");
  private readonly allowedHosts: string[];
  private readonly tailnetLogins: string[];
  private readonly desktopTailnet:
    | (() => TailnetAccess | undefined)
    | undefined;

  constructor(
    options: {
      allowedHosts?: string[];
      tailnetLogins?: string[];
      desktopTailnet?: () => TailnetAccess | undefined;
    } = {},
  ) {
    this.allowedHosts = options.allowedHosts ?? [];
    this.tailnetLogins = options.tailnetLogins ?? [];
    this.desktopTailnet = options.desktopTailnet;
  }

  allowsTailnet(options: {
    headers: IncomingHttpHeaders;
    webOrigins: string[];
  }) {
    const { host, origin } = options.headers;
    const login = options.headers["tailscale-user-login"];
    const desktop = this.desktopTailnet?.();
    if (desktop && desktop.host === host)
      return (
        typeof login === "string" &&
        desktop.logins.includes(login) &&
        (origin === undefined
          ? options.headers["sec-fetch-site"] === "same-origin"
          : origin === `https://${host}`)
      );
    return (
      host !== undefined &&
      this.allowedHosts.includes(host) &&
      typeof login === "string" &&
      this.tailnetLogins.includes(login) &&
      ((origin === `https://${host}` && options.webOrigins.includes(origin)) ||
        options.headers["sec-fetch-site"] === "same-origin")
    );
  }

  allowsOrigin(options: {
    headers: IncomingHttpHeaders;
    webOrigins: string[];
  }) {
    if (this.isTailnetHost(options.headers.host))
      return this.allowsTailnet(options);
    const origin = options.headers.origin;
    return origin === undefined || options.webOrigins.includes(origin);
  }

  allowsHost(options: { headers: IncomingHttpHeaders; port: number }) {
    const { host } = options.headers;
    if (this.isTailnetHost(host)) return true;
    if (options.headers["x-forwarded-host"] !== undefined) return false;
    return [
      `127.0.0.1:${options.port}`,
      `localhost:${options.port}`,
      `[::1]:${options.port}`,
    ].includes(host ?? "");
  }

  private isTailnetHost(host: string | undefined) {
    return (
      host !== undefined &&
      (this.allowedHosts.includes(host) ||
        this.desktopTailnet?.()?.host === host)
    );
  }

  allowsBearer(authorization: string | undefined) {
    const match = /^Bearer (\S+)$/.exec(authorization ?? "");
    return match?.[1] !== undefined && this.validateInternal(match[1]);
  }

  validateInternal(token: string) {
    const actual = Buffer.from(token, "utf8");
    const expected = Buffer.from(this.internalToken, "utf8");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
}
