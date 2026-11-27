import { z } from "zod";

const coordinate = z.number().finite().min(0).max(1);

export const PhotoBoxSchema = z
  .tuple([coordinate, coordinate, coordinate, coordinate])
  .refine(
    ([left, top, right, bottom]) => left < right && top < bottom,
    "The photo box must have positive width and height",
  );
