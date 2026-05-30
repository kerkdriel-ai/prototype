import Dexie, { type EntityTable } from "dexie";
import type { Drawing, StreetViewScene } from "@/types/drawing";

export interface StoredDrawing extends Drawing {
  streetViewScene?: StreetViewScene;
}

class DrawingDatabase extends Dexie {
  drawings!: EntityTable<StoredDrawing, "id">;

  constructor() {
    super("DrawingAnimatorDB");
    this.version(1).stores({
      drawings: "id, createdAt, updatedAt, name",
    });
  }
}

export const db = new DrawingDatabase();

export async function getAllDrawings(): Promise<StoredDrawing[]> {
  return db.drawings.orderBy("updatedAt").reverse().toArray();
}

export async function getDrawing(id: string): Promise<StoredDrawing | undefined> {
  return db.drawings.get(id);
}

export async function saveDrawing(drawing: StoredDrawing): Promise<void> {
  await db.drawings.put({ ...drawing, updatedAt: Date.now() });
}

export async function deleteDrawing(id: string): Promise<void> {
  await db.drawings.delete(id);
}

export async function updateDrawingParts(
  id: string,
  parts: StoredDrawing["parts"]
): Promise<void> {
  await db.drawings.update(id, { parts, updatedAt: Date.now() });
}

export async function updateStreetViewScene(
  id: string,
  scene: StreetViewScene
): Promise<void> {
  await db.drawings.update(id, { streetViewScene: scene, updatedAt: Date.now() });
}
