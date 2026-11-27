export class PythonWorkerError extends Error {
  readonly kind: "timeout" | "stalled" | "output" | "exit";
  readonly isUserFacing: boolean;

  constructor(options: {
    kind: "timeout" | "stalled" | "output" | "exit";
    message: string;
    isUserFacing?: boolean | undefined;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "PythonWorkerError";
    this.kind = options.kind;
    this.isUserFacing = options.isUserFacing === true;
  }
}
