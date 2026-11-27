import { z } from "zod";

const localDateTime = z.iso.datetime({ local: true }).regex(/\d$/);

function dateTimeWithSuffix(suffix: RegExp) {
  return z.string().refine((value) => {
    const ending = suffix.exec(value);
    return (
      ending !== null &&
      localDateTime.safeParse(value.slice(0, ending.index)).success
    );
  }, "Invalid datetime");
}

export const UtcDateTimeSchema = dateTimeWithSuffix(/Z$/);
export const OffsetDateTimeSchema = dateTimeWithSuffix(
  /(?:Z|[+-]\d{2}:?\d{2})$/,
);
