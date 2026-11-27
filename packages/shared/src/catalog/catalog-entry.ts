import type { AssetMeta } from "../scene/asset-meta-schema.ts";
import type { Item } from "../scene/item-schema.ts";

/** A catalog asset: its `familyId`, `typeId`, item `name`, picker `label`, `assetId`, `mount`, `sizeM` and `defaultHeightM`. */
export type CatalogEntry = {
  familyId: string;
  typeId: string;
  name: string;
  label: string;
  assetId: string;
  mount: AssetMeta["mount"];
  sizeM: Item["sizeM"];
  defaultHeightM: number;
};
