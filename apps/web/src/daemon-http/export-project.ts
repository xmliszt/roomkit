import { getDaemonUrl } from "./get-daemon-url.ts";
import { readErrorText } from "./read-error-text.ts";

function decodeName(encoded: string) {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

function readFileName(disposition: string | null) {
  if (disposition === null) return undefined;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.at(1);
  const decoded = encoded === undefined ? undefined : decodeName(encoded);
  return decoded ?? /filename="([^"]+)"/i.exec(disposition)?.at(1);
}

/** Fetch the project's `.iplan` archive from the daemon and return it with the file name the daemon gave it. */
export async function exportProject(options: { projectId: string }) {
  const response = await fetch(
    getDaemonUrl({ path: `/projects/${options.projectId}/export` }),
  );
  if (!response.ok) throw new Error(await readErrorText(response));
  return {
    archive: await response.blob(),
    fileName:
      readFileName(response.headers.get("content-disposition")) ??
      "project.iplan",
  };
}
