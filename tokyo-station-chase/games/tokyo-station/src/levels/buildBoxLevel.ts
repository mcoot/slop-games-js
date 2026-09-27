import * as THREE from "three";
import type { BoxDef, SandboxLevel, Surface } from "./movementSandbox";

/** Turn box definitions into meshes. Physics colliders come from these meshes via @slop/physics. */
export function buildBoxLevel(
  level: SandboxLevel,
  materialFor: (surface: Surface) => THREE.Material,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "level";
  for (const def of level.boxes) group.add(boxMesh(def, materialFor(def.surface)));
  return group;
}

function boxMesh(def: BoxDef, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...def.size), material);
  mesh.name = def.name;
  mesh.position.set(...def.center);
  if (def.pitchDeg) mesh.rotation.x = THREE.MathUtils.degToRad(def.pitchDeg);
  mesh.castShadow = def.surface !== "floor";
  mesh.receiveShadow = true;
  return mesh;
}
