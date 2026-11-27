import { createWriteStream, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HttpError } from "./http-error.ts";

/** Write the request body to a new file at `path`, and remove the file when the body is over `maxBytes` or the transfer fails. */
export async function receiveBody(options: {
  request: IncomingMessage;
  path: string;
  maxBytes: number;
}) {
  const tooLarge = new HttpError({
    status: 413,
    message: `The body is larger than ${options.maxBytes} bytes`,
  });
  const declared = Number(options.request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > options.maxBytes) throw tooLarge;
  let received = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      callback(received > options.maxBytes ? tooLarge : undefined, chunk);
    },
  });
  try {
    await pipeline(
      options.request,
      limit,
      createWriteStream(options.path, { flags: "wx", mode: 0o600 }),
    );
  } catch (error) {
    rmSync(options.path, { force: true });
    throw error;
  }
  if (received === 0) {
    rmSync(options.path, { force: true });
    throw new HttpError({ status: 400, message: "The body is empty" });
  }
  return received;
}
