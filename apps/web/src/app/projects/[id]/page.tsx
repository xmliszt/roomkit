import { EditorShell } from "../../../editor/editor-shell.tsx";

type EditorPageProps = { params: Promise<{ id: string }> };

export default async function EditorPage(props: EditorPageProps) {
  const params = await props.params;
  return <EditorShell projectId={params.id} />;
}
