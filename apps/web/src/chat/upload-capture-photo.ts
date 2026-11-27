import { PhotoUploadResultSchema } from "@planner/shared/src/protocol/photo-upload-result-schema.ts";
import { getDaemonUrl } from "../daemon-http/get-daemon-url.ts";
import { readErrorText } from "../daemon-http/read-error-text.ts";

export async function uploadCapturePhoto(options: {
  projectId: string;
  file: File;
}) {
  const query = new URLSearchParams({
    fileName: options.file.name,
    origin: "capture",
  });
  const response = await fetch(
    getDaemonUrl({
      path: `/projects/${encodeURIComponent(options.projectId)}/photos?${query}`,
    }),
    { method: "POST", body: options.file },
  );
  if (!response.ok) throw new Error(await readErrorText(response));
  return PhotoUploadResultSchema.parse(await response.json());
}
