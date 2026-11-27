import { PhotoUploadResultSchema } from "@planner/shared/src/protocol/photo-upload-result-schema.ts";
import { getDaemonUrl } from "../daemon-http/get-daemon-url.ts";
import { readErrorText } from "../daemon-http/read-error-text.ts";

export async function uploadChatPhotos(options: {
  projectId: string;
  files: File[];
}) {
  const ids: string[] = [];
  for (const file of options.files) {
    const query = new URLSearchParams({ fileName: file.name, origin: "chat" });
    const response = await fetch(
      getDaemonUrl({ path: `/projects/${options.projectId}/photos?${query}` }),
      { method: "POST", body: file },
    );
    if (!response.ok) throw new Error(await readErrorText(response));
    ids.push(PhotoUploadResultSchema.parse(await response.json()).photoId);
  }
  return ids;
}
