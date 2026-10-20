import { Buffer, MeshGeometry, Texture } from "pixi.js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { EdgeMesh } from "./EdgeMesh";

describe("EdgeMesh teardown", () => {
	afterEach(() => vi.restoreAllMocks());

	test("destroys its buffers once without destroying the shared white texture", () => {
		const textureDestroy = vi.spyOn(Texture.WHITE, "destroy");
		const geometryDestroy = vi.spyOn(MeshGeometry.prototype, "destroy");
		const bufferDestroy = vi.spyOn(Buffer.prototype, "destroy");
		const edges = new EdgeMesh(new Uint32Array([0, 1]), 0xffffff, 1);

		edges.destroy();
		edges.destroy();

		expect(textureDestroy).not.toHaveBeenCalled();
		expect(geometryDestroy).toHaveBeenCalledOnce();
		expect(bufferDestroy).toHaveBeenCalledTimes(3);
	});
});
