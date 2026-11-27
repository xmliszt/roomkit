import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { isPrivateAddress } from "./is-private-address.ts";

const MAX_REDIRECTS = 3;

function checkedLookup(): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { all: true }, (error, addresses: LookupAddress[]) => {
      if (error) return callback(error, "", 4);
      if (
        addresses.length === 0 ||
        addresses.some((entry) => isPrivateAddress(entry.address))
      )
        return callback(
          new Error(`${hostname} resolves to a private address`),
          "",
          4,
        );
      if (options.all) return callback(null, addresses);
      const first = addresses[0];
      return first === undefined
        ? callback(new Error(`${hostname} has no address`), "", 4)
        : callback(null, first.address, first.family);
    });
  };
}

function requestOnce(options: {
  url: URL;
  isAllowedHost: boolean;
  signal: AbortSignal;
}) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const hostname = options.url.hostname.replace(/^\[|\]$/g, "");
    if (
      !options.isAllowedHost &&
      isIP(hostname) &&
      isPrivateAddress(hostname)
    ) {
      reject(new Error(`${hostname} is a private address`));
      return;
    }
    const request = (
      options.url.protocol === "https:" ? httpsRequest : httpRequest
    )(
      options.url,
      {
        method: "GET",
        agent: false,
        signal: options.signal,
        headers: {
          "user-agent": "InteriorPlanner/0.1 (link preview)",
          accept: "text/html,image/*;q=0.9,*/*;q=0.1",
        },
        ...(options.isAllowedHost ? {} : { lookup: checkedLookup() }),
      },
      resolve,
    );
    request.on("error", reject);
    request.end();
  });
}

/** Fetch `url` with GET, following up to `MAX_REDIRECTS` redirects and refusing any hop that resolves to a private address unless its `host` is in `allowedHosts`; return the body, cut at `maxBytes` when `isTruncationAllowed` and an error past it otherwise. */
export async function safeGet(options: {
  url: string;
  allowedHosts: string[];
  maxBytes: number;
  timeoutMs: number;
  isTruncationAllowed: boolean;
}) {
  const signal = AbortSignal.timeout(options.timeoutMs);
  let url = new URL(options.url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new Error(`Unsupported link protocol: ${url.protocol}`);
    const response = await requestOnce({
      url,
      isAllowedHost: options.allowedHosts.includes(url.host),
      signal,
    });
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.destroy();
      url = new URL(response.headers.location, url);
      continue;
    }
    if (status !== 200) {
      response.destroy();
      throw new Error(`The link answered HTTP ${status}`);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (size + buffer.byteLength > options.maxBytes) {
        response.destroy();
        if (!options.isTruncationAllowed)
          throw new Error("The linked file is too large");
        chunks.push(buffer.subarray(0, options.maxBytes - size));
        size = options.maxBytes;
        break;
      }
      chunks.push(buffer);
      size += buffer.byteLength;
    }
    return {
      url,
      contentType: String(response.headers["content-type"] ?? "")
        .split(";")
        .at(0)
        ?.trim()
        .toLowerCase(),
      body: Buffer.concat(chunks),
    };
  }
  throw new Error("The link redirects too many times");
}
