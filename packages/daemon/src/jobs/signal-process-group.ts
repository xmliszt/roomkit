export function signalProcessGroup(options: {
  pid: number;
  signal: NodeJS.Signals | 0;
}) {
  try {
    process.kill(-options.pid, options.signal);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ESRCH" || error.code === "EPERM")
    )
      return false;
    throw error;
  }
}
