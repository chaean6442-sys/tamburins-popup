import * as THREE from "three";

// Coordinates follow the background image, whose CSS size is 100% by 100%.
// X and Y span -0.5 to 0.5 with the image center at the origin.
export function createTableHitGeometry() {
  const outline = new THREE.Shape();
  outline.moveTo(0, 0.071);
  outline.bezierCurveTo(0.15, 0.071, 0.229, 0.027, 0.233, -0.043);
  outline.bezierCurveTo(0.238, -0.112, 0.233, -0.247, 0.148, -0.310);
  outline.bezierCurveTo(0.075, -0.363, -0.075, -0.363, -0.148, -0.310);
  outline.bezierCurveTo(-0.233, -0.247, -0.238, -0.112, -0.233, -0.043);
  outline.bezierCurveTo(-0.229, 0.027, -0.15, 0.071, 0, 0.071);
  const opening = new THREE.Path();
  opening.absellipse(0, -0.027, 0.160, 0.061, 0, Math.PI * 2, false);
  outline.holes.push(opening);
  return new THREE.ShapeGeometry(outline, 48);
}
