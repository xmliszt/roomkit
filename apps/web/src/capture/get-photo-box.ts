type Point = { x: number; y: number };

export function getPhotoBox(options: {
  start: Point;
  end: Point;
  widthPx: number;
  heightPx: number;
}): [number, number, number, number] {
  function x(value: number) {
    return Math.max(0, Math.min(options.widthPx, value));
  }
  function y(value: number) {
    return Math.max(0, Math.min(options.heightPx, value));
  }
  return [
    Math.floor(x(Math.min(options.start.x, options.end.x))),
    Math.floor(y(Math.min(options.start.y, options.end.y))),
    Math.ceil(x(Math.max(options.start.x, options.end.x))),
    Math.ceil(y(Math.max(options.start.y, options.end.y))),
  ];
}
