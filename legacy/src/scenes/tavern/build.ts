/**
 * The room shell — Native WebGPU edition.
 */
import { TransformNode } from "../../webgpu/scene/transform-node";
import { MeshNode } from "../../webgpu/scene/mesh-node";
import { LightNode } from "../../webgpu/scene/light-node";
import { createBoxGeometry } from "../../webgpu/geometry/box";
import { ROOM_W, ROOM_D, WALL_HEIGHT } from "./layout";

export interface BuiltRoom {
  group: TransformNode;
  fireLight: LightNode;
  flames: MeshNode[];
  dispose(): void;
}

export function buildRoom(scene?: any): BuiltRoom {
  const group = new TransformNode("Tavern_Room_Root");

  // Floor
  const floorGeom = createBoxGeometry(ROOM_W, 0.1, ROOM_D);
  const floorNode = new MeshNode(floorGeom, "Floor_Mesh");
  floorNode.position.set(0, -0.05, 0);
  group.add(floorNode);

  // Walls
  const backWallGeom = createBoxGeometry(ROOM_W, WALL_HEIGHT, 0.2);
  const backWallNode = new MeshNode(backWallGeom, "BackWall_Mesh");
  backWallNode.position.set(0, WALL_HEIGHT / 2, -ROOM_D / 2);
  group.add(backWallNode);

  // Hearth Fire Light
  const fireLight = new LightNode("point", 0xff6600, 2.5, 10);
  fireLight.position.set(0, 1.2, -ROOM_D / 2 + 0.5);
  group.add(fireLight);

  const flameGeom = createBoxGeometry(0.2, 0.4, 0.2);
  const flameMesh = new MeshNode(flameGeom, "Flame_Mesh");
  flameMesh.position.set(0, 0.2, -ROOM_D / 2 + 0.5);
  group.add(flameMesh);

  group.updateWorldMatrix();

  return {
    group,
    fireLight,
    flames: [flameMesh],
    dispose: () => {},
  };
}
