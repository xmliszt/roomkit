export function isOpeningName(name: string) {
  const nounPhrase =
    name
      .split(
        /[([]|[,;:]|\s+[—–-]\s+|\s+(?:with|without|near|beside|by|behind|above|below|to|into)\b/i,
      )
      .at(0)
      ?.trim() ?? "";
  return (
    /\b(?:door|window|doorway)s?$/i.test(nounPhrase) &&
    !/\b(?:frames?|handles?|blinds?|curtains?|shutters?|panels?|mirrors?|cabinets?|wardrobes?|prints?)\b/i.test(
      nounPhrase,
    )
  );
}
