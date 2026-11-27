export function createLogger(prefix = "plannerd") {
  function write(options: { level: string; message: string }) {
    process.stderr.write(`[${prefix}] ${options.level}: ${options.message}\n`);
  }
  return {
    info: (message: string) => write({ level: "info", message }),
    warn: (message: string) => write({ level: "warn", message }),
    error: (message: string) => write({ level: "error", message }),
  };
}

export type Logger = ReturnType<typeof createLogger>;
