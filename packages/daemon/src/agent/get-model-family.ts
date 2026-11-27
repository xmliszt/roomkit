const families = [
  "opus",
  "sonnet",
  "haiku",
  "fable",
  "sol",
  "terra",
  "astra",
  "luna",
];

export function getModelFamily(options: { model: string }) {
  const words = options.model.toLowerCase().split(/[^a-z0-9]+/);
  return families.find((family) => words.includes(family));
}
