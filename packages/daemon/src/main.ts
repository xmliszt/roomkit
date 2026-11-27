import { createDaemon } from "./create-daemon.ts";
import { createLogger } from "./util/logger.ts";

const logger = createLogger();
try {
  const daemon = createDaemon({ env: process.env });
  try {
    await daemon.listen();
  } catch (error) {
    await daemon.close();
    throw error;
  }
  function shutdown() {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    process.off("SIGHUP", shutdown);
    daemon.close().catch((error: unknown) => {
      logger.error(String(error));
      process.exitCode = 1;
    });
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);
} catch (error) {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
