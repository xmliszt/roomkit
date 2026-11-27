import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import { setupChoices } from "../../settings/get-setup-plan.ts";
import { SettingsPage } from "../../settings/settings-page.tsx";

type PageProps = {
  searchParams: Promise<{
    from?: string | string[];
    feature?: string | string[];
    returnTo?: string | string[];
  }>;
};

export default async function Page(props: PageProps) {
  const params = await props.searchParams;
  const from = IdSchema.safeParse(params.from);
  return (
    <SettingsPage
      fromProjectId={from.success ? from.data : undefined}
      fromCapture={params.returnTo === "capture"}
      initialChoice={
        setupChoices.find((choice) => choice.id === params.feature)?.id
      }
    />
  );
}
