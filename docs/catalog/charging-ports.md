# Charging port types

The catalog family `charging-port` has one asset per socket type. The list is `CHARGING_PORT_TYPES` in `packages/shared/src/catalog/charging-port-types.ts`; `CHARGING_PORT` (Type G, asset id `charging-port`) is the default and keeps the id that projects made before B4 use. Every type is a wall item with a default `heightM` of 0.3.

| `typeId` | Asset id | Size W × H × D (mm) | Triangles | Modelled on |
|---|---|---|---|---|
| `type-g` | `charging-port` | 86 × 86 × 10 | 1,636 | BG 800 series single switched socket |
| `type-g-usb` | `charging-port-type-g-usb` | 86 × 86 × 10 | 1,882 | BG 800 series single switched socket with USB-A and USB-C |
| `type-g-double` | `charging-port-type-g-double` | 146 × 86 × 10 | 2,188 | BG 822 double switched socket |
| `type-a-b` | `charging-port-type-a-b` | 69.85 × 114.3 × 7.5 | 2,188 | NEMA 5-15 duplex in a Leviton 88003 plate |
| `type-c-f` | `charging-port-type-c-f` | 80.7 × 80.7 × 11 | 2,198 | Gira Standard 55 frame with a Schuko insert |
| `type-i` | `charging-port-type-i` | 115 × 73 × 9 | 1,554 | Clipsal 2000 series horizontal single switched socket |
| `usb` | `charging-port-usb` | 86 × 86 × 8.8 | 1,316 | UK single plate with USB-C above USB-A |

Depth is the full bounding box: plate, rocker and screw covers. The anchor is the centre of the back face, on z = 0.

## Rebuild

```
scripts/machine-lock.sh catalog node blender/catalog/build-charging-ports.ts [typeId...]
```

`build_charging_port.py --type <typeId>` builds the parts in meters, `normalize.py` checks the size and anchor, `thumbnail.py` renders `thumb.png` at 256 px, and the Node script writes `meta.json`. It stops when the normalized size differs from the shared entry by 0.01 mm or more. The GLBs come out byte-identical on a rebuild; thumbnails differ by render noise.

`node scripts/b4-compare.ts <photo folder> <out.png>` renders each type in three.js beside `<photo folder>/<typeId>.jpg|png|webp`. Photos stay outside the repo.

## Sources

| Figure | Value used | Source |
|---|---|---|
| BS 1363 apertures | line and neutral 7.0 × 4.6 mm, earth 4.6 × 8.4 mm (limits 7.2 × 4.8 and 8.8 × 4.8) | [BS 1363](https://en.wikipedia.org/wiki/BS_1363) |
| BS 1363 spacing | line to neutral 22.2 mm; earth centre 22.2 mm above their line | same |
| UK single plate | 86 × 86 mm, screws 60.3 mm apart (BS 4662 box) | [Electrical wiring in the United Kingdom](https://en.wikipedia.org/wiki/Electrical_wiring_in_the_United_Kingdom) |
| UK double plate | 146 × 86 mm, screws 120.6 mm apart | [BG 822 product page](https://bgelectrical.uk/uk/wiring-devices/800-series/13a-sockets/822CON-01), BG datasheet "146.5 × 86 × 31 mm, 120.6 mm fixing centres" |
| NEMA 5-15 | blades 6.4 (hot) and 7.9 (neutral) mm wide, 12.7 mm apart; ground 4.8 mm, 11.9 mm below the blades | [NEMA connector](https://en.wikipedia.org/wiki/NEMA_connector) |
| US plate | 2-3/4 × 4-1/2 in (69.85 × 114.3 mm) | [Leviton 88003](https://www.leviton.com/en/products/88003), [distributor listing](https://www.mgm-electric.com/products/24-switches-wallplates/08-wall-switch-plates/03-nylonplastic-wall-plates/05-duplex-receptacle-plates/p-TEVWODgwMDNX-leviton-manufacturing-88003-duplex-receptacle-wallplate-1-gangs-white-1143-mm-lx-6985-mm-w) |
| Schuko | pins 4.8 mm, 19 mm apart; recess 17.5 mm deep; earth clips above and below the recess | [Schuko](https://en.wikipedia.org/wiki/Schuko), [CEE 7](https://en.wikipedia.org/wiki/CEE_7) |
| Schuko frame | 80.7 × 80.7 × 11 mm (sheet: 11.4), 55 mm insert | [Gira Standard 55 sheet](https://partner.gira.de/data3/PI_Gira_Standard55.pdf) |
| AS/NZS 3112 | blades 6.35 × 1.6 mm at 30° to vertical, centres 7.92 mm from the midpoint (13.7 mm apart), earth 10.31 mm below | [AS/NZS 3112](https://en.wikipedia.org/wiki/AS/NZS_3112) |
| Australian plate | 115 × 73 mm | [Clipsal single switch socket](https://clipsal.com/products/power-points-switches/standard-series/single-switch-socket-outlet-250v-15a-standard-size-2-pole-15d15) |
| USB-A, USB-C openings | 12.5 × 5.1 mm, 8.9 × 3.2 mm | no cited source; typical receptacle outlines |

## Departures from the real parts

- Nothing is behind z = 0, so recesses are capped by the plate depth. The Schuko recess is 5.5 mm deep instead of 17.5 mm; the apertures end on a dark floor 4–6.5 mm below the face.
- The two US receptacles are 38.9 mm apart, a typical duplex figure with no cited source.
- Type I is labelled "Australia, China" but follows the Australian switched plate; Chinese Type I sockets are usually unswitched on an 86 × 86 mm plate.
- The UK and USB plates have round screw covers. Many plates show chrome screw heads instead.
- No printed markings (ratings, "USB CHARGER").
- The USB-only plate has no single reference product; the comparison uses a Knightsbridge USB module.

## Reference photos used for `compare.png`

Not committed. Commons: `Uk 13a double socket.jpg` (public domain), `NEMA 5-15 Outlet 120V-15A.jpg` (public domain), `Schutzkontakte steckdose.jpg` (public domain), `Mains-AU-10A-household1.JPG` (CC BY-SA 2.5). Screwfix product images: 690HV (BG 800 switched socket), 320CH (BG 800 with USB A+C), 629YA (Knightsbridge USB module).
