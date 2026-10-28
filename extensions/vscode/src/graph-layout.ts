export interface Camera { x: number; y: number; scale: number }

export function zoomCamera(view: Camera, factor: number, x: number, y: number): Camera {
  const scale = Math.max(.05, Math.min(2.5, view.scale * factor)), ratio = scale / view.scale;
  return { scale, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio };
}

export function fitCamera(graph: { width: number; height: number }, width: number, height: number): Camera {
  const scale = Math.max(.05, Math.min(1.1, (width - 24) / Math.max(1, graph.width), (height - 56) / Math.max(1, graph.height)));
  return { scale, x: (width - graph.width * scale) / 2, y: 40 };
}
