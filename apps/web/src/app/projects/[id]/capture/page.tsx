import { CapturePage } from "../../../../capture/capture-page.tsx";

type CaptureRouteProps = { params: Promise<{ id: string }> };

export default async function CaptureRoute(props: CaptureRouteProps) {
  const params = await props.params;
  return <CapturePage key={params.id} projectId={params.id} />;
}
