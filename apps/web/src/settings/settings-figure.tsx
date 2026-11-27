import { getIsoGeometry } from "./get-iso-geometry.ts";

type SettingsFigureProps =
  | { kind: "claude"; live: boolean; label: string }
  | { kind: "codex"; live: boolean; label: string }
  | { kind: "blender"; live: boolean; label: string }
  | {
      kind: "rack";
      drawers: { id: string; present: boolean }[];
      label: string;
    };

export function SettingsFigure(props: SettingsFigureProps) {
  const iso = getIsoGeometry();
  const parts = (() => {
    switch (props.kind) {
      case "claude":
        return [
          { x: -40, y: -26, z: 0, width: 80, depth: 52, height: 4 },
          { x: -36, y: -26, z: 4, width: 72, depth: 4, height: 46 },
          { x: -30, y: -14, z: 4, width: 60, depth: 18, height: 1 },
          { x: -10, y: 8, z: 4, width: 20, depth: 12, height: 0.5 },
        ];
      case "codex":
        return [
          { x: -14, y: -12, z: 0, width: 28, depth: 16, height: 3 },
          { x: -3, y: -6, z: 3, width: 6, depth: 4, height: 17 },
          { x: -42, y: -2, z: 16, width: 84, depth: 5, height: 46 },
          { x: -30, y: 14, z: 0, width: 56, depth: 14, height: 3 },
        ];
      case "blender":
        return [{ x: -30, y: -30, z: 0, width: 60, depth: 60, height: 5 }];
      case "rack":
        return [{ x: -28, y: -18, z: 0, width: 56, depth: 36, height: 58 }];
      default: {
        const unreachable: never = props;
        return unreachable;
      }
    }
  })();
  return (
    <svg
      viewBox="0 0 180 140"
      role="img"
      aria-label={props.label}
      className="h-[84px] w-[108px] shrink-0 fill-bg stroke-line-strong"
    >
      <title>{props.label}</title>
      {parts.flatMap((part) =>
        iso
          .box(part)
          .map((d) => (
            <path
              key={d}
              d={d}
              className="face"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )),
      )}
      {(() => {
        switch (props.kind) {
          case "claude":
            return (
              <g transform={iso.front({ x: -33, y: -21.5, z: 47 })}>
                <rect
                  width="66"
                  height="40"
                  className="fill-bg stroke-line"
                  vectorEffect="non-scaling-stroke"
                />
                <rect
                  x="4"
                  y="5"
                  width="34"
                  height="9"
                  rx="3"
                  className="fill-bg stroke-line-strong"
                  vectorEffect="non-scaling-stroke"
                />
                <rect
                  x="28"
                  y="17"
                  width="34"
                  height="9"
                  rx="3"
                  className="fill-bg stroke-line-strong"
                  vectorEffect="non-scaling-stroke"
                />
                <rect
                  x="4"
                  y="29"
                  width="24"
                  height="7"
                  rx="3"
                  className={
                    props.live
                      ? "fill-accent-soft stroke-accent"
                      : "fill-bg stroke-line"
                  }
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d="M8 9.5h22M32 21.5h22M9 32.5h3m3 0h3m3 0h3"
                  className={props.live ? "stroke-accent" : "stroke-line"}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          case "codex":
            return (
              <g transform={iso.front({ x: -39, y: 3.5, z: 59 })}>
                <rect
                  width="78"
                  height="40"
                  className="fill-bg stroke-line"
                  vectorEffect="non-scaling-stroke"
                />
                <rect
                  x="10"
                  y="17"
                  width="68"
                  height="6"
                  className={
                    props.live
                      ? "fill-accent-soft stroke-none"
                      : "fill-none stroke-none"
                  }
                />
                <path
                  d="M10 0v40M3 8h3M3 14h3M3 20h3M3 26h3M3 32h3"
                  className="stroke-line"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d="M14 8h22M20 14h34M26 26h24M14 32h12M60 5l-4 4 4 4m6-8 4 4-4 4"
                  className="fill-none stroke-line-strong"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d="M20 20h28m4 0v-3"
                  className={
                    props.live
                      ? "fill-none stroke-accent"
                      : "fill-none stroke-line-strong"
                  }
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          case "blender": {
            const size = 16;
            const bottom = 5;
            const top = bottom + 2 * size;
            const visibleEdges = [
              [
                { x: -size, y: -size, z: top },
                { x: size, y: -size, z: top },
                { x: size, y: size, z: top },
                { x: -size, y: size, z: top },
                { x: -size, y: -size, z: top },
              ],
              [
                { x: size, y: -size, z: top },
                { x: size, y: -size, z: bottom },
                { x: size, y: size, z: bottom },
                { x: -size, y: size, z: bottom },
                { x: -size, y: size, z: top },
              ],
              [
                { x: size, y: size, z: top },
                { x: size, y: size, z: bottom },
              ],
            ];
            const loops = [
              [
                { x: -size, y: size, z: bottom + size },
                { x: size, y: size, z: bottom + size },
                { x: size, y: -size, z: bottom + size },
              ],
              [
                { x: 0, y: -size, z: top },
                { x: 0, y: size, z: top },
                { x: 0, y: size, z: bottom },
              ],
              [
                { x: -size, y: 0, z: top },
                { x: size, y: 0, z: top },
                { x: size, y: 0, z: bottom },
              ],
            ];
            const hiddenEdges = [
              [
                { x: size, y: -size, z: bottom },
                { x: -size, y: -size, z: bottom },
                { x: -size, y: size, z: bottom },
              ],
              [
                { x: -size, y: -size, z: bottom },
                { x: -size, y: -size, z: top },
              ],
            ];
            const vertices = [-size, size].flatMap((x) =>
              [-size, size].flatMap((y) =>
                [bottom, top]
                  .filter((z) => x > 0 || y > 0 || z === top)
                  .map((z) => ({ x, y, z })),
              ),
            );
            const gizmoOrigin = { x: 34, y: -34, z: 40 };
            const axes = [
              { name: "X", end: { x: 48, y: -34, z: 40 } },
              { name: "Y", end: { x: 34, y: -20, z: 40 } },
              { name: "Z", end: { x: 34, y: -34, z: 54 } },
            ];
            return (
              <g className="fill-none">
                <path
                  d={iso.line([
                    { x: -size, y: -size, z: top },
                    { x: size, y: -size, z: top },
                    { x: size, y: size, z: top },
                    { x: -size, y: size, z: top },
                  ])}
                  className={
                    props.live
                      ? "fill-accent-soft stroke-none"
                      : "fill-none stroke-none"
                  }
                />
                {hiddenEdges.map((points) => (
                  <path
                    key={iso.line(points)}
                    d={iso.line(points)}
                    className="stroke-line"
                    strokeDasharray="2 2"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {loops.map((points) => (
                  <path
                    key={iso.line(points)}
                    d={iso.line(points)}
                    className="stroke-line"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {visibleEdges.map((points) => (
                  <path
                    key={iso.line(points)}
                    d={iso.line(points)}
                    className="stroke-line-strong"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {vertices.map((vertex) => {
                  const center = iso.project(vertex);
                  const isActive =
                    vertex.x > 0 && vertex.y > 0 && vertex.z === top;
                  return (
                    <rect
                      key={`${vertex.x} ${vertex.y} ${vertex.z}`}
                      x={center.x - 1.6}
                      y={center.y - 1.6}
                      width="3.2"
                      height="3.2"
                      className={
                        isActive && props.live
                          ? "led hot fill-accent stroke-accent"
                          : "fill-bg stroke-line-strong"
                      }
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
                {axes.map((axis) => {
                  const end = iso.project(axis.end);
                  return (
                    <g key={axis.name}>
                      <path
                        d={iso.line([gizmoOrigin, axis.end])}
                        className="stroke-line-strong"
                        vectorEffect="non-scaling-stroke"
                      />
                      <circle
                        cx={end.x}
                        cy={end.y}
                        r="1.8"
                        className="fill-line-strong stroke-none"
                      />
                      <text
                        x={end.x + 3}
                        y={end.y + 2}
                        fontSize="7"
                        className="fill-ink-dim stroke-none"
                      >
                        {axis.name}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          }
          case "rack":
            return (
              <g transform={iso.front({ x: -23, y: 18.5, z: 54 })}>
                {(props.drawers.length
                  ? props.drawers
                  : [{ id: "empty", present: false }]
                ).map((drawer, index, drawers) => (
                  <g
                    key={drawer.id}
                    transform={`translate(0 ${(index * 48) / drawers.length})`}
                  >
                    <rect
                      width="46"
                      height={Math.max(2, 48 / drawers.length - 2)}
                      className="fill-bg stroke-line"
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      d={`M6 ${20 / drawers.length}h18`}
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      cx="37"
                      cy={20 / drawers.length}
                      r="1.8"
                      className={
                        drawer.present
                          ? "led hot fill-accent stroke-accent"
                          : "led fill-bg stroke-line"
                      }
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                ))}
              </g>
            );
          default: {
            const unreachable: never = props;
            return unreachable;
          }
        }
      })()}
    </svg>
  );
}
