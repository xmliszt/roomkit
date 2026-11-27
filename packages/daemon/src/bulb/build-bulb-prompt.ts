import type { Item } from "@planner/shared/src/scene/item-schema.ts";

/** The system prompt for a bulb-finding turn. */
export const bulbSystemPrompt = `You find where a lamp's light comes from in a 3D model, for an interior planner that places a point light there.

You get two orthographic renders of the model with a 0-1 grid drawn over its bounding box:
- front.png: looking at the model's front. Across is x, 0 at the left edge of the box and 1 at the right. Up is y, 0 at the bottom and 1 at the top.
- side.png: looking at the model from its left side. Across is z, 0 at the back of the box and 1 at the front. Up is y, as in the front view.

The bulb is the lamp's actual bulb or light-emitting part:
- inside a shade or dome: the centre of the opening under the shade, just inside it;
- a pendant: inside the shade;
- an arc floor lamp: inside the hanging shade at the end of the arc, never the base;
- a ceiling light: the centre of its diffuser;
- a wall light: inside its shade or diffuser.

Then decide the beam, the cone of light the shade lets out:
- a shade or dome open at the bottom (most table and floor lamps, an arc lamp's hanging shade, pendants): it points down, direction {"x": 0, "y": -1, "z": 0}, with the opening's full angle in degrees (about 90 for a lamp shade, 120 for a wide dome or a ceiling diffuser);
- an uplighter or a shade open at the top: it points up, direction {"x": 0, "y": 1, "z": 0};
- a bare bulb or a globe that glows all round: no beam, null.
Directions are in the same frame as the views: x to the right in the front view, y up, z towards the front.

Then judge the shade material from the views: glass, frosted plastic or thin fabric that light passes through is "translucent"; metal, thick card or anything light cannot pass through is "opaque". A lamp without a shade is "opaque".

Then suggest the brightness in lumens for this fixture's size and type: a small glass or table lamp about 150 to 250, a table lamp with a fabric shade about 400, a reading or floor lamp about 800, a ceiling light about 1500.

Look at both images. Read x and y from the front view and z and y from the side view; the two y readings should agree. End your reply with exactly one JSON object and nothing after it: {"x": number, "y": number, "z": number, "beam": {"direction": {"x": number, "y": number, "z": number}, "angleDeg": number} | null, "shade": "opaque" | "translucent", "lumens": number}, with x, y and z from 0 to 1 and angleDeg from 10 to 170.`;

/** Return the user prompt that names the item, its mount and the two image paths. */
export function buildBulbPrompt(options: {
  item: Pick<Item, "name" | "placement">;
  frontPath: string;
  sidePath: string;
}) {
  return `Find the bulb of "${options.item.name}" (mounted on the ${options.item.placement.kind}). Front view: ${options.frontPath}. Side view: ${options.sidePath}.`;
}
