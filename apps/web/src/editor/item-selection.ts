export type ItemSelection =
  | { kind: "replace"; itemId: string }
  | { kind: "toggle"; itemId: string }
  | { kind: "keep-set"; itemId: string };
