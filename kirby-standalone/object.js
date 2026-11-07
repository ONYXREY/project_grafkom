import {
  Vector3,
  Quaternion,
  LocalPose,
  identityMatrix,
  multiplyMatrices,
  normalMatrix,
  evaluateCubicBezierComponent,
} from "./libs.js";

// ---------------------------------------------------------------------------
// Shared-context-friendly Mesh / SceneNode, adapted to the reference approach.
// Geometry is CPU-only; each character owns its unique GPU buffer registry.
// No DOM, context creation, camera, framebuffer clearing, or RAF lives here.
// ---------------------------------------------------------------------------

/** Indexed positions/normals plus construction UVs; no renderer or engine dependency. */
export class GeometryData {
  constructor() {
    this.attributes = {};
    this.indices = null;
    this.userData = {};
    this.version = 0;
    this.dynamicRanges = null;
  }
  /** Install a typed attribute; @returns {GeometryData} this. */
  setAttribute(name, data, itemSize) {
    this.attributes[name] = { data, itemSize };
    return this;
  }
  /** @returns {object} Attribute record. */
  getAttribute(name) {
    return this.attributes[name];
  }
  /** Install checked triangle indices; @returns {GeometryData} this. */
  setIndices(indices) {
    const count = this.vertices.length / 3;
    for (const index of indices)
      if (!Number.isSafeInteger(index) || index < 0 || index >= count)
        throw new RangeError("Geometry index is outside the vertex array");
    this.indices = indices;
    return this;
  }
  /** Mark reused vertex/normal arrays dirty; @returns {GeometryData} this. */
  markChanged() {
    this.version++;
    return this;
  }
  /** @returns {Float32Array} Position data in the reference geometry format. */
  get vertices() {
    return this.attributes.position.data;
  }
  /** @returns {Float32Array} Normal data in the reference geometry format. */
  get normals() {
    return this.attributes.normal.data;
  }
}
const Geometry = GeometryData;

/** One drawable referring to immutable geometry and an RGB(A) color. */
export class Mesh {
  constructor(gl, geometry, baseColor, { name = "Mesh" } = {}) {
    this.gl = gl;
    this.geometry = geometry;
    this.baseColor =
      baseColor.length === 4
        ? baseColor
        : new Float32Array([baseColor[0], baseColor[1], baseColor[2], 1]);
    this.name = name;
    this.bundle = null;
    this.disposed = false;
    this.normalMatrix = new Float32Array(9);
  }
  /** Upload once through an owner registry, sharing geometry buffers; @returns {Mesh} this. */
  setup(registry) {
    if (this.disposed) throw new Error("Disposed mesh");
    if (registry.has(this.geometry)) {
      this.bundle = registry.get(this.geometry);
      return this;
    }
    const gl = this.gl,
      geometry = this.geometry;
    const vertexCount = geometry.vertices.length / 3;
    if (
      !Number.isInteger(vertexCount) ||
      geometry.normals.length !== geometry.vertices.length
    )
      throw new RangeError("Position/normal arrays must have matching triples");
    for (const index of geometry.indices)
      if (!Number.isInteger(index) || index < 0 || index >= vertexCount)
        throw new RangeError("Mesh index is outside the vertex array");
    const maximum = geometry.indices.reduce((a, b) => Math.max(a, b), 0);
    const needs32 = maximum > 65535;
    if (
      needs32 &&
      !(
        typeof gl.texStorage2D === "function" &&
        typeof gl.vertexAttribIPointer === "function"
      ) &&
      !gl.getExtension("OES_element_index_uint")
    )
      throw new RangeError("32-bit indices require support or mesh splitting");
    const indices = needs32
      ? new Uint32Array(geometry.indices)
      : new Uint16Array(geometry.indices);
    const created = [];
    const upload = (target, data) => {
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error("Unable to allocate mesh buffer");
      created.push(buffer);
      gl.bindBuffer(target, buffer);
      gl.bufferData(
        target,
        data,
        geometry.dynamicRanges && target === gl.ARRAY_BUFFER
          ? gl.DYNAMIC_DRAW
          : gl.STATIC_DRAW,
      );
      return buffer;
    };
    try {
      this.bundle = {
        positionBuffer: upload(
          gl.ARRAY_BUFFER,
          geometry.vertices instanceof Float32Array
            ? geometry.vertices
            : new Float32Array(geometry.vertices),
        ),
        normalBuffer: upload(
          gl.ARRAY_BUFFER,
          geometry.normals instanceof Float32Array
            ? geometry.normals
            : new Float32Array(geometry.normals),
        ),
        indexBuffer: upload(gl.ELEMENT_ARRAY_BUFFER, indices),
        indexCount: indices.length,
        indexType: needs32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        version: geometry.version,
      };
      registry.set(geometry, this.bundle);
    } catch (error) {
      for (const buffer of created) gl.deleteBuffer(buffer);
      throw error;
    }
    return this;
  }
  /** Draw with a borrowed program/bindings; caller supplies camera uniforms; @returns {void}. */
  draw(shaderInfo, worldMatrix) {
    if (this.disposed || !this.bundle) throw new Error("Mesh is not ready");
    const gl = this.gl,
      bundle = this.bundle;
    if (
      bundle.version !== this.geometry.version &&
      this.geometry.dynamicRanges
    ) {
      for (const range of this.geometry.dynamicRanges) {
        gl.bindBuffer(gl.ARRAY_BUFFER, bundle.positionBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, range.offset, range.positions);
        gl.bindBuffer(gl.ARRAY_BUFFER, bundle.normalBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, range.offset, range.normals);
      }
      bundle.version = this.geometry.version;
    }
    normalMatrix(this.normalMatrix, worldMatrix);
    gl.uniformMatrix4fv(shaderInfo.uniforms.uModelMatrix, false, worldMatrix);
    gl.uniformMatrix3fv(
      shaderInfo.uniforms.uNormalMatrix,
      false,
      this.normalMatrix,
    );
    gl.uniform4fv(shaderInfo.uniforms.uBaseColor, this.baseColor);
    gl.bindBuffer(gl.ARRAY_BUFFER, bundle.positionBuffer);
    gl.vertexAttribPointer(
      shaderInfo.attribs.aPosition,
      3,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.enableVertexAttribArray(shaderInfo.attribs.aPosition);
    gl.bindBuffer(gl.ARRAY_BUFFER, bundle.normalBuffer);
    gl.vertexAttribPointer(
      shaderInfo.attribs.aNormal,
      3,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.enableVertexAttribArray(shaderInfo.attribs.aNormal);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bundle.indexBuffer);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    gl.drawElements(gl.TRIANGLES, bundle.indexCount, bundle.indexType, 0);
  }
  /** Drop this reference; only the character registry deletes shared buffers; @returns {void}. */
  dispose() {
    this.disposed = true;
    this.bundle = null;
  }
}

/** Reference-style node: base * anim by default, optional TRS adapter for Kirby. */
export class SceneNode {
  constructor(options = "Node") {
    const { name = "Node", mesh = null } =
      typeof options === "string" ? { name: options } : options;
    this.name = name;
    this.mesh = mesh;
    this.parent = null;
    this.children = [];
    this.meshes = [];
    this.visible = true;
    this.baseMatrix = identityMatrix();
    this.animMatrix = identityMatrix();
    this.localMatrix = identityMatrix();
    this.worldMatrix = identityMatrix();
    this.meshWorldMatrix = identityMatrix();
    this.transform = new LocalPose();
    this.transform.worldMatrix.elements = this.worldMatrix;
    this.useLocalPose = false;
  }
  /** Attach without changing local transforms; @returns {SceneNode} this. */
  addChild(child) {
    if (child === this || child.parent)
      throw new Error("Node is already attached");
    for (let p = this; p; p = p.parent)
      if (p === child) throw new Error("Cyclic node hierarchy");
    child.parent = this;
    this.children.push(child);
    return this;
  }
  /** Reference-compatible additional mesh/offset; @returns {SceneNode} this. */
  addMesh(mesh, offsetMatrix = null) {
    this.meshes.push({
      mesh,
      offsetMatrix: offsetMatrix
        ? new Float32Array(offsetMatrix)
        : identityMatrix(),
    });
    return this;
  }
  /** Visit this node and descendants; @returns {void}. */
  traverse(callback) {
    callback(this);
    for (const child of this.children) child.traverse(callback);
  }
  /** Set subtree visibility without disposing it; @returns {SceneNode} this. */
  setVisible(visible) {
    this.visible = Boolean(visible);
    return this;
  }
  /** Reset only the legacy matrix-animation layer; @returns {SceneNode} this. */
  resetAnim() {
    this.animMatrix.fill(0);
    this.animMatrix[0] =
      this.animMatrix[5] =
      this.animMatrix[10] =
      this.animMatrix[15] =
        1;
    return this;
  }
  /** Update world matrices, including hidden nodes; @returns {SceneNode} this. */
  updateWorldMatrices(parentWorldMatrix = null) {
    if (this.useLocalPose) {
      this.transform.updateLocalMatrix();
      this.localMatrix.set(this.transform.localMatrix.elements);
    } else multiplyMatrices(this.localMatrix, this.baseMatrix, this.animMatrix);
    if (parentWorldMatrix)
      multiplyMatrices(this.worldMatrix, parentWorldMatrix, this.localMatrix);
    else this.worldMatrix.set(this.localMatrix);
    for (const child of this.children)
      child.updateWorldMatrices(this.worldMatrix);
    return this;
  }
  /** Draw after one world update; @returns {void}. */
  draw(shaderInfo) {
    if (!this.visible) return;
    if (this.mesh) this.mesh.draw(shaderInfo, this.worldMatrix);
    for (const item of this.meshes) {
      multiplyMatrices(
        this.meshWorldMatrix,
        this.worldMatrix,
        item.offsetMatrix,
      );
      item.mesh.draw(shaderInfo, this.meshWorldMatrix);
    }
    for (const child of this.children) child.draw(shaderInfo);
  }
  /** Friend-compatible traversal entry point; @returns {void}. */
  updateAndDraw(shaderInfo, parentWorldMatrix = null) {
    this.updateWorldMatrices(parentWorldMatrix);
    this.draw(shaderInfo);
  }
}
const Node = SceneNode;

// Application-only sampler: fixed data, authored + offset / factor / quaternion
// delta semantics. This replaces the general animation API, not the engine.
class Keyframe {
  constructor({ time, value, interpolation = "linear" }) {
    this.time = time;
    this.interpolation = interpolation;
    this.value = new Float32Array(
      Array.isArray(value) ? value : value.toArray(),
    );
  }
}
class AnimationClip {
  constructor({ name, duration, tracks }) {
    this.name = name;
    this.duration = duration;
    this.tracks = tracks;
  }
}
class ClipPlayer {
  constructor(clip, targets, { loop = true } = {}) {
    this.clip = clip;
    this.loop = loop;
    this.time = 0;
    this.playing = false;
    this.stopped = true;
    this.disposed = false;
    this.bindings = clip.tracks.map((track) => {
      const node = targets.get(track.target);
      if (!(node instanceof SceneNode))
        throw new TypeError("Missing clip target " + track.target);
      const base = node.transform[track.property].toArray();
      return {
        track,
        node,
        base,
        delta: new Quaternion(),
        destination: new Quaternion(),
        authoredRotation:
          track.property === "rotation" ? new Quaternion(...base) : null,
      };
    });
  }
  requireActive() {
    if (this.disposed) throw new Error("Disposed clip player");
  }
  play() {
    this.requireActive();
    if (!this.playing) {
      if (this.stopped || (!this.loop && this.time === this.clip.duration)) {
        this.time = 0;
        this.apply();
      }
      this.stopped = false;
      this.playing = true;
    }
    return this;
  }
  pause() {
    this.requireActive();
    this.playing = false;
    return this;
  }
  restore() {
    for (const { node, track, base } of this.bindings) {
      if (track.property === "position") node.transform.setPosition(...base);
      else if (track.property === "scale") node.transform.setScale(...base);
      else node.transform.setRotation(...base);
    }
  }
  stop() {
    this.requireActive();
    this.playing = false;
    this.time = 0;
    this.stopped = true;
    this.restore();
    return this;
  }
  restart() {
    this.requireActive();
    this.time = 0;
    this.apply();
    this.stopped = false;
    this.playing = true;
    return this;
  }
  seek(time) {
    this.requireActive();
    if (!Number.isFinite(time) || time < 0)
      throw new RangeError("Invalid clip time");
    this.time = this.loop
      ? time % this.clip.duration
      : Math.min(time, this.clip.duration);
    this.apply();
    this.stopped = false;
    return this;
  }
  update(deltaSeconds) {
    this.requireActive();
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
      throw new RangeError("Invalid elapsed seconds");
    if (!this.playing || deltaSeconds === 0) return this;
    const next = this.time + deltaSeconds;
    if (!Number.isFinite(next)) throw new RangeError("Animation time overflow");
    this.time = this.loop
      ? next % this.clip.duration
      : Math.min(next, this.clip.duration);
    this.apply();
    if (!this.loop && this.time === this.clip.duration) this.playing = false;
    return this;
  }
  apply() {
    for (const binding of this.bindings) {
      const { track, node, base } = binding,
        frames = track.keyframes;
      let index = 0;
      while (index + 1 < frames.length && frames[index + 1].time <= this.time)
        index++;
      const first = frames[index],
        second = frames[Math.min(index + 1, frames.length - 1)];
      const alpha =
        second === first || first.interpolation === "step"
          ? 0
          : (this.time - first.time) / (second.time - first.time);
      const left = first.value,
        right = second.value;
      if (track.property === "rotation") {
        binding.delta.set(left[0], left[1], left[2], left[3]);
        if (alpha > 0) {
          binding.destination.set(right[0], right[1], right[2], right[3]);
          binding.delta.slerp(binding.destination, alpha);
        }
        binding.destination
          .copy(binding.authoredRotation)
          .multiply(binding.delta);
        node.transform.setRotationFromQuaternion(binding.destination);
      } else {
        const x = left[0] + alpha * (right[0] - left[0]),
          y = left[1] + alpha * (right[1] - left[1]),
          z = left[2] + alpha * (right[2] - left[2]);
        if (track.property === "position")
          node.transform.setPosition(base[0] + x, base[1] + y, base[2] + z);
        else node.transform.setScale(base[0] * x, base[1] * y, base[2] * z);
      }
    }
  }
  /** Blend this player's sample toward its authored pose, without a second owner. */
  applyWeight(weight) {
    for (const binding of this.bindings) {
      const { node, track, base } = binding,
        value = node.transform[track.property];
      if (track.property === "rotation") {
        binding.delta.copy(value);
        value.copy(binding.authoredRotation).slerp(binding.delta, weight);
      } else
        value.set(
          base[0] + (value.x - base[0]) * weight,
          base[1] + (value.y - base[1]) * weight,
          base[2] + (value.z - base[2]) * weight,
        );
    }
    return this;
  }
  dispose() {
    if (!this.disposed) {
      this.restore();
      this.bindings.length = 0;
      this.playing = false;
      this.disposed = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Required primitive sampling only. Preserve the original grids/poles/winding
// so clipping the real smile opening produces exactly the same body seam.
// ---------------------------------------------------------------------------
function requireDimensions(values, segments) {
  if (
    values.some((value) => !Number.isFinite(value) || value <= 0) ||
    segments.some((value) => !Number.isSafeInteger(value) || value < 3)
  )
    throw new RangeError("Invalid primitive dimensions");
}
function indexedGeometry(positions, normals, uvs, indices, parameters) {
  const vertexCount = positions.length / 3;
  const IndexArray = vertexCount - 1 <= 65535 ? Uint16Array : Uint32Array;
  const geometry = new Geometry()
    .setAttribute("position", new Float32Array(positions), 3)
    .setAttribute("normal", new Float32Array(normals), 3)
    .setAttribute("uv", new Float32Array(uvs), 2)
    .setIndices(new IndexArray(indices));
  geometry.parameters = Object.freeze(parameters);
  return geometry;
}

/** Full ellipsoid with exact cardinal directions and no degenerate pole triangles. */
export function createEllipsoid(
  radiusX,
  radiusY,
  radiusZ,
  widthSegments = 32,
  heightSegments = 16,
) {
  requireDimensions(
    [radiusX, radiusY, radiusZ],
    [widthSegments, heightSegments],
  );
  const positions = [],
    normals = [],
    uvs = [],
    indices = [];
  for (let row = 0; row <= heightSegments; row++) {
    const v = row / heightSegments,
      north = row === 0,
      south = row === heightSegments;
    const theta = north ? 0 : south ? Math.PI : Math.PI * v;
    const sinTheta =
      north || south ? 0 : row * 2 === heightSegments ? 1 : Math.sin(theta);
    const cosTheta = north
      ? 1
      : south
        ? -1
        : row * 2 === heightSegments
          ? 0
          : Math.cos(theta);
    for (let column = 0; column <= widthSegments; column++) {
      const u = column / widthSegments,
        phi = 2 * Math.PI * u;
      const cardinal =
        (column * 4) % widthSegments === 0
          ? ((column * 4) / widthSegments) % 4
          : -1;
      const sinPhi = cardinal === -1 ? Math.sin(phi) : [0, 1, 0, -1][cardinal];
      const cosPhi = cardinal === -1 ? Math.cos(phi) : [1, 0, -1, 0][cardinal];
      const x = north || south ? 0 : sinTheta * cosPhi,
        y = cosTheta,
        z = north || south ? 0 : sinTheta * sinPhi;
      positions.push(
        north || south ? 0 : radiusX * x,
        north ? radiusY : south ? -radiusY : radiusY * y,
        north || south ? 0 : radiusZ * z,
      );
      if (north || south) normals.push(0, north ? 1 : -1, 0);
      else {
        const nx = x / radiusX,
          ny = y / radiusY,
          nz = z / radiusZ,
          length = Math.hypot(nx, ny, nz);
        normals.push(nx / length, ny / length, nz / length);
      }
      uvs.push(u, 1 - v);
    }
  }
  for (let row = 0; row < heightSegments; row++)
    for (let column = 0; column < widthSegments; column++) {
      const a = row * (widthSegments + 1) + column,
        b = a + 1,
        c = a + widthSegments + 1,
        d = c + 1;
      if (row === 0) indices.push(a, d, c);
      else if (row === heightSegments - 1) indices.push(a, b, d);
      else indices.push(a, b, d, a, d, c);
    }
  return indexedGeometry(positions, normals, uvs, indices, {
    radiusX,
    radiusY,
    radiusZ,
    widthSegments,
    heightSegments,
  });
}
function EllipsoidGeometry(...args) {
  return createEllipsoid(...args);
}

/** Modified elliptic paraboloid x=a*v*cos(u), y=b*v*sin(u), z=v*v, open +Z rim. */
export function createEllipticParaboloid(
  a,
  b,
  vMax,
  radialSegments = 32,
  heightSegments = 16,
) {
  requireDimensions([a, b, vMax], [radialSegments, heightSegments]);
  const positions = [],
    normals = [],
    uvs = [],
    indices = [],
    smallerAxis = Math.min(a, b);
  for (let row = 0; row <= heightSegments; row++) {
    const fraction = row / heightSegments,
      v = vMax * fraction,
      twiceV = 2 * v;
    for (let column = 0; column <= radialSegments; column++) {
      const uFraction = column / radialSegments,
        u =
          column === radialSegments
            ? -Math.PI
            : -Math.PI + 2 * Math.PI * uFraction;
      const cosine = Math.cos(u),
        sine = Math.sin(u);
      positions.push(
        row === 0 ? 0 : a * v * cosine,
        row === 0 ? 0 : b * v * sine,
        v * v,
      );
      if (!row) normals.push(0, 0, -1);
      else {
        const axial = twiceV < smallerAxis ? twiceV / smallerAxis : 1;
        const radial = twiceV < smallerAxis ? 1 : smallerAxis / twiceV;
        const nx = axial * (smallerAxis / a) * cosine,
          ny = axial * (smallerAxis / b) * sine,
          nz = -radial;
        const inverse = 1 / Math.hypot(nx, ny, nz);
        normals.push(nx * inverse, ny * inverse, nz * inverse);
      }
      uvs.push(uFraction, fraction);
    }
  }
  for (let row = 0; row < heightSegments; row++)
    for (let column = 0; column < radialSegments; column++) {
      const a = row * (radialSegments + 1) + column,
        b = a + 1,
        c = a + radialSegments + 1,
        d = c + 1;
      if (row) indices.push(a, b, d);
      indices.push(a, d, c);
    }
  return indexedGeometry(positions, normals, uvs, indices, {
    a,
    b,
    vMax,
    radialSegments,
    heightSegments,
  });
}
function EllipticParaboloidGeometry(...args) {
  return createEllipticParaboloid(...args);
}

/** Closed cylinder with the original side winding and hard-normal cap wedges. */
export function createCylinder(
  radiusTop,
  radiusBottom,
  height,
  radialSegments = 32,
  heightSegments = 1,
  openEnded = false,
) {
  requireDimensions([radiusTop, radiusBottom, height], [radialSegments]);
  if (!Number.isInteger(heightSegments) || heightSegments < 1)
    throw new RangeError("Invalid cylinder subdivisions");
  const positions = [],
    normals = [],
    uvs = [],
    indices = [],
    normalScale = Math.hypot(height, radiusBottom - radiusTop);
  for (let row = 0; row <= heightSegments; row++)
    for (let column = 0; column <= radialSegments; column++) {
      const v = row / heightSegments,
        u = column / radialSegments,
        theta = 2 * Math.PI * u;
      const radius = radiusBottom + (radiusTop - radiusBottom) * v;
      positions.push(
        radius * Math.cos(theta),
        -height / 2 + height * v,
        radius * Math.sin(theta),
      );
      normals.push(
        (height * Math.cos(theta)) / normalScale,
        (radiusBottom - radiusTop) / normalScale,
        (height * Math.sin(theta)) / normalScale,
      );
      uvs.push(u, v);
    }
  for (let row = 0; row < heightSegments; row++)
    for (let column = 0; column < radialSegments; column++) {
      const a = row * (radialSegments + 1) + column,
        b = a + 1,
        c = a + radialSegments + 1,
        d = c + 1;
      indices.push(a, d, b, a, c, d);
    }
  if (!openEnded)
    for (const isTop of [true, false]) {
      const radius = isTop ? radiusTop : radiusBottom,
        y = ((isTop ? 1 : -1) * height) / 2;
      for (let segment = 0; segment < radialSegments; segment++) {
        const start = positions.length / 3,
          theta0 = 2 * Math.PI * (segment / radialSegments),
          theta1 = 2 * Math.PI * ((segment + 1) / radialSegments);
        for (const [x, z] of [
          [0, 0],
          [radius * Math.cos(theta0), radius * Math.sin(theta0)],
          [radius * Math.cos(theta1), radius * Math.sin(theta1)],
        ]) {
          positions.push(x, y, z);
          normals.push(0, isTop ? 1 : -1, 0);
          uvs.push(0.5 + x / (2 * radius), 0.5 + z / (2 * radius));
        }
        indices.push(
          start,
          isTop ? start + 2 : start + 1,
          isTop ? start + 1 : start + 2,
        );
      }
    }
  return indexedGeometry(positions, normals, uvs, indices, {
    radiusTop,
    radiusBottom,
    height,
    radialSegments,
    heightSegments,
    openEnded,
  });
}
function CylinderGeometry(...args) {
  return createCylinder(...args);
}

// ---------------------------------------------------------------------------
// Kirby-specific closed geometry, preserved from the reviewed application.
// ---------------------------------------------------------------------------
const createKirbyMouthGeometry = (() => {
  const SAMPLES_PER_SEGMENT = 16;
  // Affine layout of the same four cubic segments: a smaller, higher cartoon
  // smile, coordinated with the eyes/cheeks rather than a low surprised mouth.
  const SMILE_SCALE_X = 0.78;
  const SMILE_SCALE_Y = 0.9;
  const SMILE_OFFSET_Y = 0.18;
  const CENTER_Y = -0.405 * SMILE_SCALE_Y + SMILE_OFFSET_Y;
  const EPSILON = 1e-9;
  const SMILE_SEGMENTS = [
    [
      [-0.34, -0.22],
      [-0.25, -0.195],
      [-0.12, -0.19],
      [0, -0.19],
    ],
    [
      [0, -0.19],
      [0.12, -0.19],
      [0.25, -0.195],
      [0.34, -0.22],
    ],
    [
      [0.34, -0.22],
      [0.39, -0.24],
      [0.24, -0.64],
      [0, -0.64],
    ],
    [
      [0, -0.64],
      [-0.24, -0.64],
      [-0.39, -0.24],
      [-0.34, -0.22],
    ],
  ];

  /** Signed XY edge test for polygon clipping and barycentric coordinates. */
  function cross(a, b, p) {
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  }

  function sampleSmile() {
    const outline = [];
    for (const segment of SMILE_SEGMENTS) {
      for (let sample = 0; sample < SAMPLES_PER_SEGMENT; sample += 1) {
        const t = sample / SAMPLES_PER_SEGMENT;
        const [x, y] = [0, 1].map((axis) =>
          evaluateCubicBezierComponent(
            segment[0][axis],
            segment[1][axis],
            segment[2][axis],
            segment[3][axis],
            t,
          ),
        );
        outline.push([x * SMILE_SCALE_X, y * SMILE_SCALE_Y + SMILE_OFFSET_Y]);
      }
    }
    return outline.reverse(); // CCW from the +Z camera.
  }

  function clipHalfPlane(polygon, a, b, inside) {
    const result = [];
    for (let index = 0; index < polygon.length; index += 1) {
      const p = polygon[index],
        q = polygon[(index + 1) % polygon.length];
      const dp = cross(a, b, p),
        dq = cross(a, b, q);
      const keepP = inside ? dp >= 0 : dp <= 0;
      const keepQ = inside ? dq >= 0 : dq <= 0;
      if (keepP) result.push(p);
      if (keepP !== keepQ) {
        const t = dp / (dp - dq);
        result.push(
          p.map((value, component) => value + (q[component] - value) * t),
        );
      }
    }
    return result;
  }

  function bodyTriangles(bodyGeometry, outline) {
    const positions = bodyGeometry.getAttribute("position").data;
    const normals = bodyGeometry.getAttribute("normal").data;
    const result = [];
    const indices = bodyGeometry.indices;
    const minX = Math.min(...outline.map((point) => point[0])) - EPSILON;
    const maxX = Math.max(...outline.map((point) => point[0])) + EPSILON;
    const minY = Math.min(...outline.map((point) => point[1])) - EPSILON;
    const maxY = Math.max(...outline.map((point) => point[1])) + EPSILON;
    for (let offset = 0; offset < indices.length; offset += 3) {
      const triangle = [
        indices[offset],
        indices[offset + 1],
        indices[offset + 2],
      ].map((index) => [
        ...positions.slice(index * 3, index * 3 + 3),
        ...normals.slice(index * 3, index * 3 + 3),
      ]);
      if (
        triangle.every((point) => point[2] > 0) &&
        Math.min(...triangle.map((point) => point[0])) < maxX &&
        Math.max(...triangle.map((point) => point[0])) > minX &&
        Math.min(...triangle.map((point) => point[1])) < maxY &&
        Math.max(...triangle.map((point) => point[1])) > minY
      ) {
        result.push({ offset, triangle });
      }
    }
    return result;
  }

  function surfacePoint(x, y, triangles) {
    for (const {
      triangle: [a, b, c],
    } of triangles) {
      const area = cross(a, b, c);
      const wa = cross(b, c, [x, y]) / area;
      const wb = cross(c, a, [x, y]) / area;
      const wc = 1 - wa - wb;
      if (wa >= -EPSILON && wb >= -EPSILON && wc >= -EPSILON) {
        return [
          x,
          y,
          ...[2, 3, 4, 5].map(
            (axis) => wa * a[axis] + wb * b[axis] + wc * c[axis],
          ),
        ];
      }
    }
    throw new RangeError("Kirby mouth point is outside the local body patch");
  }

  // Split the curve at the original body edges. The clipped body and lip share
  // the same piecewise-linear seam, including crossings of triangle diagonals.
  function matchBodySeam(outline, triangles) {
    const seam = [];
    for (let index = 0; index < outline.length; index += 1) {
      const a = outline[index],
        b = outline[(index + 1) % outline.length];
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        parameters = [0];
      for (const { triangle } of triangles) {
        for (let edge = 0; edge < 3; edge += 1) {
          const p = triangle[edge],
            q = triangle[(edge + 1) % 3];
          const ex = q[0] - p[0],
            ey = q[1] - p[1];
          const determinant = dx * ey - dy * ex;
          if (Math.abs(determinant) < EPSILON) continue;
          const t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / determinant;
          const u = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / determinant;
          if (
            t > EPSILON &&
            t < 1 - EPSILON &&
            u >= -EPSILON &&
            u <= 1 + EPSILON
          )
            parameters.push(t);
        }
      }
      parameters.sort((first, second) => first - second);
      let previous = -1;
      for (const t of parameters) {
        if (t - previous < EPSILON) continue;
        seam.push(surfacePoint(a[0] + dx * t, a[1] + dy * t, triangles));
        previous = t;
      }
    }
    return seam;
  }

  function cutBodyOpening(bodyGeometry, outline, triangles, radii) {
    const positions = Array.from(bodyGeometry.getAttribute("position").data);
    const normals = Array.from(bodyGeometry.getAttribute("normal").data);
    const uvs = Array.from(bodyGeometry.getAttribute("uv").data),
      indices = [];
    const candidates = new Map(
      triangles.map(({ offset, triangle }) => [offset, triangle]),
    );
    const emit = (polygon) => {
      for (let index = 1; index < polygon.length - 1; index += 1) {
        const triangle = [polygon[0], polygon[index], polygon[index + 1]];
        if (Math.abs(cross(...triangle)) < 1e-13) continue;
        for (const point of triangle) {
          indices.push(positions.length / 3);
          positions.push(...point.slice(0, 3));
          const length = Math.hypot(...point.slice(3));
          normals.push(...point.slice(3).map((value) => value / length));
          uvs.push(
            0.5 + point[0] / (2 * radii.radiusX),
            0.5 + point[1] / (2 * radii.radiusY),
          );
        }
      }
    };
    for (let offset = 0; offset < bodyGeometry.indices.length; offset += 3) {
      if (!candidates.has(offset)) {
        indices.push(...bodyGeometry.indices.slice(offset, offset + 3));
        continue;
      }
      let remaining = candidates.get(offset);
      for (
        let edge = 0;
        edge < outline.length && remaining.length >= 3;
        edge += 1
      ) {
        const a = outline[edge],
          b = outline[(edge + 1) % outline.length];
        emit(clipHalfPlane(remaining, a, b, false));
        remaining = clipHalfPlane(remaining, a, b, true);
      }
      // The remaining polygon is inside the smile and deliberately omitted.
    }
    return bodyGeometry
      .setAttribute("position", new Float32Array(positions), 3)
      .setAttribute("normal", new Float32Array(normals), 3)
      .setAttribute("uv", new Float32Array(uvs), 2)
      .setIndices(
        new (positions.length / 3 > 65535 ? Uint32Array : Uint16Array)(indices),
      );
  }

  function meshFromRings(rings, closeCenter = false) {
    const count = rings[0].length,
      positions = rings.flat(2),
      indices = [];
    for (let ring = 0; ring < rings.length - 1; ring += 1) {
      for (let index = 0; index < count; index += 1) {
        const next = (index + 1) % count;
        const a = ring * count + index,
          b = ring * count + next,
          c = a + count,
          d = b + count;
        indices.push(a, b, c, b, d, c);
      }
    }
    if (closeCenter) {
      const center = positions.length / 3,
        last = rings.at(-1);
      positions.push(
        0,
        CENTER_Y,
        last.reduce((sum, point) => sum + point[2], 0) / count - 0.015,
      );
      for (let index = 0; index < count; index += 1)
        indices.push(
          (rings.length - 1) * count + index,
          (rings.length - 1) * count + ((index + 1) % count),
          center,
        );
    }
    const normals = new Float32Array(positions.length);
    for (let offset = 0; offset < indices.length; offset += 3) {
      const [a, b, c] = indices
        .slice(offset, offset + 3)
        .map((index) => index * 3);
      const ab = [0, 1, 2].map(
        (axis) => positions[b + axis] - positions[a + axis],
      );
      const ac = [0, 1, 2].map(
        (axis) => positions[c + axis] - positions[a + axis],
      );
      const normal = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      for (const vertex of [a, b, c])
        for (let axis = 0; axis < 3; axis += 1)
          normals[vertex + axis] += normal[axis];
    }
    const uvs = new Float32Array((positions.length / 3) * 2);
    for (let offset = 0; offset < positions.length; offset += 3) {
      const length = Math.hypot(
        normals[offset],
        normals[offset + 1],
        normals[offset + 2],
      );
      for (let axis = 0; axis < 3; axis += 1) normals[offset + axis] /= length;
      uvs[(offset / 3) * 2] = positions[offset] + 0.5;
      uvs[(offset / 3) * 2 + 1] = positions[offset + 1] + 0.7;
    }
    return new Geometry()
      .setAttribute("position", new Float32Array(positions), 3)
      .setAttribute("normal", normals, 3)
      .setAttribute("uv", uvs, 2)
      .setIndices(new Uint16Array(indices));
  }

  /**
   * Builds an application-specific smile cavity and a body with a matching hole.
   * Only front triangles near the sampled cubic smile are clipped; the rest of
   * the original ellipsoid surface is retained. A rolled pink edge joins the
   * exact body seam to inward-facing walls and a recessed dark bowl. The tongue
   * is a closed ellipsoid with visible curvature and 0.13 units of thickness.
   *
   * Expression preparation later subdivides local triangles once and captures
   * corresponding body/rim/wall/bowl targets. The closed smile is a narrow curved
   * recessed crease with positive aperture, never a singular collapsed cavity.
   *
   * @param {{radiusX:number, radiusY:number, radiusZ:number, widthSegments:number, heightSegments:number}} radii - Body dimensions and tessellation.
   * @returns {{bodyGeometry:EllipsoidGeometry, edgeGeometry:Geometry, wallGeometry:Geometry, interiorGeometry:Geometry, tongueGeometry:EllipsoidGeometry, opening:ReadonlyArray}} Application-owned geometries and corresponding seam samples.
   */
  function createKirbyMouthGeometry(radii) {
    if (
      !radii ||
      ![radii.radiusX, radii.radiusY, radii.radiusZ].every(
        (value) => Number.isFinite(value) && value > 0,
      )
    ) {
      throw new RangeError("Kirby mouth requires positive finite body radii");
    }
    const bodyGeometry = new EllipsoidGeometry(
      radii.radiusX,
      radii.radiusY,
      radii.radiusZ,
      radii.widthSegments,
      radii.heightSegments,
    );
    const outline = sampleSmile(),
      triangles = bodyTriangles(bodyGeometry, outline);
    const seam = matchBodySeam(outline, triangles);
    cutBodyOpening(bodyGeometry, outline, triangles, radii);
    const ring = (scale, depth) =>
      seam.map(([x, y]) => {
        const px = x * scale,
          py = CENTER_Y + (y - CENTER_Y) * scale;
        const surface = surfacePoint(px, py, triangles)[2];
        return [px, py, surface - depth];
      });
    const innerEdge = ring(0.94, 0.025),
      wallBottom = ring(0.82, 0.24);
    const edgeGeometry = meshFromRings([
      seam.map((point) => point.slice(0, 3)),
      ring(0.99, -0.002),
      ring(0.98, -0.004),
      ring(0.96, 0.005),
      innerEdge,
    ]);
    const edgeNormals = edgeGeometry.getAttribute("normal").data;
    seam.forEach((point, index) => {
      const length = Math.hypot(...point.slice(3));
      edgeNormals.set(
        point.slice(3).map((value) => value / length),
        index * 3,
      );
    });
    edgeGeometry.markChanged();
    const wallGeometry = meshFromRings([innerEdge, ring(0.9, 0.1), wallBottom]);
    const interiorGeometry = meshFromRings(
      [wallBottom, ring(0.45, 0.28)],
      true,
    );
    const tongueGeometry = new EllipsoidGeometry(
      0.2 * SMILE_SCALE_X,
      0.085 * SMILE_SCALE_Y,
      0.065,
      32,
      16,
    );
    const tonguePositions = tongueGeometry.getAttribute("position").data;
    const tongueY = -0.49 * SMILE_SCALE_Y + SMILE_OFFSET_Y;
    const tongueZ =
      radii.radiusZ * Math.sqrt(1 - (tongueY / radii.radiusY) ** 2) - 0.15;
    for (let offset = 0; offset < tonguePositions.length; offset += 3) {
      tonguePositions[offset + 1] += tongueY;
      tonguePositions[offset + 2] += tongueZ;
    }
    tongueGeometry.markChanged();
    return {
      bodyGeometry,
      edgeGeometry,
      wallGeometry,
      interiorGeometry,
      tongueGeometry,
      opening: Object.freeze(
        seam.map((point) => Object.freeze(point.slice(0, 3))),
      ),
    };
  }

  return createKirbyMouthGeometry;
})();
export const createStarRodStripeGeometry = (() => {
  const FLOAT32_MAX = 3.4028234663852886e38;
  const MAX_TYPED_ARRAY_LENGTH = 4294967295;
  const SAMPLES_PER_TURN = 24;
  const HANDLE_EMBED_FRACTION = 1 / 110;
  const BEZIER_SEGMENTS_PER_TURN = 16;
  const END_TAPER_SEGMENTS = 4;
  const END_WIDTH_FRACTION = 1 / 3;

  /** Restrict a cubic smoothstep to one segment as four Bernstein controls.
   * @returns {number[]} Exact scalar controls; zero value/slope at the central join.
   */
  function endWeightControls(index, count, upper) {
    const value = (x) => {
      const u = upper
        ? (x - (count - END_TAPER_SEGMENTS)) / END_TAPER_SEGMENTS
        : 1 - x / END_TAPER_SEGMENTS;
      if (u <= 0) return [0, 0];
      if (u >= 1) return [1, 0];
      return [
        u * u * (3 - 2 * u),
        ((upper ? 1 : -1) * 6 * u * (1 - u)) / END_TAPER_SEGMENTS,
      ];
    };
    const a = value(index),
      b = value(index + 1);
    return [a[0], a[0] + a[1] / 3, b[0] - b[1] / 3, b[0]];
  }

  /** Shape only short end regions using explicit cubic 3D boundary controls.
   * @returns {object} Center/boundary polygons and documented finite tip dimensions.
   */
  function createStripeEndControls(baseSegments, width, margin, softEnds) {
    const tipWidth = softEnds ? width * END_WIDTH_FRACTION : width;
    const halfReduction = (width - tipWidth) / 2;
    const lowerShift = softEnds ? halfReduction + margin / 2 : 0;
    const upperShift = halfReduction;
    const segments = [],
      boundarySegments = [[], []];
    baseSegments.forEach((base, index) => {
      const lower = softEnds
        ? endWeightControls(index, baseSegments.length, false)
        : [0, 0, 0, 0];
      const upper = softEnds
        ? endWeightControls(index, baseSegments.length, true)
        : [0, 0, 0, 0];
      const center = base.map((p, control) => [
        p[0],
        p[1] - lowerShift * lower[control] + upperShift * upper[control],
        p[2],
      ]);
      segments.push(center);
      for (let boundary = 0; boundary < 2; boundary += 1) {
        const sign = boundary === 0 ? -1 : 1;
        boundarySegments[boundary].push(
          center.map((p, control) => [
            p[0],
            p[1] +
              sign *
                (width / 2 - halfReduction * (lower[control] + upper[control])),
            p[2],
          ]),
        );
      }
    });
    return { segments, boundarySegments, tipWidth, lowerShift, upperShift };
  }

  /** Construct explicit cubic 3D control polygons once; no sampled helix projection.
   * @returns {number[][][]} Segments containing P0, P1, P2, P3 in XYZ order.
   */
  function createSpiralBezierControlPoints(radius, travel, angle, phase) {
    const count = Math.ceil((angle / (2 * Math.PI)) * BEZIER_SEGMENTS_PER_TURN);
    const delta = angle / count,
      handle = (4 / 3) * Math.tan(delta / 4);
    const anchors = Array.from({ length: count + 1 }, (_, index) => {
      const theta = phase + index * delta;
      return {
        point: [
          radius * Math.cos(theta),
          -travel / 2 + (travel * index) / count,
          radius * Math.sin(theta),
        ],
        tangent: [-radius * Math.sin(theta), 0, radius * Math.cos(theta)],
      };
    });
    return Array.from({ length: count }, (_, index) => {
      const a = anchors[index],
        b = anchors[index + 1];
      return [
        a.point.slice(),
        [
          a.point[0] + handle * a.tangent[0],
          a.point[1] + travel / count / 3,
          a.point[2] + handle * a.tangent[2],
        ],
        [
          b.point[0] - handle * b.tangent[0],
          b.point[1] - travel / count / 3,
          b.point[2] - handle * b.tangent[2],
        ],
        b.point.slice(),
      ];
    });
  }

  /** Evaluate a cubic and its analytic derivative into reused XYZ storage.
   * @returns {void}
   */
  function evaluateSpiralBezier(segment, t, point, tangent) {
    const inverse = 1 - t;
    for (let axis = 0; axis < 3; axis += 1) {
      const [p0, p1, p2, p3] = segment.map((control) => control[axis]);
      point[axis] = evaluateCubicBezierComponent(p0, p1, p2, p3, t);
      tangent[axis] =
        3 *
        (inverse * inverse * (p1 - p0) +
          2 * inverse * t * (p2 - p1) +
          t * t * (p3 - p2));
    }
  }

  /** Clip an overscanned, constant-width Bezier solid and close its cut loops.
   * Intersections are mesh-edge/plane intersections, NOT new Bezier samples.
   * @returns {Geometry} One closed indexed solid, constructed once on the CPU.
   */
  function createTrimmedStripeGeometry(options) {
    const {
      handleRadius,
      handleHeight,
      stripeRadius,
      stripeWidth,
      thickness,
      turns,
      sampleCount,
      phase,
      endMargin,
    } = options;
    const centralTravel = handleHeight - 2 * endMargin - stripeWidth;
    const pitch = centralTravel / turns;
    // Eighth-turn overscan keeps the authored 24 samples/turn and 16 cubics/turn
    // aligned. Both original starting/ending walls are strictly OUTSIDE the cut.
    const extensionTurns =
      Math.ceil(
        ((handleHeight - centralTravel + stripeWidth) / 2 / pitch + 1e-10) * 8,
      ) / 8;
    const sourceTurns = turns + 2 * extensionTurns;
    const sourceOptions = {
      ...options,
      trimToHandle: false,
      softEnds: false,
      handleHeight:
        centralTravel +
        2 * extensionTurns * pitch +
        2 * endMargin +
        stripeWidth,
      turns: sourceTurns,
      phase: phase - extensionTurns * 2 * Math.PI,
      sampleCount:
        sampleCount +
        2 * Math.ceil((extensionTurns * (sampleCount - 1)) / turns),
    };
    const source = createStarRodStripeGeometry(sourceOptions);
    const sourceUV = source.getAttribute("uv").data;
    // Match the actual cylinder's Float32 cap positions, including custom heights.
    const halfHeight = Math.fround(handleHeight / 2),
      points = [],
      pointMap = new Map(),
      triangles = [];
    const pointFor = (p) => {
      const rounded = p.map(Math.fround),
        key = rounded.map((v) => Math.round(v * 1e8)).join(",");
      if (!pointMap.has(key)) {
        const point = {
          p: rounded,
          id: points.length,
          buried: false,
          tags: 0,
          pathU: null,
        };
        pointMap.set(key, point);
        points.push(point);
      }
      return pointMap.get(key);
    };
    const normalize = (n) => {
      const length = Math.hypot(...n);
      if (!(length > 0)) throw new RangeError("Invalid clipped normal");
      return n.map((v) => v / length);
    };
    const faceNormal = ([a, b, c]) => {
      const u = b.point.p.map((v, i) => v - a.point.p[i]),
        v = c.point.p.map((x, i) => x - a.point.p[i]);
      return [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
    };
    const clip = (polygon, plane, sign) => {
      const result = [];
      for (let i = 0; i < polygon.length; i += 1) {
        const a = polygon[i],
          b = polygon[(i + 1) % polygon.length];
        const insideA = sign * (a.point.p[1] - plane) >= 0,
          insideB = sign * (b.point.p[1] - plane) >= 0;
        if (insideA) result.push(a);
        if (insideA !== insideB) {
          const t = (plane - a.point.p[1]) / (b.point.p[1] - a.point.p[1]);
          const p = a.point.p.map((v, k) =>
            k === 1 ? plane : v + t * (b.point.p[k] - v),
          );
          result.push({
            point: pointFor(p),
            normal: normalize(
              a.normal.map((v, k) => v + t * (b.normal[k] - v)),
            ),
            uv: a.uv.map((v, k) => v + t * (b.uv[k] - v)),
            intersection: true,
          });
        }
      }
      return result.filter(
        (v, i) =>
          v.point !== result[(i + result.length - 1) % result.length]?.point,
      );
    };
    for (let i = 0; i < source.indices.length; i += 3) {
      const faceCount = source.userData.spiralBezier.sampleCount * 2;
      const surfaceTag =
        source.indices[i] < faceCount
          ? 1
          : source.indices[i] < faceCount * 2
            ? 2
            : 4;
      let polygon = Array.from(source.indices.subarray(i, i + 3), (index) => ({
        point: pointFor(
          Array.from(source.vertices.subarray(index * 3, index * 3 + 3)),
        ),
        normal: Array.from(source.normals.subarray(index * 3, index * 3 + 3)),
        uv: Array.from(sourceUV.subarray(index * 2, index * 2 + 2)),
        intersection: false,
      }));
      polygon = clip(clip(polygon, -halfHeight, 1), halfHeight, -1);
      for (const vertex of polygon) {
        vertex.point.tags |= surfaceTag;
        if (surfaceTag !== 4) vertex.point.pathU = vertex.uv[0];
      }
      for (let j = 1; j + 1 < polygon.length; j += 1) {
        const vertices = [polygon[0], polygon[j], polygon[j + 1]];
        if (Math.hypot(...faceNormal(vertices)) > 1e-14)
          triangles.push({ vertices, cap: false, surface: surfaceTag });
      }
    }
    const bodyTriangleCount = triangles.length,
      loops = [];
    for (const plane of [-halfHeight, halfHeight]) {
      const cutEdges = new Map();
      for (const { vertices } of triangles.slice(0, bodyTriangleCount))
        for (let i = 0; i < 3; i += 1) {
          const a = vertices[i].point,
            b = vertices[(i + 1) % 3].point;
          if (a.p[1] !== plane || b.p[1] !== plane || a === b) continue;
          const key = [a.id, b.id].sort((x, y) => x - y).join(",");
          const edge = cutEdges.get(key) || { a, b, count: 0 };
          edge.count += 1;
          cutEdges.set(key, edge);
        }
      const adjacency = new Map();
      for (const { a, b, count } of cutEdges.values())
        if (count === 1) {
          for (const [u, v] of [
            [a, b],
            [b, a],
          ]) {
            if (!adjacency.has(u)) adjacency.set(u, []);
            adjacency.get(u).push(v);
          }
        }
      if (
        !adjacency.size ||
        Array.from(adjacency.values()).some(
          (neighbors) => neighbors.length !== 2,
        )
      ) {
        throw new RangeError("Stripe cut must form closed, unbranched loops");
      }
      const remaining = new Set(adjacency.keys());
      while (remaining.size) {
        const start = remaining.values().next().value,
          loop = [];
        let previous = null,
          current = start;
        do {
          loop.push(current);
          remaining.delete(current);
          const next = adjacency.get(current).find((p) => p !== previous);
          previous = current;
          current = next;
          if (loop.length > adjacency.size)
            throw new RangeError("Invalid stripe cut loop");
        } while (current !== start);
        const cross2 = (a, b, c) =>
          (b.p[0] - a.p[0]) * (c.p[2] - a.p[2]) -
          (b.p[2] - a.p[2]) * (c.p[0] - a.p[0]);
        const area = loop.reduce((sum, a, i) => {
          const b = loop[(i + 1) % loop.length];
          return sum + a.p[0] * b.p[2] - b.p[0] * a.p[2];
        }, 0);
        const direction = plane < 0 ? 1 : -1; // XZ CCW faces -Y.
        if (area * direction < 0) loop.reverse();
        loops.push({ plane, points: loop.slice() });
        const appendCap = (vertices) =>
          triangles.push({
            vertices: vertices.map((point) => ({
              point,
              normal: [0, plane < 0 ? -1 : 1, 0],
              uv: [
                0.5 + point.p[0] / (2 * stripeRadius),
                0.5 + point.p[2] / (2 * stripeRadius),
              ],
              intersection: true,
            })),
            cap: true,
            surface: 8,
          });
        // Pair matching outer/inner cut samples into short annular cells.
        // Include all intermediate wall-cut points at the two radial ends;
        // omitting them would leave T-junctions at the solid's boundary.
        const outer = loop
          .filter((p) => p.tags & 1)
          .sort((a, b) => a.pathU - b.pathU);
        const inner = loop
          .filter((p) => p.tags & 2)
          .sort((a, b) => a.pathU - b.pathU);
        const connector = (a, b) => {
          for (const step of [1, -1]) {
            const result = [a];
            let index = loop.indexOf(a);
            for (let n = 0; n < loop.length; n += 1) {
              index = (index + step + loop.length) % loop.length;
              const point = loop[index];
              result.push(point);
              if (point === b) return result;
              if (point.tags & 3) break;
            }
          }
          throw new RangeError("Invalid radial stripe cut connector");
        };
        let cells = [loop];
        if (
          outer.length === inner.length &&
          outer.length > 1 &&
          outer.every((p, i) => Math.abs(p.pathU - inner[i].pathU) < 1e-7)
        ) {
          const lower = connector(outer[0], inner[0]),
            upper = connector(outer.at(-1), inner.at(-1));
          cells = outer
            .slice(0, -1)
            .map((p, i) => [
              p,
              outer[i + 1],
              ...(i === outer.length - 2 ? upper.slice(1, -1) : []),
              inner[i + 1],
              inner[i],
              ...(i === 0 ? lower.slice(1, -1).reverse() : []),
            ]);
        }
        // Ear clipping each small cell (never a center fan) preserves the
        // annular hole and avoids long diagonals across the cream cap.
        for (const cell of cells) {
          const polygon = cell.slice();
          const cellArea = polygon.reduce((sum, a, i) => {
            const b = polygon[(i + 1) % polygon.length];
            return sum + a.p[0] * b.p[2] - b.p[0] * a.p[2];
          }, 0);
          if (cellArea * direction < 0) polygon.reverse();
          while (polygon.length > 3) {
            let best = null;
            for (let i = 0; i < polygon.length; i += 1) {
              const a = polygon[(i + polygon.length - 1) % polygon.length],
                b = polygon[i],
                c = polygon[(i + 1) % polygon.length];
              if (cross2(a, b, c) * direction <= 1e-14) continue;
              const occupied = polygon.some(
                (p) =>
                  p !== a &&
                  p !== b &&
                  p !== c &&
                  cross2(a, b, p) * direction >= -1e-13 &&
                  cross2(b, c, p) * direction >= -1e-13 &&
                  cross2(c, a, p) * direction >= -1e-13,
              );
              if (occupied) continue;
              // Prefer short, well-shaped ears across the narrow shell,
              // rather than long near-collinear diagonals along its arcs.
              const squared = (u, v) =>
                (u.p[0] - v.p[0]) ** 2 + (u.p[2] - v.p[2]) ** 2;
              const quality =
                (cross2(a, b, c) * direction) /
                (squared(a, b) + squared(b, c) + squared(c, a));
              if (!best || quality > best.quality)
                best = { i, a, b, c, quality };
            }
            if (!best)
              throw new RangeError(
                "Stripe cut polygon cannot be triangulated safely",
              );
            appendCap([best.a, best.b, best.c]);
            polygon.splice(best.i, 1);
          }
          if (cross2(...polygon) * direction <= 1e-14)
            throw new RangeError("Degenerate stripe cut closure");
          appendCap(polygon);
        }
      }
    }
    // Bury ONLY the already-embedded part of each thin closure. This real
    // geometric bevel avoids coplanarity with the unchanged cream cap. The
    // exposed outer rim still ends exactly at the actual cylinder end plane.
    const innerRadius = stripeRadius - thickness,
      closureInset = Math.min(0.0004, thickness / 12, handleHeight * 0.001);
    for (const { plane, points: loop } of loops)
      for (const point of loop) {
        const radius = Math.hypot(point.p[0], point.p[2]);
        if (radius < handleRadius) {
          const fraction = Math.min(
            1,
            (handleRadius - radius) / (handleRadius - innerRadius),
          );
          point.p[1] = Math.fround(
            plane - Math.sign(plane) * closureInset * fraction,
          );
          point.buried = true;
        }
      }
    const positions = [],
      normals = [],
      uvs = [],
      indices = [],
      provenance = [],
      surfaceKinds = [];
    for (const { vertices, cap, surface } of triangles) {
      const geometric = normalize(faceNormal(vertices));
      const flat = cap || vertices.some((v) => v.point.buried);
      for (const vertex of vertices) {
        indices.push(indices.length);
        positions.push(...vertex.point.p);
        normals.push(...(flat ? geometric : vertex.normal));
        uvs.push(...vertex.uv);
        provenance.push(cap ? 2 : vertex.intersection ? 1 : 0);
        surfaceKinds.push(surface);
      }
    }
    if (
      positions.length > MAX_TYPED_ARRAY_LENGTH ||
      indices.length > MAX_TYPED_ARRAY_LENGTH
    )
      throw new RangeError("Clipped stripe exceeds capacity");
    const geometry = new Geometry()
      .setAttribute("position", new Float32Array(positions), 3)
      .setAttribute("normal", new Float32Array(normals), 3)
      .setAttribute("uv", new Float32Array(uvs), 2)
      .setIndices(
        indices.length <= 65535
          ? new Uint16Array(indices)
          : new Uint32Array(indices),
      );
    geometry.userData.spiralBezier = source.userData.spiralBezier;
    geometry.userData.trim = {
      handleHeight,
      handleRadius,
      lowerPlane: -halfHeight,
      upperPlane: halfHeight,
      pitch,
      designTurns: turns,
      designPhase: phase,
      centralTravel,
      extensionTurns,
      sourceOptions,
      bodyTriangleCount,
      capTriangleCount: triangles.length - bodyTriangleCount,
      closureInset,
      provenance: new Uint8Array(provenance),
      surfaceKinds: new Uint8Array(surfaceKinds),
      contours: loops.map((loop) => ({
        plane: loop.plane,
        positions: new Float32Array(
          [...loop.points, loop.points[0]].flatMap((p) => p.p),
        ),
      })),
    };
    return geometry;
  }

  /**
   * Builds a solid ribbon from an explicitly closed contour around the local Y axis.
   *
   * Let A = turns*2π, L = handleHeight-2*endMargin-stripeWidth,
   * R = stripeRadius. createSpiralBezierControlPoints approximates the desired
   * OPEN helix with cubic 3D segments (at most 22.5 degrees each). Trigonometry
   * constructs controls ONLY; evaluateSpiralBezier generates every sample.
   * Boundaries B-(t), B+(t) offset the evaluated Y by -/+ stripeWidth/2.
   * The CLOSED contour traverses B-(0..1), the straight upper-end connector
   * B-(1)..B+(1), B+(1..0), then B+(0)..B-(0). Samples use t=i/(N-1),
   * with an explicit repeated first point at the end. The polynomial Bézier
   * centerline is an approximation, not an exact helix, and is never projected
   * back onto the cylinder. Adjacent control polygons share position/tangent.
   * With softEnds, createStripeEndControls changes only the first/last four
   * cubic polygons: finite width eases from width/3 to the full central width.
   * The upper boundary does not extend closer to the star. The lower margin
   * halves; the upper margin stays unchanged. Both boundary positions/tangents
   * are evaluated from their explicit cubic controls, including wall normals.
   *
   * Radial extrusion scales evaluated XZ by (R-thickness)/R, preserving Y.
   * Thus the inner boundary is also cubic, with the same scaled XZ controls.
   * Nominal thickness has the same very small radial approximation error.
   * Face and wall normals use the actual Bézier derivatives, not helix normals.
   * Oppositely wound outer/inner curved
   * faces plus a quad for EVERY contour edge (including both end connectors)
   * form the CLOSED SURFACE. Wall vertices copy face positions exactly for hard
   * normals; welded positions, not raw index identities, establish closure.
   *
   * @param {object} [options={}] - Dimensions and sampling in engine units and radians.
   * @param {number} [options.handleRadius=0.11] - Radius of the underlying cylinder.
   * @param {number} [options.handleHeight=2.2] - Height of the underlying cylinder.
   * @param {number} [options.stripeRadius=0.115] - Outer ribbon radius, greater than handleRadius.
   * @param {number} [options.stripeWidth=0.18] - Ribbon width along the local Y axis.
   * @param {number} [options.turns=4.5] - Number of helical revolutions.
   * @param {number} [options.sampleCount=121] - Boundary samples, including both endpoints.
   * @param {number} [options.phase=0] - Initial angle in radians, measured from +X toward +Z.
   * @param {number} [options.endMargin=0.08] - Untapered margin; soft lower margin is half this value.
   * @param {boolean} [options.softEnds=false] - Optional finite-width cubic end tapers;
   * keep the upper margin and halve the lower margin, leaving the middle unchanged.
   * @param {boolean} [options.trimToHandle=false] - Extend a constant-width ribbon
   * at the calibrated pitch, clip to the actual handle end planes and rebuild closures.
   * @param {number} [options.thickness] - Positive radial thickness. Defaults to
   * stripeRadius-handleRadius+handleRadius/110 (0.006 at default dimensions),
   * slightly embedding the inner surface without changing the exterior.
   * @returns {Geometry} Closed indexed position/normal/uv mesh; userData.stripeContour
   * stores the sampled closed outer outline, including its repeated endpoint.
   * @throws {TypeError|RangeError} If dimensions, sampling, or derived output are invalid.
   */
  function createStarRodStripeGeometry({
    handleRadius = 0.11,
    handleHeight = 2.2,
    stripeRadius = 0.115,
    stripeWidth = 0.18,
    turns = 4.5,
    sampleCount = 121,
    phase = 0,
    endMargin = 0.08,
    softEnds = false,
    trimToHandle = false,
    thickness = stripeRadius -
      handleRadius +
      handleRadius * HANDLE_EMBED_FRACTION,
  } = {}) {
    if (typeof softEnds !== "boolean")
      throw new TypeError("Star Rod softEnds must be boolean");
    if (typeof trimToHandle !== "boolean")
      throw new TypeError("Star Rod trimToHandle must be boolean");
    if (trimToHandle && softEnds)
      throw new RangeError("Clipped stripes must retain their full width");
    for (const [name, value] of [
      ["handleRadius", handleRadius],
      ["handleHeight", handleHeight],
      ["stripeRadius", stripeRadius],
      ["stripeWidth", stripeWidth],
      ["turns", turns],
      ["thickness", thickness],
    ]) {
      if (typeof value !== "number")
        throw new TypeError(`Star Rod ${name} must be a number`);
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`Star Rod ${name} must be finite and positive`);
      }
    }
    if (typeof phase !== "number" || typeof endMargin !== "number") {
      throw new TypeError("Star Rod phase and endMargin must be numbers");
    }
    if (
      !Number.isFinite(phase) ||
      !Number.isFinite(endMargin) ||
      endMargin < 0
    ) {
      throw new RangeError(
        "Star Rod phase must be finite and endMargin must be finite and non-negative",
      );
    }
    if (softEnds && endMargin === 0)
      throw new RangeError("Soft stripe ends require a positive cream margin");
    if (!Number.isSafeInteger(sampleCount) || sampleCount < 2) {
      throw new RangeError(
        "Star Rod sampleCount must be a safe integer of at least 2",
      );
    }
    if (
      stripeRadius <= handleRadius ||
      Math.fround(stripeRadius) <= Math.fround(handleRadius)
    ) {
      throw new RangeError(
        "Star Rod stripeRadius must remain outside handleRadius in Float32",
      );
    }
    const innerRadius = stripeRadius - thickness;
    if (
      !(innerRadius > 0) ||
      !(Math.fround(innerRadius) > 0) ||
      !(Math.fround(innerRadius) < Math.fround(stripeRadius))
    ) {
      throw new RangeError(
        "Star Rod thickness must leave distinct positive Float32 radii",
      );
    }
    if (
      Math.fround(stripeRadius) > FLOAT32_MAX ||
      !Number.isFinite(Math.fround(handleHeight / 2))
    ) {
      throw new RangeError("Star Rod dimensions must remain finite in Float32");
    }
    const centerTravel = handleHeight - 2 * endMargin - stripeWidth;
    const totalAngle = turns * 2 * Math.PI;
    if (
      !Number.isFinite(centerTravel) ||
      centerTravel <= 0 ||
      !Number.isFinite(totalAngle) ||
      !Number.isFinite(phase + totalAngle) ||
      !Number.isFinite(Math.fround(stripeWidth / 2)) ||
      !Number.isFinite(Math.fround(centerTravel / 2))
    ) {
      throw new RangeError(
        "Star Rod stripe must fit inside a finite Float32 handle",
      );
    }
    if (
      turns >= 1 &&
      !(Math.fround(centerTravel / turns) > Math.fround(stripeWidth))
    ) {
      throw new RangeError(
        "Star Rod stripe turns must have positive separation",
      );
    }
    if (sampleCount - 1 < Math.ceil(turns * SAMPLES_PER_TURN)) {
      throw new RangeError(
        `Star Rod sampleCount requires at least ${SAMPLES_PER_TURN} segments per turn`,
      );
    }
    if (
      softEnds &&
      Math.ceil(turns * BEZIER_SEGMENTS_PER_TURN) < END_TAPER_SEGMENTS * 2 + 1
    ) {
      throw new RangeError(
        "Star Rod end tapers require a separate central region",
      );
    }
    // Two boundaries per radial face; four hard-normal vertices per contour edge.
    const faceVertexCount = sampleCount * 2;
    const contourEdgeCount = sampleCount * 2;
    const vertexCount = sampleCount * 12;
    const indexCount = (sampleCount - 1) * 12 + contourEdgeCount * 6;
    if (
      !Number.isSafeInteger(vertexCount) ||
      !Number.isSafeInteger(indexCount) ||
      vertexCount - 1 > MAX_TYPED_ARRAY_LENGTH ||
      vertexCount * 3 > MAX_TYPED_ARRAY_LENGTH ||
      indexCount > MAX_TYPED_ARRAY_LENGTH
    ) {
      throw new RangeError(
        "Star Rod stripe exceeds typed-array or Uint32 index capacity",
      );
    }

    if (trimToHandle)
      return createTrimmedStripeGeometry({
        handleRadius,
        handleHeight,
        stripeRadius,
        stripeWidth,
        turns,
        sampleCount,
        phase,
        endMargin,
        thickness,
      });
    const contour = new Float32Array((contourEdgeCount + 1) * 3);
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const IndexArray = vertexCount - 1 <= 65535 ? Uint16Array : Uint32Array;
    const indices = new IndexArray(indexCount);
    const halfWidth = stripeWidth / 2;
    const baseSegments = createSpiralBezierControlPoints(
      stripeRadius,
      centerTravel,
      totalAngle,
      phase,
    );
    const endControls = createStripeEndControls(
      baseSegments,
      stripeWidth,
      endMargin,
      softEnds,
    );
    const { segments, boundarySegments } = endControls;
    const point = [0, 0, 0],
      tangent = [0, 0, 0];
    const boundaryPoint = [0, 0, 0],
      boundaryTangent = [0, 0, 0];
    const sampleTangents = new Float64Array(sampleCount * 6);
    const innerRatio = innerRadius / stripeRadius;
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const t = sample / (sampleCount - 1);
      const segmentIndex = Math.min(
        segments.length - 1,
        Math.floor(t * segments.length),
      );
      evaluateSpiralBezier(
        segments[segmentIndex],
        t * segments.length - segmentIndex,
        point,
        tangent,
      );
      const normalLength = Math.hypot(tangent[0], tangent[2]);
      const normalX = tangent[2] / normalLength,
        normalZ = -tangent[0] / normalLength;
      for (let boundary = 0; boundary < 2; boundary += 1) {
        // Explicit contour order: lower ascending, upper descending.
        const contourPoint =
          boundary === 0 ? sample : contourEdgeCount - 1 - sample;
        const vertex = sample * 2 + boundary;
        evaluateSpiralBezier(
          boundarySegments[boundary][segmentIndex],
          t * segments.length - segmentIndex,
          boundaryPoint,
          boundaryTangent,
        );
        sampleTangents.set(boundaryTangent, vertex * 3);
        // Preserve the generic untapered generator's original arithmetic.
        const y = softEnds
          ? boundaryPoint[1]
          : point[1] + (boundary === 0 ? -halfWidth : halfWidth);
        contour.set([boundaryPoint[0], y, boundaryPoint[2]], contourPoint * 3);
        positions.set(
          contour.subarray(contourPoint * 3, contourPoint * 3 + 3),
          vertex * 3,
        );
        positions.set(
          [innerRatio * point[0], y, innerRatio * point[2]],
          (faceVertexCount + vertex) * 3,
        );
        normals.set([normalX, 0, normalZ], vertex * 3);
        normals.set([-normalX, 0, -normalZ], (faceVertexCount + vertex) * 3);
        uvs.set([t, boundary], vertex * 2);
        uvs.set([t, boundary], (faceVertexCount + vertex) * 2);
      }
      const lowerOffset = sample * 6;
      if (!(positions[lowerOffset + 1] < positions[lowerOffset + 4])) {
        throw new RangeError("Star Rod stripe width collapses in Float32");
      }
      if (sample > 0) {
        const previousOffset = lowerOffset - 6;
        const radialCross =
          positions[previousOffset] * positions[lowerOffset + 2] -
          positions[previousOffset + 2] * positions[lowerOffset];
        if (!(radialCross > 0)) {
          throw new RangeError(
            "Star Rod stripe samples collapse or reverse around the handle",
          );
        }
      }
    }
    contour.set(contour.subarray(0, 3), contourEdgeCount * 3);

    let cursor = 0;
    for (let segment = 0; segment < sampleCount - 1; segment += 1) {
      const lower = segment * 2;
      const nextLower = lower + 2;
      // Upward width crossed with increasing-theta tangent points outward.
      indices.set(
        [lower, lower + 1, nextLower, lower + 1, nextLower + 1, nextLower],
        cursor,
      );
      cursor += 6;
      const inner = faceVertexCount + lower,
        nextInner = inner + 2;
      indices.set(
        [inner, nextInner, inner + 1, inner + 1, nextInner, nextInner + 1],
        cursor,
      );
      cursor += 6;
    }
    const faceVertexAtContour = (point) => {
      const wrapped = point === contourEdgeCount ? 0 : point;
      return wrapped < sampleCount
        ? wrapped * 2
        : (contourEdgeCount - 1 - wrapped) * 2 + 1;
    };
    for (let edge = 0; edge < contourEdgeCount; edge += 1) {
      const start = faceVertexAtContour(edge),
        end = faceVertexAtContour(edge + 1);
      const base = faceVertexCount * 2 + edge * 4;
      const isEnd = edge === sampleCount - 1 || edge === contourEdgeCount - 1;
      const direction = edge < sampleCount ? 1 : -1;
      for (let corner = 0; corner < 4; corner += 1) {
        const outerVertex = corner < 2 ? start : end;
        const isOuter = corner % 2 === 1;
        const source = outerVertex + (isOuter ? 0 : faceVertexCount);
        const target = base + corner;
        positions.set(
          positions.subarray(source * 3, source * 3 + 3),
          target * 3,
        );
        const x = positions[outerVertex * 3],
          z = positions[outerVertex * 3 + 2];
        const radialLength = Math.hypot(x, z);
        if (isEnd) {
          // Vertical connector crossed with the radial extrusion.
          normals.set(
            [
              (-direction * z) / radialLength,
              0,
              (direction * x) / radialLength,
            ],
            target * 3,
          );
        } else {
          // Actual radial extrusion vector crossed with cubic tangent.
          const offset = outerVertex * 3,
            ratio = isOuter ? 1 : innerRatio;
          const dx = sampleTangents[offset] * ratio,
            dy = sampleTangents[offset + 1],
            dz = sampleTangents[offset + 2] * ratio;
          const nx = -z * dy,
            ny = z * dx - x * dz,
            nz = x * dy;
          const length = Math.hypot(nx, ny, nz);
          normals.set(
            [
              (direction * nx) / length,
              (direction * ny) / length,
              (direction * nz) / length,
            ],
            target * 3,
          );
        }
        uvs.set(
          [
            corner < 2
              ? edge / contourEdgeCount
              : (edge + 1) / contourEdgeCount,
            isOuter ? 1 : 0,
          ],
          target * 2,
        );
      }
      indices.set(
        [base, base + 1, base + 2, base + 1, base + 3, base + 2],
        cursor,
      );
      cursor += 6;
    }
    for (const attribute of [positions, normals, uvs]) {
      if (!attribute.every(Number.isFinite))
        throw new RangeError("Star Rod stripe generated a non-finite vertex");
    }
    const geometry = new Geometry()
      .setAttribute("position", positions, 3)
      .setAttribute("normal", normals, 3)
      .setAttribute("uv", uvs, 2)
      .setIndices(indices);
    geometry.userData.stripeContour = contour;
    geometry.userData.spiralBezier = {
      segments,
      sampleCount,
      stripeRadius,
      innerRadius,
      stripeWidth,
      centerTravel,
      turns,
      phase,
      endMargin,
      softEnds,
      boundarySegments,
      tipWidth: endControls.tipWidth,
      lowerCenterShift: endControls.lowerShift,
      upperCenterShift: endControls.upperShift,
      taperSegmentCount: softEnds ? END_TAPER_SEGMENTS : 0,
    };
    return geometry;
  }

  return createStarRodStripeGeometry;
})();
export const createStarRodStarGeometry = (() => {
  const POINT_COUNT = 5;
  const ANCHOR_COUNT = POINT_COUNT * 2;
  const CONTROL_HANDLE_FACTOR = 0.08;
  const MAX_FLOAT32 = 3.4028234663852886e38;
  const MAX_TYPED_ARRAY_LENGTH = 4294967295;
  const UINT16_MAX = 65535;
  const UINT32_MAX = 4294967295;
  const SWEEP_TOLERANCE = 1e-5;

  /**
   * Creates a closed, extruded five-point Star Rod head in the local XY plane.
   *
   * Ten alternating outer and inner anchors start at the upward outer point and
   * proceed counter-clockwise. Every anchor-to-anchor edge is an actual cubic
   * Bézier segment. Short, shared tangent handles soften corners while retaining
   * the five-point silhouette. Each segment contributes its start and interior
   * samples but not its endpoint, so the closed face outline has no duplicate
   * terminal sample. Positive angular progression makes the outline star-shaped
   * about the origin; therefore center fans remain inside both faces. The side
   * seam alone duplicates one vertex pair to keep U continuous from 0 to 1.
   *
   * @param {object} [options={}] - Star dimensions and curve sampling.
   * @param {number} [options.outerRadius=0.52] - Radius of the five outer points in engine units.
   * @param {number} [options.innerRadius=0.25] - Radius of the five inner valleys in engine units.
   * @param {number} [options.thickness=0.18] - Total depth along local Z in engine units.
   * @param {number} [options.samplesPerSegment=8] - Samples on each of ten cubic segments, excluding its endpoint.
   * @returns {Geometry} Indexed front, back, and side geometry with position, normal, and uv attributes.
   * @throws {TypeError|RangeError} If dimensions, sampling, or the derived outline cannot form safe geometry.
   */
  function createStarRodStarGeometry({
    outerRadius = 0.52,
    innerRadius = 0.25,
    thickness = 0.18,
    samplesPerSegment = 8,
  } = {}) {
    for (const [name, value] of [
      ["outerRadius", outerRadius],
      ["innerRadius", innerRadius],
      ["thickness", thickness],
    ]) {
      if (typeof value !== "number")
        throw new TypeError(`Star Rod ${name} must be a number`);
      if (
        !Number.isFinite(value) ||
        value <= 0 ||
        value > MAX_FLOAT32 ||
        Math.fround(value) === 0
      ) {
        throw new RangeError(
          `Star Rod ${name} must be positive and representable in Float32`,
        );
      }
    }
    if (innerRadius >= outerRadius) {
      throw new RangeError(
        "Star Rod innerRadius must be smaller than outerRadius",
      );
    }
    if (!Number.isSafeInteger(samplesPerSegment) || samplesPerSegment < 2) {
      throw new RangeError(
        "Star Rod samplesPerSegment must be a safe integer of at least 2",
      );
    }
    const halfThickness = thickness / 2;
    if (!(Math.fround(halfThickness) > 0)) {
      throw new RangeError(
        "Star Rod half-thickness must remain positive in Float32",
      );
    }
    const boundaryCount = ANCHOR_COUNT * samplesPerSegment;
    const faceVertexCount = boundaryCount + 1;
    const vertexCount = 4 * faceVertexCount;
    const indexCount = 12 * boundaryCount;
    if (
      !Number.isSafeInteger(boundaryCount) ||
      !Number.isSafeInteger(vertexCount) ||
      !Number.isSafeInteger(indexCount) ||
      vertexCount - 1 > UINT32_MAX ||
      vertexCount * 3 > MAX_TYPED_ARRAY_LENGTH ||
      indexCount > MAX_TYPED_ARRAY_LENGTH
    ) {
      throw new RangeError(
        "Star Rod star exceeds typed-array or Uint32 index capacity",
      );
    }

    const anchors = new Float64Array(ANCHOR_COUNT * 2);
    for (let anchor = 0; anchor < ANCHOR_COUNT; anchor += 1) {
      const angle = Math.PI / 2 + (anchor * Math.PI) / POINT_COUNT;
      const radius = anchor % 2 === 0 ? outerRadius : innerRadius;
      anchors[anchor * 2] = radius * Math.cos(angle);
      anchors[anchor * 2 + 1] = radius * Math.sin(angle);
    }

    const boundary = new Float32Array(boundaryCount * 2);
    for (let segment = 0; segment < ANCHOR_COUNT; segment += 1) {
      const previous = (segment + ANCHOR_COUNT - 1) % ANCHOR_COUNT;
      const next = (segment + 1) % ANCHOR_COUNT;
      const afterNext = (segment + 2) % ANCHOR_COUNT;
      const p0x = anchors[segment * 2],
        p0y = anchors[segment * 2 + 1];
      const p3x = anchors[next * 2],
        p3y = anchors[next * 2 + 1];
      // Matching tangent handles on adjacent curves give C1 continuity.
      const p1x = p0x + CONTROL_HANDLE_FACTOR * (p3x - anchors[previous * 2]);
      const p1y =
        p0y + CONTROL_HANDLE_FACTOR * (p3y - anchors[previous * 2 + 1]);
      const p2x = p3x - CONTROL_HANDLE_FACTOR * (anchors[afterNext * 2] - p0x);
      const p2y =
        p3y - CONTROL_HANDLE_FACTOR * (anchors[afterNext * 2 + 1] - p0y);
      for (let sample = 0; sample < samplesPerSegment; sample += 1) {
        const t = sample / samplesPerSegment;
        const offset = (segment * samplesPerSegment + sample) * 2;
        boundary[offset] = evaluateCubicBezierComponent(p0x, p1x, p2x, p3x, t);
        boundary[offset + 1] = evaluateCubicBezierComponent(
          p0y,
          p1y,
          p2y,
          p3y,
          t,
        );
        if (
          !Number.isFinite(boundary[offset]) ||
          !Number.isFinite(boundary[offset + 1])
        ) {
          throw new RangeError(
            "Star Rod star generated a non-finite boundary point",
          );
        }
      }
    }

    const sideU = new Float64Array(boundaryCount + 1);
    let perimeter = 0;
    let angularSweep = 0;
    for (let sample = 0; sample < boundaryCount; sample += 1) {
      const current = sample * 2;
      const next = ((sample + 1) % boundaryCount) * 2;
      const x0 = boundary[current],
        y0 = boundary[current + 1];
      const x1 = boundary[next],
        y1 = boundary[next + 1];
      const cross = x0 * y1 - y0 * x1;
      const dot = x0 * x1 + y0 * y1;
      const step = Math.atan2(cross, dot);
      if (!(cross > 0) || !(step > 0 && step < Math.PI)) {
        throw new RangeError(
          "Star Rod star outline must sweep counter-clockwise without collapsed fan triangles",
        );
      }
      angularSweep += step;
      perimeter += Math.hypot(x1 - x0, y1 - y0);
      sideU[sample + 1] = perimeter;
    }
    if (
      !Number.isFinite(perimeter) ||
      perimeter <= 0 ||
      Math.abs(angularSweep - 2 * Math.PI) > SWEEP_TOLERANCE
    ) {
      throw new RangeError(
        "Star Rod star outline must close once around its center",
      );
    }

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const IndexArray =
      vertexCount - 1 <= UINT16_MAX ? Uint16Array : Uint32Array;
    const indices = new IndexArray(indexCount);
    const backCenter = faceVertexCount;
    const sideStart = faceVertexCount * 2;
    positions[2] = halfThickness;
    positions[backCenter * 3 + 2] = -halfThickness;
    normals[2] = 1;
    normals[backCenter * 3 + 2] = -1;
    uvs[0] = 0.5;
    uvs[1] = 0.5;
    uvs[backCenter * 2] = 0.5;
    uvs[backCenter * 2 + 1] = 0.5;

    for (let sample = 0; sample < boundaryCount; sample += 1) {
      const x = boundary[sample * 2],
        y = boundary[sample * 2 + 1];
      const uvX = 0.5 + x / (2 * outerRadius);
      const uvY = 0.5 + y / (2 * outerRadius);
      const front = 1 + sample;
      const back = backCenter + 1 + sample;
      positions[front * 3] = x;
      positions[front * 3 + 1] = y;
      positions[front * 3 + 2] = halfThickness;
      positions[back * 3] = x;
      positions[back * 3 + 1] = y;
      positions[back * 3 + 2] = -halfThickness;
      normals[front * 3 + 2] = 1;
      normals[back * 3 + 2] = -1;
      uvs[front * 2] = uvX;
      uvs[front * 2 + 1] = uvY;
      uvs[back * 2] = uvX;
      uvs[back * 2 + 1] = uvY;
    }

    for (let sample = 0; sample <= boundaryCount; sample += 1) {
      const current = sample % boundaryCount;
      const previous = (current + boundaryCount - 1) % boundaryCount;
      const next = (current + 1) % boundaryCount;
      const tangentX = boundary[next * 2] - boundary[previous * 2];
      const tangentY = boundary[next * 2 + 1] - boundary[previous * 2 + 1];
      const tangentLength = Math.hypot(tangentX, tangentY);
      if (!(tangentLength > 0)) {
        throw new RangeError("Star Rod star side tangent collapsed");
      }
      const normalX = tangentY / tangentLength;
      const normalY = -tangentX / tangentLength;
      const x = boundary[current * 2],
        y = boundary[current * 2 + 1];
      const u = sideU[sample] / perimeter;
      for (let face = 0; face < 2; face += 1) {
        const vertex = sideStart + sample * 2 + face;
        positions[vertex * 3] = x;
        positions[vertex * 3 + 1] = y;
        positions[vertex * 3 + 2] = face === 0 ? halfThickness : -halfThickness;
        normals[vertex * 3] = normalX;
        normals[vertex * 3 + 1] = normalY;
        uvs[vertex * 2] = u;
        uvs[vertex * 2 + 1] = face === 0 ? 1 : 0;
      }
    }

    for (let sample = 0; sample < boundaryCount; sample += 1) {
      const next = (sample + 1) % boundaryCount;
      const offset = sample * 12;
      indices[offset] = 0;
      indices[offset + 1] = 1 + sample;
      indices[offset + 2] = 1 + next;
      indices[offset + 3] = backCenter;
      indices[offset + 4] = backCenter + 1 + next;
      indices[offset + 5] = backCenter + 1 + sample;
      const side = sideStart + sample * 2;
      indices[offset + 6] = side;
      indices[offset + 7] = side + 1;
      indices[offset + 8] = side + 2;
      indices[offset + 9] = side + 1;
      indices[offset + 10] = side + 3;
      indices[offset + 11] = side + 2;
    }

    return new Geometry()
      .setAttribute("position", positions, 3)
      .setAttribute("normal", normals, 3)
      .setAttribute("uv", uvs, 2)
      .setIndices(indices);
  }

  return createStarRodStarGeometry;
})();
const buildKirby = (() => {
  const BODY = Object.freeze({
    // Preserve the 2.60-unit height; correct the mesh itself, not a parent scale.
    radiusX: 1.3,
    radiusY: 1.3,
    radiusZ: 1.28,
    positionY: 0.33,
    widthSegments: 48,
    heightSegments: 32,
  });

  // Orbit each complete attachment around the body's Y axis, away from the
  // +Z face. Rotate its orientation as well, keeping the open rim aimed inward.
  const ARM_REARWARD_ANGLE = 0.18;
  const ARM_REARWARD_COSINE = Math.cos(ARM_REARWARD_ANGLE);
  const ARM_REARWARD_SINE = Math.sin(ARM_REARWARD_ANGLE);
  // The raised branch can face the viewer more directly without moving the
  // relaxed arms toward the cheeks. Orbit the whole hand/grip branch together.
  const HOLD_REARWARD_ANGLE = 0;
  const HOLD_REARWARD_COSINE = Math.cos(HOLD_REARWARD_ANGLE);
  const HOLD_REARWARD_SINE = Math.sin(HOLD_REARWARD_ANGLE);

  const ARM = Object.freeze({
    a: 0.77,
    b: 0.64,
    vMax: 0.9,
    radialSegments: 32,
    heightSegments: 16,
    positionX: 1.73 * ARM_REARWARD_COSINE + 0.24 * ARM_REARWARD_SINE,
    positionY: -0.04,
    positionZ: 0.24 * ARM_REARWARD_COSINE - 1.73 * ARM_REARWARD_SINE,
    yaw: 1.62 - ARM_REARWARD_ANGLE,
    scaleX: 0.92,
    scaleY: 1.02,
    // Extra inward length hides the fuller rim, not the visible rounded tip.
    scaleZ: 1.18,
  });

  // The raised hand, grip, and rod share one forward-facing attachment frame.
  // Reveal more of the raised limb outside the torso. A holding-only axial
  // extension keeps its open shoulder buried through the unchanged hop offsets;
  // it is not inherited by the grip/rod. Neutral inspection restores ARM's scale.
  const HOLD = Object.freeze({
    pivotX: 1.23 * HOLD_REARWARD_COSINE + 0.02 * HOLD_REARWARD_SINE,
    pivotY: 0.7,
    pivotZ: 0.02 * HOLD_REARWARD_COSINE - 1.23 * HOLD_REARWARD_SINE,
    pivotYaw: HOLD_REARWARD_ANGLE,
    armRaise: 0.55,
    armLocalX: 0.55,
    armLocalY: 0,
    armLocalZ: 0.4,
    armYaw: -1.8,
    // Same cross-section and shared mesh; raised axial length is +22.88%.
    armScaleX: ARM.scaleX,
    armScaleY: ARM.scaleY,
    armScaleZ: 1.45,
    // Shallow back-of-shaft support. The final shared-pose pass carries the
    // hand and grip together about the concealed shoulder, so the original
    // rod-only flourish cannot sweep a long shaft section through the palm.
    gripX: 0.22,
    gripY: 0,
    // A 0.001-unit local clearance adjustment preserves shallow support
    // through the more visible 12% hop stretch without changing the hand.
    gripZ: 0.724,
    // Combined with the raised pivot, the shaft leans inward above Kirby.
    rodTilt: 0,
  });

  const ROD = Object.freeze({
    radius: 0.11,
    height: 2.0,
    radialSegments: 32,
    heightSegments: 1,
    // Local Y offset of the cylinder center from the rotated rod root.
    centerAboveGrip: 0.65,
  });

  const ROD_STRIPE = Object.freeze({
    stripeRadius: ROD.radius + 0.005,
    stripeWidth: 0.18,
    turns: 5,
    sampleCount: 121,
    phase: 0,
    trimToHandle: true,
    endMargin: 0.08,
  });

  const ROD_STAR = Object.freeze({
    outerRadius: 0.52,
    innerRadius: 0.25,
    thickness: 0.18,
    samplesPerSegment: 8,
    attachmentOverlap: 0.06,
  });

  const FOOT = Object.freeze({
    radiusX: 0.6,
    radiusY: 0.34,
    radiusZ: 0.68,
    widthSegments: 32,
    heightSegments: 16,
    positionX: 0.58,
    positionY: -1.08,
    positionZ: 0.33,
    splayAngle: 0.14,
  });

  const FACE_GEOMETRY = Object.freeze({
    radius: 1,
    widthSegments: 32,
    heightSegments: 20,
  });

  const EYE = Object.freeze({
    positionX: 0.34,
    positionY: 0.44,
    radiusX: 0.17,
    radiusY: 0.38,
    radiusZ: 0.16,
    surfaceOffset: 0.095,
    pitch: -0.3,
    yaw: 0.22,
  });

  const PUPIL = Object.freeze({
    positionYOffset: -0.09,
    positionZOffset: 0.09,
    radiusX: 0.13,
    radiusY: 0.23,
    radiusZ: 0.08,
  });

  const HIGHLIGHT = Object.freeze({
    positionXOffset: -0.045,
    positionYOffset: 0.18,
    positionZOffset: 0.112,
    radiusX: 0.05,
    radiusY: 0.075,
    radiusZ: 0.044,
  });

  const CHEEK = Object.freeze({
    positionX: 0.73,
    positionY: 0,
    radiusX: 0.22,
    radiusY: 0.115,
    radiusZ: 0.065,
    surfaceOffset: 0.04,
    pitch: 0,
    yaw: 0.6,
  });

  function frontSurfaceZ(x, y) {
    const xFraction = x / BODY.radiusX;
    const yFraction = y / BODY.radiusY;
    return (
      BODY.radiusZ *
      Math.sqrt(1 - xFraction * xFraction - yFraction * yFraction)
    );
  }

  function createFacialNode(
    gl,
    name,
    geometry,
    material,
    x,
    y,
    z,
    radiusX,
    radiusY,
    radiusZ,
    pitch = 0,
    yaw = 0,
  ) {
    const node = new Node({
      name,
      mesh: new Mesh(gl, geometry, material, { name: `Kirby ${name}` }),
    });
    node.transform
      .setPosition(x, y, z)
      .setRotationFromEuler(pitch, yaw, 0)
      .setScale(radiusX, radiusY, radiusZ);
    return node;
  }

  /**
   * Builds Kirby's static body, face, limbs, and complete Star Rod.
   *
   * The camera views the positive-Z side of the body, so face centers follow
   * its ellipsoid front surface. Each feature intersects the body or its eye
   * surface slightly to avoid floating or coincident-surface flicker.
   *
   * The supplied materials remain owned by the caller. The returned geometries
   * and meshes are application-owned resources; Nodes retain meshes by reference.
   * Each part has its own Node and Transform; facial features are children of
   * the body so body and root movement carry them along. Mirrored facial parts
   * share one unit ellipsoid geometry and one material per feature type. The
   * handle, ribbon, and star head hang from an unscaled grip anchor beside the
   * right arm mesh. The star anchor sits at the cylinder's actual upper end.
   *
   * @param {Material} pinkMaterial - Shared body and arm material.
   * @param {Material} redMaterial - Shared foot material.
   * @param {{eye: Material, pupil: Material, highlight: Material, cheek: Material, mouth: Material, tongue: Material}} facialMaterials - Caller-owned facial materials.
   * @param {Material} rodMaterial - Caller-owned pale handle material.
   * @param {Material} stripeMaterial - Caller-owned pink/red ribbon material.
   * @param {Material} starMaterial - Caller-owned golden star-head material.
   * @returns {{root: Node, parts: {body: Node, leftArmPivot: Node, leftArm: Node, rightArmPivot: Node, rightArm: Node, gripAnchor: Node, starRodRoot: Node, rodHandle: Node, rodStripe: Node, starHeadAnchor: Node, starHead: Node, leftFoot: Node, rightFoot: Node, leftEye: Node, rightEye: Node, leftPupil: Node, rightPupil: Node, leftHighlight: Node, rightHighlight: Node, leftCheek: Node, rightCheek: Node, mouth: Node, mouthEdge: Node, mouthWalls: Node, mouthInterior: Node, tongue: Node}, resources: {geometries: Geometry[], meshes: Mesh[]}}} The hierarchy and application-owned resources.
   */
  function buildKirby(
    gl,
    pinkMaterial,
    redMaterial,
    facialMaterials,
    rodMaterial,
    stripeMaterial,
    starMaterial,
  ) {
    const mouthGeometries = createKirbyMouthGeometry(BODY);
    const bodyGeometry = mouthGeometries.bodyGeometry;
    const armGeometry = new EllipticParaboloidGeometry(
      ARM.a,
      ARM.b,
      ARM.vMax,
      ARM.radialSegments,
      ARM.heightSegments,
    );
    const footGeometry = new EllipsoidGeometry(
      FOOT.radiusX,
      FOOT.radiusY,
      FOOT.radiusZ,
      FOOT.widthSegments,
      FOOT.heightSegments,
    );
    const faceGeometry = new EllipsoidGeometry(
      FACE_GEOMETRY.radius,
      FACE_GEOMETRY.radius,
      FACE_GEOMETRY.radius,
      FACE_GEOMETRY.widthSegments,
      FACE_GEOMETRY.heightSegments,
    );
    const rodGeometry = new CylinderGeometry(
      ROD.radius,
      ROD.radius,
      ROD.height,
      ROD.radialSegments,
      ROD.heightSegments,
      false,
    );
    const stripeGeometry = createStarRodStripeGeometry({
      handleRadius: ROD.radius,
      handleHeight: ROD.height,
      ...ROD_STRIPE,
    });
    const starGeometry = createStarRodStarGeometry(ROD_STAR);

    const bodyMesh = new Mesh(gl, bodyGeometry, pinkMaterial, {
      name: "Kirby body",
    });
    const leftArmMesh = new Mesh(gl, armGeometry, pinkMaterial, {
      name: "Kirby left arm",
    });
    const rightArmMesh = new Mesh(gl, armGeometry, pinkMaterial, {
      name: "Kirby right arm",
    });
    const leftFootMesh = new Mesh(gl, footGeometry, redMaterial, {
      name: "Kirby left foot",
    });
    const rightFootMesh = new Mesh(gl, footGeometry, redMaterial, {
      name: "Kirby right foot",
    });
    const rodMesh = new Mesh(gl, rodGeometry, rodMaterial, {
      name: "Star Rod handle",
    });
    const stripeMesh = new Mesh(gl, stripeGeometry, stripeMaterial, {
      name: "Star Rod helical stripe",
    });
    const starMesh = new Mesh(gl, starGeometry, starMaterial, {
      name: "Star Rod five-pointed head",
    });

    const root = new Node({ name: "kirbyRoot" });
    const body = new Node({ name: "body", mesh: bodyMesh });
    const leftArm = new Node({ name: "leftArm", mesh: leftArmMesh });
    const leftArmPivot = new Node({ name: "leftArmPivot" });
    const rightArm = new Node({ name: "rightArm", mesh: rightArmMesh });
    const rightArmPivot = new Node({ name: "rightArmPivot" });
    const gripAnchor = new Node({ name: "gripAnchor" });
    const rodScaleCompensation = new Node({ name: "rodScaleCompensation" });
    const starRodRoot = new Node({ name: "starRodRoot" });
    const rodHandle = new Node({ name: "rodHandle", mesh: rodMesh });
    const rodStripe = new Node({ name: "rodStripe", mesh: stripeMesh });
    const starHeadAnchor = new Node({ name: "starHeadAnchor" });
    const starHead = new Node({ name: "starHead", mesh: starMesh });
    const leftFoot = new Node({ name: "leftFoot", mesh: leftFootMesh });
    const rightFoot = new Node({ name: "rightFoot", mesh: rightFootMesh });

    const eyeZ =
      frontSurfaceZ(EYE.positionX, EYE.positionY) -
      EYE.radiusZ +
      EYE.surfaceOffset;
    const cheekZ =
      frontSurfaceZ(CHEEK.positionX, CHEEK.positionY) -
      CHEEK.radiusZ +
      CHEEK.surfaceOffset;
    const leftEye = createFacialNode(
      gl,
      "leftEye",
      faceGeometry,
      facialMaterials.eye,
      -EYE.positionX,
      EYE.positionY,
      eyeZ,
      EYE.radiusX,
      EYE.radiusY,
      EYE.radiusZ,
      EYE.pitch,
      -EYE.yaw,
    );
    const rightEye = createFacialNode(
      gl,
      "rightEye",
      faceGeometry,
      facialMaterials.eye,
      EYE.positionX,
      EYE.positionY,
      eyeZ,
      EYE.radiusX,
      EYE.radiusY,
      EYE.radiusZ,
      EYE.pitch,
      EYE.yaw,
    );
    // Details remain siblings for the blink API, but their centers are authored
    // in the rotated eye frame. Their backs intersect the black ellipsoid;
    // only shallow blue/white curved caps emerge from its surface.
    const createEyeDetail = (name, eye, dimensions, material) => {
      eye.transform.updateLocalMatrix();
      const matrix = eye.transform.localMatrix.elements;
      const x = (dimensions.positionXOffset ?? 0) / EYE.radiusX;
      const y = dimensions.positionYOffset / EYE.radiusY;
      const z = dimensions.positionZOffset / EYE.radiusZ;
      const node = createFacialNode(
        gl,
        name,
        faceGeometry,
        material,
        matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
        dimensions.radiusX,
        dimensions.radiusY,
        dimensions.radiusZ,
      );
      node.transform.rotation.copy(eye.transform.rotation);
      return node;
    };
    const leftPupil = createEyeDetail(
      "leftPupil",
      leftEye,
      PUPIL,
      facialMaterials.pupil,
    );
    const rightPupil = createEyeDetail(
      "rightPupil",
      rightEye,
      PUPIL,
      facialMaterials.pupil,
    );
    const leftHighlight = createEyeDetail(
      "leftHighlight",
      leftEye,
      HIGHLIGHT,
      facialMaterials.highlight,
    );
    const rightHighlight = createEyeDetail(
      "rightHighlight",
      rightEye,
      HIGHLIGHT,
      facialMaterials.highlight,
    );
    const leftCheek = createFacialNode(
      gl,
      "leftCheek",
      faceGeometry,
      facialMaterials.cheek,
      -CHEEK.positionX,
      CHEEK.positionY,
      cheekZ,
      CHEEK.radiusX,
      CHEEK.radiusY,
      CHEEK.radiusZ,
      CHEEK.pitch,
      -CHEEK.yaw,
    );
    const rightCheek = createFacialNode(
      gl,
      "rightCheek",
      faceGeometry,
      facialMaterials.cheek,
      CHEEK.positionX,
      CHEEK.positionY,
      cheekZ,
      CHEEK.radiusX,
      CHEEK.radiusY,
      CHEEK.radiusZ,
      CHEEK.pitch,
      CHEEK.yaw,
    );
    const mouth = new Node({ name: "mouth" });
    const mouthEdge = new Node({
      name: "mouthEdge",
      mesh: new Mesh(gl, mouthGeometries.edgeGeometry, pinkMaterial, {
        name: "Kirby rounded smile edge",
      }),
    });
    const mouthWalls = new Node({
      name: "mouthWalls",
      mesh: new Mesh(gl, mouthGeometries.wallGeometry, facialMaterials.mouth, {
        name: "Kirby mouth interior walls",
      }),
    });
    const mouthInterior = new Node({
      name: "mouthInterior",
      mesh: new Mesh(
        gl,
        mouthGeometries.interiorGeometry,
        facialMaterials.mouth,
        { name: "Kirby recessed mouth bowl" },
      ),
    });
    const tongue = new Node({
      name: "tongue",
      mesh: new Mesh(
        gl,
        mouthGeometries.tongueGeometry,
        facialMaterials.tongue,
        { name: "Kirby curved solid tongue" },
      ),
    });

    body.transform.setPosition(0, BODY.positionY, 0);

    // The +Z opening of each paraboloid points inward; its rim intersects the body.
    leftArm.transform
      .setPosition(-ARM.positionX, ARM.positionY, ARM.positionZ)
      .setRotationFromEuler(0, ARM.yaw, 0)
      .setScale(ARM.scaleX, ARM.scaleY, ARM.scaleZ);
    rightArm.transform
      .setPosition(HOLD.armLocalX, HOLD.armLocalY, HOLD.armLocalZ)
      .setRotationFromEuler(0, HOLD.armYaw, 0)
      .setScale(HOLD.armScaleX, HOLD.armScaleY, HOLD.armScaleZ);
    rightArmPivot.transform
      .setPosition(HOLD.pivotX, HOLD.pivotY, HOLD.pivotZ)
      .setRotationFromEuler(0, HOLD.pivotYaw, HOLD.armRaise, "YXZ");
    gripAnchor.transform.setPosition(HOLD.gripX, HOLD.gripY, HOLD.gripZ);
    starRodRoot.transform.setRotationFromEuler(0, 0, HOLD.rodTilt);
    rodHandle.transform.setPosition(0, ROD.centerAboveGrip, 0);
    rodStripe.transform.setPosition(0, ROD.centerAboveGrip, 0);
    starHeadAnchor.transform.setPosition(
      0,
      ROD.centerAboveGrip + ROD.height / 2,
      0,
    );
    // The centered bottom valley enters the handle by attachmentOverlap.
    starHead.transform.setPosition(
      0,
      ROD_STAR.innerRadius - ROD_STAR.attachmentOverlap,
      0,
    );

    leftFoot.transform
      .setPosition(-FOOT.positionX, FOOT.positionY, FOOT.positionZ)
      .setRotationFromEuler(0, 0, FOOT.splayAngle);
    rightFoot.transform
      .setPosition(FOOT.positionX, FOOT.positionY, FOOT.positionZ)
      .setRotationFromEuler(0, 0, -FOOT.splayAngle);

    body.addChild(leftEye);
    body.addChild(rightEye);
    body.addChild(leftPupil);
    body.addChild(rightPupil);
    body.addChild(leftHighlight);
    body.addChild(rightHighlight);
    body.addChild(leftCheek);
    body.addChild(rightCheek);
    body.addChild(mouth);
    mouth.addChild(mouthEdge);
    mouth.addChild(mouthWalls);
    mouth.addChild(mouthInterior);
    mouth.addChild(tongue);

    root.addChild(body);
    root.addChild(leftArmPivot);
    leftArmPivot.addChild(leftArm);
    root.addChild(rightArmPivot);
    rightArmPivot.addChild(rightArm);
    rightArmPivot.addChild(gripAnchor);
    gripAnchor.addChild(rodScaleCompensation);
    rodScaleCompensation.addChild(starRodRoot);
    starRodRoot.addChild(rodHandle);
    starRodRoot.addChild(rodStripe);
    starRodRoot.addChild(starHeadAnchor);
    starHeadAnchor.addChild(starHead);
    root.addChild(leftFoot);
    root.addChild(rightFoot);

    return {
      root,
      parts: {
        body,
        leftArmPivot,
        leftArm,
        rightArmPivot,
        rightArm,
        gripAnchor,
        rodScaleCompensation,
        starRodRoot,
        rodHandle,
        rodStripe,
        starHeadAnchor,
        starHead,
        leftFoot,
        rightFoot,
        leftEye,
        rightEye,
        leftPupil,
        rightPupil,
        leftHighlight,
        rightHighlight,
        leftCheek,
        rightCheek,
        mouth,
        mouthEdge,
        mouthWalls,
        mouthInterior,
        tongue,
      },
      resources: {
        geometries: [
          bodyGeometry,
          armGeometry,
          footGeometry,
          faceGeometry,
          mouthGeometries.edgeGeometry,
          mouthGeometries.wallGeometry,
          mouthGeometries.interiorGeometry,
          mouthGeometries.tongueGeometry,
          rodGeometry,
          stripeGeometry,
          starGeometry,
        ],
        meshes: [
          bodyMesh,
          leftArmMesh,
          rightArmMesh,
          leftFootMesh,
          rightFootMesh,
          leftEye.mesh,
          rightEye.mesh,
          leftPupil.mesh,
          rightPupil.mesh,
          leftHighlight.mesh,
          rightHighlight.mesh,
          leftCheek.mesh,
          rightCheek.mesh,
          mouthEdge.mesh,
          mouthWalls.mesh,
          mouthInterior.mesh,
          tongue.mesh,
          rodMesh,
          stripeMesh,
          starMesh,
        ],
      },
    };
  }

  return buildKirby;
})();

// Fixed application clip data; construction happens once, never per frame.
const createKirbyReadyClip = (() => {
  const DURATION = 2.8;
  const INTERVAL_COUNT = 24;
  const BOB_HEIGHT = 0.07;
  const BODY_VERTICAL_CHANGE = 0.018;
  const BODY_HORIZONTAL_CHANGE = 0.009;
  const ROOT_SWAY_ANGLE = (2 * Math.PI) / 180;
  const ARM_SWAY_ANGLE = (1.5 * Math.PI) / 180;
  const ROD_FLOURISH_ANGLE = (6 * Math.PI) / 180;
  const Z_AXIS = Object.freeze({ x: 0, y: 0, z: 1 });

  /**
   * Creates one reusable-data clip for Kirby's restrained Star Rod ready idle.
   *
   * All keyframes contain relative local offsets, scale factors, or quaternion
   * deltas, so an Animator can preserve the authored static pose. Twenty-four
   * equal intervals approximate smooth periodic functions over 2.8 seconds;
   * the final sample explicitly matches the first to close the loop. The body
   * breathes independently of limbs and rod, while the right-arm pivot carries
   * hand and rod together. A further six-degree flourish uses a normalized
   * non-cardinal (1, 0.35, 0.6) local axis on the rod root.
   *
   * @returns {AnimationClip} The application-specific five-track idle clip.
   */
  function createKirbyReadyClip() {
    const bob = [];
    const rootSway = [];
    const bodyBreath = [];
    const armSway = [];
    const rodFlourish = [];
    const flourishAxis = new Vector3(1, 0.35, 0.6).normalize();

    for (let sample = 0; sample <= INTERVAL_COUNT; sample += 1) {
      const time =
        sample === INTERVAL_COUNT
          ? DURATION
          : (DURATION * sample) / INTERVAL_COUNT;
      const phase = (sample * 2 * Math.PI) / INTERVAL_COUNT;
      const wave =
        sample === 0 || sample === INTERVAL_COUNT ? 0 : Math.sin(phase);
      const height =
        sample === 0 || sample === INTERVAL_COUNT
          ? 0
          : (BOB_HEIGHT * (1 - Math.cos(phase))) / 2;
      bob.push(
        new Keyframe({ time, valueType: "vector3", value: [0, height, 0] }),
      );
      rootSway.push(
        new Keyframe({
          time,
          valueType: "quaternion",
          interpolation: "slerp",
          value: new Quaternion().setFromAxisAngle(
            Z_AXIS,
            ROOT_SWAY_ANGLE * wave,
          ),
        }),
      );
      bodyBreath.push(
        new Keyframe({
          time,
          valueType: "vector3",
          value: [
            1 - BODY_HORIZONTAL_CHANGE * wave,
            1 + BODY_VERTICAL_CHANGE * wave,
            1 - BODY_HORIZONTAL_CHANGE * wave,
          ],
        }),
      );
      armSway.push(
        new Keyframe({
          time,
          valueType: "quaternion",
          interpolation: "slerp",
          value: new Quaternion().setFromAxisAngle(
            Z_AXIS,
            ARM_SWAY_ANGLE * wave,
          ),
        }),
      );
      rodFlourish.push(
        new Keyframe({
          time,
          valueType: "quaternion",
          interpolation: "slerp",
          value: new Quaternion().setFromAxisAngle(
            flourishAxis,
            ROD_FLOURISH_ANGLE * wave,
          ),
        }),
      );
    }

    return new AnimationClip({
      name: "Kirby Star Rod ready idle",
      duration: DURATION,
      tracks: [
        {
          name: "character-bob",
          target: "animationRoot",
          property: "position",
          keyframes: bob,
        },
        {
          name: "character-sway",
          target: "animationRoot",
          property: "rotation",
          keyframes: rootSway,
        },
        {
          name: "body-breath",
          target: "body",
          property: "scale",
          keyframes: bodyBreath,
        },
        {
          name: "holding-arm-sway",
          target: "rightArmPivot",
          property: "rotation",
          keyframes: armSway,
        },
        {
          name: "rod-axis-flourish",
          target: "starRodRoot",
          property: "rotation",
          keyframes: rodFlourish,
        },
      ],
    });
  }

  return createKirbyReadyClip;
})();
const createKirbyBlinkClip = (() => {
  const DURATION = 4.8;
  const BLINK_START = 4.2;
  const CLOSED_START = 4.36;
  const CLOSED_END = 4.46;
  const BLINK_END = 4.62;
  const OPEN_SCALE = Object.freeze([1, 1, 1]);
  const CLOSED_EYE_SCALE = Object.freeze([1, 0.1, 1]);
  const CLOSED_DETAIL_SCALE = Object.freeze([0.2, 0.08, 0.2]);
  const ZERO_OFFSET = Object.freeze([0, 0, 0]);

  function createBlinkKeyframes(valueType, openValue, closedValue) {
    return [
      new Keyframe({ time: 0, valueType, value: openValue }),
      new Keyframe({ time: BLINK_START, valueType, value: openValue }),
      new Keyframe({ time: CLOSED_START, valueType, value: closedValue }),
      new Keyframe({ time: CLOSED_END, valueType, value: closedValue }),
      new Keyframe({ time: BLINK_END, valueType, value: openValue }),
      new Keyframe({ time: DURATION, valueType, value: openValue }),
    ];
  }

  function centerOffset(node, eye) {
    return [
      eye.transform.position.x - node.transform.position.x,
      eye.transform.position.y - node.transform.position.y,
      eye.transform.position.z - node.transform.position.z,
    ];
  }

  /**
   * Creates Kirby's brief, application-specific synchronized eye blink.
   *
   * Eyes flatten to a positive scale while their sibling pupil and highlight
   * nodes shrink and move into the corresponding eye center. This keeps the
   * colored details behind the closed eye instead of leaving them floating at
   * their separately authored positions. The final open samples exactly match
   * the first samples so looping restores the authored pose without a jump.
   *
   * @param {{leftEye: object, rightEye: object, leftPupil: object, rightPupil: object, leftHighlight: object, rightHighlight: object}} parts - Kirby's authored facial Nodes.
   * @returns {AnimationClip} The application-owned blink clip.
   */
  function createKirbyBlinkClip(parts) {
    const tracks = [];
    const sides = ["left", "right"];

    for (const side of sides) {
      const eye = parts[`${side}Eye`];
      const pupil = parts[`${side}Pupil`];
      const highlight = parts[`${side}Highlight`];

      tracks.push({
        name: `${side}-eye-blink-scale`,
        target: `${side}Eye`,
        property: "scale",
        keyframes: createBlinkKeyframes(
          "vector3",
          OPEN_SCALE,
          CLOSED_EYE_SCALE,
        ),
      });
      tracks.push({
        name: `${side}-pupil-blink-scale`,
        target: `${side}Pupil`,
        property: "scale",
        keyframes: createBlinkKeyframes(
          "vector3",
          OPEN_SCALE,
          CLOSED_DETAIL_SCALE,
        ),
      });
      tracks.push({
        name: `${side}-pupil-blink-position`,
        target: `${side}Pupil`,
        property: "position",
        keyframes: createBlinkKeyframes(
          "vector3",
          ZERO_OFFSET,
          centerOffset(pupil, eye),
        ),
      });
      tracks.push({
        name: `${side}-highlight-blink-scale`,
        target: `${side}Highlight`,
        property: "scale",
        keyframes: createBlinkKeyframes(
          "vector3",
          OPEN_SCALE,
          CLOSED_DETAIL_SCALE,
        ),
      });
      tracks.push({
        name: `${side}-highlight-blink-position`,
        target: `${side}Highlight`,
        property: "position",
        keyframes: createBlinkKeyframes(
          "vector3",
          ZERO_OFFSET,
          centerOffset(highlight, eye),
        ),
      });
    }

    return new AnimationClip({
      name: "Kirby synchronized eye blink",
      duration: DURATION,
      tracks,
    });
  }

  return createKirbyBlinkClip;
})();
const createKirbyStarRodIdleGestureClip = (() => {
  const DURATION = 3;
  const SAMPLE_TIMES = Object.freeze([
    0,
    0.5,
    1,
    1.35,
    1.65,
    2.15,
    2.65,
    DURATION,
  ]);
  const ARM_OFFSETS = Object.freeze([
    [0, 0, 0],
    [0.015, 0.05, 0],
    [0.045, 0.13, 0.005],
    [0.06, 0.18, 0.01],
    [0.06, 0.18, 0.01],
    [0.045, 0.14, 0.008],
    [0.015, 0.05, 0],
    [0, 0, 0],
  ]);
  // A readable diagonal salute: smooth outward sweep, brief peak, then return.
  const ROD_SWEEP_DEGREES = Object.freeze([0, 0, 18, 40, 40, 18, 0, 0]);

  /**
   * Creates Kirby's occasional grounded Star Rod holding-arm gesture.
   *
   * The clip uses the same position and rotation properties as the hop action,
   * so the application controller must keep their two non-looping Animators
   * mutually exclusive. The continuous ready idle remains compatible because it
   * owns rightArmPivot.rotation and starRodRoot.rotation instead. Neutral first
   * and final samples restore the authored holding pose exactly.
   *
   * @returns {AnimationClip} The application-owned non-looping idle gesture.
   */
  function createKirbyStarRodIdleGestureClip() {
    const sweepAxis = new Vector3(0.4, 0.7, 0.85).normalize();
    const sweepRotations = ROD_SWEEP_DEGREES.map((degrees) =>
      new Quaternion().setFromAxisAngle(sweepAxis, (degrees * Math.PI) / 180),
    );

    return new AnimationClip({
      name: "Kirby grounded Star Rod gesture",
      duration: DURATION,
      tracks: [
        {
          name: "idle-gesture-holding-arm-lift",
          target: "rightArmPivot",
          property: "position",
          keyframes: SAMPLE_TIMES.map(
            (time, index) =>
              new Keyframe({
                time,
                valueType: "vector3",
                value: ARM_OFFSETS[index],
              }),
          ),
        },
        {
          name: "idle-gesture-rod-sweep",
          target: "gripAnchor",
          property: "rotation",
          keyframes: SAMPLE_TIMES.map(
            (time, index) =>
              new Keyframe({
                time,
                valueType: "quaternion",
                interpolation: "slerp",
                value: sweepRotations[index],
              }),
          ),
        },
      ],
    });
  }

  return createKirbyStarRodIdleGestureClip;
})();
/** Hop-local event anchors and deformation; arm/rod key times stay independent of height evaluation. */
export const KIRBY_HOP = Object.freeze({
  duration: 3.4,
  times: Object.freeze([
    0, 0.25, 0.55, 0.85, 1.2, 1.6, 2.05, 2.25, 2.55, 2.9, 3.4,
  ]),
  heights: Object.freeze([0, 0, 0, 0.28, 0.55, 0.42, 0.1, 0, 0, 0, 0]),
  // Endpoint velocities per height interval (units/second). Monotone Hermite
  // segments preserve every anchor without overshoot. Landing at 2.25s
  // intentionally changes velocity from -0.40 to 0: a contact impulse, not C1.
  // Preparation and landing each include a 0.30-second readable squash hold.
  heightVelocities: Object.freeze(
    [
      [0, 0],
      [0, 0],
      [0, 0.9],
      [0.9, 0],
      [0, -0.65],
      [-0.65, -0.65],
      [-0.65, -0.4],
      [0, 0],
      [0, 0],
      [0, 0],
    ].map((pair) => Object.freeze(pair)),
  ),
  verticalScales: Object.freeze([
    1, 0.85, 0.85, 1.12, 1.06, 1.02, 0.98, 0.85, 0.85, 0.96, 1,
  ]),
  scaleIntervals: 8,
});

// Kirby maju pada arah +Z lokal, lalu kembali. Posisi tidak bergeser saat menapak.
export const KIRBY_HOP_TRAVEL = Object.freeze({
  distance: 0.8,
  pauseDuration: 0.45,
  liftOff: 0.55,
  landing: 2.25,
});

export function evaluateKirbyHopTravel(time) {
  if (!Number.isFinite(time) || time < 0) {
    throw new RangeError("Invalid hop sequence time");
  }

  const settings = KIRBY_HOP_TRAVEL;
  const returnStart = KIRBY_HOP.duration + settings.pauseDuration;
  let localTime = time;
  let returning = false;

  // Setelah hop pertama selesai, tunggu jeda sebelum mulai hop mundur.
  if (time > KIRBY_HOP.duration) {
    returning = true;
    localTime = Math.max(0, time - returnStart);
  }

  const flightDuration = settings.landing - settings.liftOff;
  let progress = (localTime - settings.liftOff) / flightDuration;
  progress = Math.max(0, Math.min(1, progress));
  progress = smoothStep(progress);

  if (returning) {
    return settings.distance * (1 - progress);
  }
  return settings.distance * progress;
}

/** Evaluate the exact hop-specific piecewise cubic Hermite clearance.
 * Preparation/final recovery are grounded; only the intentional landing has a
 * velocity discontinuity. No sample table, allocations or global interpolation
 * changes are involved. Playback and actual-sole correction share this value.
 * @param {number} time Non-negative hop-local seconds. @returns {number} Foot clearance. */
export function evaluateKirbyHopHeight(time) {
  if (!Number.isFinite(time) || time < 0)
    throw new RangeError("Invalid hop time");
  const { times, heights, heightVelocities, duration } = KIRBY_HOP;
  if (time >= duration) return 0;
  let i = 0;
  while (i + 1 < times.length && times[i + 1] <= time) i++;
  const span = times[i + 1] - times[i],
    u = (time - times[i]) / span;
  const delta = heights[i + 1] - heights[i],
    m0 = heightVelocities[i][0] * span,
    m1 = heightVelocities[i][1] * span;
  // Horner form of h00*y0 + h10*span*v0 + h01*y1 + h11*span*v1.
  const height =
    heights[i] +
    u * (m0 + u * (3 * delta - 2 * m0 - m1 + u * (-2 * delta + m0 + m1)));
  // Guard only floating-point roundoff at monotone interval endpoints (for
  // example -7e-18 near final contact), not an overshooting spline shape.
  return Math.max(
    Math.min(heights[i], heights[i + 1]),
    Math.min(Math.max(heights[i], heights[i + 1]), height),
  );
}
const createKirbyStarRodActionClip = (() => {
  const DURATION = KIRBY_HOP.duration;
  const SAMPLE_TIMES = KIRBY_HOP.times;
  const ARM_OFFSETS = Object.freeze([
    [0, 0, 0],
    [0, 0, 0],
    [0.01, 0, 0],
    [0.04, 0.12, 0],
    [0.08, 0.25, 0.01],
    [0.1, 0.28, 0.02],
    [0.07, 0.18, 0.01],
    [0.03, 0.06, 0],
    [0.03, 0.06, 0],
    [0.01, 0.018, 0],
    [0, 0, 0],
  ]);
  const ROD_FLOURISH_DEGREES = Object.freeze([
    0, 0, -4, -14, 28, 50, 18, -9, -9, 3, 0,
  ]);

  function createVectorKeyframes(values) {
    return SAMPLE_TIMES.map(
      (time, index) =>
        new Keyframe({
          time,
          valueType: "vector3",
          value: values[index],
        }),
    );
  }

  /**
   * Creates Kirby's short, non-looping application-specific Star Rod action.
   *
   * The actionRoot supplies a hop and gentle squash-and-stretch without writing
   * the ready idle's animationRoot properties. Raising rightArmPivot through a
   * outward-and-upward relative position offset carries the arm, grip, and
   * complete rod hierarchy. The gripAnchor rotates the rod around normalized
   * local axis (0.55, 0.8, 0.65), whose stronger local-Z component makes the
   * controlled sweep legible from the normal front view while retaining a
   * non-cardinal three-dimensional flourish, leaving the idle's starRodRoot
   * rotation free of competing writes. Every last
   * keyframe is neutral so the authored ready pose is recovered exactly.
   *
   * @returns {AnimationClip} The application-owned non-looping action clip.
   */
  function createKirbyStarRodActionClip() {
    const flourishAxis = new Vector3(0.55, 0.8, 0.65).normalize();
    const flourishRotations = ROD_FLOURISH_DEGREES.map((degrees) =>
      new Quaternion().setFromAxisAngle(
        flourishAxis,
        (degrees * Math.PI) / 180,
      ),
    );
    const scales = [];
    for (let interval = 0; interval < SAMPLE_TIMES.length - 1; interval++) {
      for (let sample = 0; sample < KIRBY_HOP.scaleIntervals; sample++) {
        const progress = sample / KIRBY_HOP.scaleIntervals;
        const vertical =
          KIRBY_HOP.verticalScales[interval] +
          smoothStep(progress) *
            (KIRBY_HOP.verticalScales[interval + 1] -
              KIRBY_HOP.verticalScales[interval]);
        const horizontal = 1 / Math.sqrt(vertical);
        scales.push(
          new Keyframe({
            time:
              SAMPLE_TIMES[interval] +
              progress * (SAMPLE_TIMES[interval + 1] - SAMPLE_TIMES[interval]),
            value: [horizontal, vertical, horizontal],
          }),
        );
      }
    }
    scales.push(new Keyframe({ time: DURATION, value: [1, 1, 1] }));

    return new AnimationClip({
      name: "Kirby Star Rod hop action",
      duration: DURATION,
      tracks: [
        {
          // This binding retains authored restoration on stop/restart.
          // KirbyHopPose alone supplies analytic height after sampling
          // the unchanged scale, arm and rod tracks.
          name: "action-hop-base",
          target: "actionRoot",
          property: "position",
          keyframes: [
            new Keyframe({ time: 0, value: [0, 0, 0] }),
            new Keyframe({ time: DURATION, value: [0, 0, 0] }),
          ],
        },
        {
          name: "action-squash-stretch",
          target: "actionRoot",
          property: "scale",
          keyframes: scales,
        },
        {
          name: "action-holding-arm-raise",
          target: "rightArmPivot",
          property: "position",
          keyframes: createVectorKeyframes(ARM_OFFSETS),
        },
        {
          name: "action-rod-arbitrary-axis-flourish",
          target: "gripAnchor",
          property: "rotation",
          keyframes: SAMPLE_TIMES.map(
            (time, index) =>
              new Keyframe({
                time,
                valueType: "quaternion",
                interpolation: "slerp",
                value: flourishRotations[index],
              }),
          ),
        },
      ],
    });
  }

  return createKirbyStarRodActionClip;
})();

const TIME_EPSILON = 1e-9;

/** Application-local ordinary Y rotation; seconds relative to each quiet interval. */
export const KIRBY_TURN = Object.freeze({
  duration: 4.8,
  angle: (28 * Math.PI) / 180,
  turnEnd: 0.95,
  holdEnd: 1.35,
  oppositeEnd: 2.95,
  oppositeHoldEnd: 3.35,
  returnEnd: 4.45,
  intervals: 96,
});

/** Precompute eased quaternion samples once; the existing player owns sampling. */
function createKirbyTurnClip() {
  const keyframes = [];
  const axis = new Vector3(0, 1, 0);
  const settings = KIRBY_TURN;

  for (let index = 0; index <= settings.intervals; index++) {
    const time = (index * settings.duration) / settings.intervals;
    let amount = 0;

    // Putar ke kanan, tahan, lalu ke kiri dan kembali ke arah awal.
    if (time < settings.turnEnd) {
      amount = smoothStep(time / settings.turnEnd);
    } else if (time <= settings.holdEnd) {
      amount = 1;
    } else if (time < settings.oppositeEnd) {
      amount =
        1 -
        2 *
          smoothStep(
            (time - settings.holdEnd) /
              (settings.oppositeEnd - settings.holdEnd),
          );
    } else if (time <= settings.oppositeHoldEnd) {
      amount = -1;
    } else if (time < settings.returnEnd) {
      amount =
        -1 +
        smoothStep(
          (time - settings.oppositeHoldEnd) /
            (settings.returnEnd - settings.oppositeHoldEnd),
        );
    }

    keyframes.push(
      new Keyframe({
        time,
        valueType: "quaternion",
        interpolation: "slerp",
        value: new Quaternion().setFromAxisAngle(axis, settings.angle * amount),
      }),
    );
  }
  return new AnimationClip({
    name: "Kirby deliberate body turn",
    duration: settings.duration,
    tracks: [
      {
        name: "body-turn",
        target: "turnRoot",
        property: "rotation",
        keyframes,
      },
    ],
  });
}

/**
 * Single authoritative body timeline. Pose clips are evaluated at phase-local
 * seconds; the facial clocks are independent owners in the character interface.
 * No old gesture/hop/turn countdown scheduler runs alongside this controller.
 */
class KirbyAnimationController {
  constructor(idle, gesture, action, turn, walk, hopPose) {
    this.idle = idle;
    this.gesture = gesture;
    this.action = action;
    this.turn = turn;
    this.walk = walk;
    this.hopPose = hopPose;
    this.paused = true;
    this.disposed = false;
    this.stopped = true;
    this.phaseIndex = 0;
    this.phaseTime = 0;
    this.cycles = 0;
  }
  get phase() {
    return KIRBY_SHOWCASE.phases[this.phaseIndex];
  }
  get time() {
    return this.phase.start + this.phaseTime;
  }
  get gestureActive() {
    return !this.stopped && this.phase.name === "gesture";
  }
  get actionActive() {
    return !this.stopped && this.phase.name === "hop";
  }
  get turnActive() {
    return !this.stopped && this.phase.name === "turn";
  }
  get secondsUntilAction() {
    return this.until("hop");
  }
  get secondsUntilGesture() {
    return this.until("gesture");
  }
  get secondsUntilTurn() {
    return this.until("turn");
  }
  until(name) {
    const phase = KIRBY_SHOWCASE.phases.find((value) => value.name === name);
    if (this.phase.name === name && !this.stopped) return 0;
    const remaining = phase.start - this.time;
    return remaining >= 0 ? remaining : remaining + KIRBY_SHOWCASE.duration;
  }
  requireActive() {
    if (this.disposed)
      throw new Error("Disposed KirbyAnimationController cannot be used.");
  }
  play() {
    this.requireActive();
    this.paused = false;
    if (this.walk.active) this.walk.playing = true;
    return this;
  }
  pause() {
    this.requireActive();
    this.paused = true;
    if (this.walk.active) this.walk.playing = false;
    return this;
  }
  stop() {
    this.requireActive();
    this.walk.stop();
    this.action.stop();
    this.gesture.stop();
    this.turn.stop();
    this.idle.stop();
    this.phaseIndex = 0;
    this.phaseTime = 0;
    this.cycles = 0;
    this.paused = true;
    this.stopped = true;
    return this;
  }
  restart() {
    this.stop();
    this.stopped = false;
    this.paused = false;
    this.enterPhase();
    return this;
  }
  enterPhase() {
    if (this.phase.name === "settle") {
      this.walk.captureSource();
      this.walk.start(true);
    } else {
      this.walk.stop();
      this.idle.stop();
      this.action.stop();
      this.gesture.stop();
      this.turn.stop();
      if (this.phase.name === "walk") {
        this.walk.captureSource();
        this.walk.start();
      }
    }
    this.sample(0);
  }
  sample(deltaSeconds) {
    const name = this.phase.name;
    if (name === "walk" || name === "settle") {
      this.walk.update(deltaSeconds);
      this.hopPose.apply(false, false);
      return;
    }
    // A shared, subtle idle owner fades to authored zero at every action
    // boundary, giving clean holding poses and a continuous loop restart.
    const edge = Math.min(
      1,
      this.phaseTime / KIRBY_SHOWCASE.idleFade,
      (this.phase.duration - this.phaseTime) / KIRBY_SHOWCASE.idleFade,
    );
    this.idle.seek(this.phaseTime).applyWeight(smoothStep(Math.max(0, edge)));
    let travelZ = 0;
    if (name === "turn") this.turn.seek(this.phaseTime);
    else if (name === "gesture") this.gesture.seek(this.phaseTime);
    else if (name === "hop") {
      const returnStart = KIRBY_HOP.duration + KIRBY_HOP_TRAVEL.pauseDuration;
      let hopTime = this.phaseTime;
      if (this.phaseTime > KIRBY_HOP.duration) {
        hopTime = Math.max(0, this.phaseTime - returnStart);
      }
      this.action.seek(hopTime);
      travelZ = evaluateKirbyHopTravel(this.phaseTime);
    }
    this.hopPose.apply(name === "hop", true, travelZ);
  }
  update(deltaSeconds) {
    this.requireActive();
    if (this.paused || deltaSeconds === 0) return this;
    let remaining = deltaSeconds;
    while (remaining > 0) {
      const available = this.phase.duration - this.phaseTime;
      const step = Math.min(remaining, available);
      this.phaseTime += step;
      remaining = Math.max(0, remaining - step);
      if (available - step <= TIME_EPSILON)
        this.phaseTime = this.phase.duration;
      this.sample(step);
      if (this.phaseTime < this.phase.duration) break;
      this.phaseTime = 0;
      this.phaseIndex++;
      if (this.phaseIndex === KIRBY_SHOWCASE.phases.length) {
        this.phaseIndex = 0;
        this.cycles++;
      }
      this.enterPhase();
    }
    return this;
  }
  dispose() {
    if (this.disposed) return;
    this.stop();
    this.idle.dispose();
    this.gesture.dispose();
    this.action.dispose();
    this.turn.dispose();
    this.disposed = true;
  }
}

/** Application-only facial timing and nondegenerate crease dimensions. */
export const KIRBY_EXPRESSION = Object.freeze({
  duration: 5.8,
  openDuration: 3,
  transitionDuration: 0.4,
  closedDuration: 2,
  apertureFactor: 0.035,
  depthFactor: 0.18,
  centerY: -0.1845,
  closedCenterY: -0.19,
  curveRise: 0.09,
  tongueRetraction: 0.22,
  tongueHideAt: 0.985,
});
const EXPRESSION_ROWS = Object.freeze([
  -2, -0.68, -0.6, -0.5, -0.43, -0.3, -0.2, -0.1, 0, 0.04, 0.1, 0.17, 2,
]);

// Refine only the mouth patch into fixed vertical strips. On each strip the
// closed smile's piecewise-linear centre curve is affine, avoiding folded fan
// triangles when the former convex bowl becomes a thin upward-curving groove.
function prepareExpressionTopology(geometry, body) {
  const source = geometry.vertices,
    normals = geometry.normals,
    uv = geometry.getAttribute("uv").data;
  const positions = Array.from(source),
    normalData = Array.from(normals),
    uvData = Array.from(uv),
    indices = [];
  const clip = (polygon, bound, keepRight, coordinate = (p) => p[0]) => {
    const result = [];
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i],
        q = polygon[(i + 1) % polygon.length],
        dp = coordinate(p) - bound,
        dq = coordinate(q) - bound;
      const a = keepRight ? dp >= 0 : dp <= 0,
        b = keepRight ? dq >= 0 : dq <= 0;
      if (a) result.push(p);
      if (a !== b) {
        const t = dp / (dp - dq);
        result.push(p.map((value, k) => value + (q[k] - value) * t));
      }
    }
    return result;
  };
  for (let index = 0; index < geometry.indices.length; index += 3) {
    const ids = [
      geometry.indices[index],
      geometry.indices[index + 1],
      geometry.indices[index + 2],
    ];
    const triangle = ids.map((i) => [
      ...source.subarray(i * 3, i * 3 + 3),
      ...normals.subarray(i * 3, i * 3 + 3),
      ...uv.subarray(i * 2, i * 2 + 2),
    ]);
    const low = Math.min(...triangle.map((p) => p[0])),
      high = Math.max(...triangle.map((p) => p[0]));
    if (
      body &&
      (!triangle.every((p) => p[2] > 0.8) ||
        low > 0.5 ||
        high < -0.5 ||
        Math.min(...triangle.map((p) => p[1])) > 0.17 ||
        Math.max(...triangle.map((p) => p[1])) < -0.68)
    ) {
      indices.push(...ids);
      continue;
    }
    const first = Math.floor((low + 0.5) / 0.025),
      last = Math.floor((high + 0.5 - 1e-10) / 0.025);
    for (let strip = first; strip <= last; strip++) {
      const left = -0.5 + strip * 0.025,
        right = left + 0.025;
      const vertical = clip(clip(triangle, left, true), right, false);
      const emit = (polygon) => {
        for (let t = 1; t < polygon.length - 1; t++) {
          const points = [polygon[0], polygon[t], polygon[t + 1]],
            a = points[0],
            b = points[1],
            c = points[2];
          const x = b[0] - a[0],
            y = b[1] - a[1],
            z = b[2] - a[2],
            u = c[0] - a[0],
            v = c[1] - a[1],
            w = c[2] - a[2];
          if (Math.hypot(y * w - z * v, z * u - x * w, x * v - y * u) < 1e-12)
            continue;
          for (const p of points) {
            indices.push(positions.length / 3);
            positions.push(p[0], p[1], p[2]);
            const length = Math.hypot(p[3], p[4], p[5]);
            normalData.push(p[3] / length, p[4] / length, p[5] / length);
            uvData.push(p[6], p[7]);
          }
        }
      };
      for (let row = 0; row < EXPRESSION_ROWS.length - 1; row++) {
        const bottom = EXPRESSION_ROWS[row],
          top = EXPRESSION_ROWS[row + 1];
        const polygon = clip(
          clip(vertical, bottom, true, (p) => p[1]),
          top,
          false,
          (p) => p[1],
        );
        const diagonal = (p) =>
          p[1] - bottom - ((p[0] - left) * (top - bottom)) / 0.025;
        emit(clip(polygon, 0, true, diagonal));
        emit(clip(polygon, 0, false, diagonal));
      }
    }
  }
  geometry
    .setAttribute("position", new Float32Array(positions), 3)
    .setAttribute("normal", new Float32Array(normalData), 3)
    .setAttribute("uv", new Float32Array(uvData), 2)
    .setIndices(
      new (positions.length / 3 > 65535 ? Uint32Array : Uint16Array)(indices),
    );
}

/** Persistent geometry-only expression owner; never writes TRS or camera state. */
class KirbyExpressionCycle {
  constructor(parts) {
    this.parts = parts;
    this.time = 0;
    this.amount = 0;
    this.records = [];
    const radii = parts.body.mesh.geometry.parameters;
    this.radii = radii;
    const keys = ["body", "mouthEdge", "mouthWalls", "mouthInterior", "tongue"];
    for (const key of keys) {
      const geometry = parts[key].mesh.geometry,
        body = key === "body";
      prepareExpressionTopology(geometry, body);
      const open = geometry.vertices.slice(),
        openNormals = geometry.normals.slice(),
        closed = open.slice(),
        closedNormals = openNormals.slice();
      const affected = [];
      for (let offset = 0; offset < open.length; offset += 3) {
        const x = open[offset],
          y = open[offset + 1],
          z = open[offset + 2];
        const wx =
          1 - smoothStep(Math.max(0, Math.min(1, (Math.abs(x) - 0.29) / 0.21)));
        const wy =
          y < -0.43
            ? smoothStep(Math.max(0, Math.min(1, (y + 0.68) / 0.25)))
            : 1 - smoothStep(Math.max(0, Math.min(1, (y - 0.04) / 0.13)));
        const weight = body ? (z > 0.8 ? wx * wy : 0) : 1;
        if (!weight) continue;
        const newY = body
          ? this.bodyY(x, y)
          : this.curve(x) +
            KIRBY_EXPRESSION.apertureFactor * (y - KIRBY_EXPRESSION.centerY);
        const before = this.surface(x, y),
          after = this.surface(x, newY);
        closed[offset + 1] = newY;
        closed[offset + 2] = body
          ? z + this.bodyY(x, y, true)
          : after +
            (z - before) * KIRBY_EXPRESSION.depthFactor -
            (key === "tongue" ? KIRBY_EXPRESSION.tongueRetraction : 0);
        const nx = x / radii.radiusX ** 2,
          ny = newY / radii.radiusY ** 2,
          nz = closed[offset + 2] / radii.radiusZ ** 2,
          length = Math.hypot(nx, ny, nz);
        closedNormals[offset] = nx / length;
        closedNormals[offset + 1] = ny / length;
        closedNormals[offset + 2] = nz / length;
        affected.push(offset / 3);
      }
      const groups = new Map(),
        group = new Uint32Array(open.length / 3);
      for (let i = 0; i < group.length; i++) {
        const key = this.key(open[i * 3], open[i * 3 + 1], open[i * 3 + 2]);
        if (!groups.has(key)) groups.set(key, groups.size);
        group[i] = groups.get(key);
      }
      const record = {
        key,
        geometry,
        body,
        open,
        openNormals,
        closed,
        closedNormals,
        affected: new Uint32Array(affected),
        group,
        sums: new Float64Array(groups.size * 3),
      };
      geometry.dynamicRanges = [];
      // Pre-create all views used by bufferSubData. No subarray allocations
      // or GPU buffer allocation happens during deformation/rendering.
      for (let i = 0; i < affected.length; ) {
        const start = affected[i];
        let end = start + 1;
        i++;
        // Coalesce tiny gaps in this local patch to avoid hundreds of
        // driver calls. Gap values remain byte-identical, not deformed.
        while (i < affected.length && affected[i] - end <= 16) {
          end = affected[i] + 1;
          i++;
        }
        geometry.dynamicRanges.push({
          offset: start * 12,
          positions: geometry.vertices.subarray(start * 3, end * 3),
          normals: geometry.normals.subarray(start * 3, end * 3),
        });
      }
      this.records.push(record);
    }
    const body = this.records[0],
      edge = this.records[1],
      lookup = new Map();
    this.seam = [];
    for (let i = 0; i < body.open.length; i += 3)
      lookup.set(this.key(body.open[i], body.open[i + 1], body.open[i + 2]), i);
    for (let i = 0; i < edge.open.length; i += 3) {
      const index = lookup.get(
        this.key(edge.open[i], edge.open[i + 1], edge.open[i + 2]),
      );
      if (index !== undefined) {
        this.seam.push([i, index]);
        for (let k = 0; k < 3; k++) {
          // Canonical Float32 seam values, captured once as the exact
          // open pose; independent clipping can differ by one ulp.
          edge.open[i + k] = edge.geometry.vertices[i + k] =
            body.open[index + k];
          edge.openNormals[i + k] = edge.geometry.normals[i + k] =
            body.openNormals[index + k];
          edge.closed[i + k] = body.closed[index + k];
        }
      }
    }
    edge.geometry.userData.expressionSeamPairs = this.seam;
  }
  key(x, y, z) {
    return `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;
  }
  surface(x, y) {
    const r = this.radii;
    return (
      r.radiusZ *
      Math.sqrt(Math.max(1e-6, 1 - (x / r.radiusX) ** 2 - (y / r.radiusY) ** 2))
    );
  }
  curve(x) {
    const cell = Math.floor((x + 0.5) / 0.025),
      left = -0.5 + cell * 0.025,
      t = (x - left) / 0.025;
    return (
      KIRBY_EXPRESSION.closedCenterY +
      KIRBY_EXPRESSION.curveRise *
        ((1 - t) * (left / 0.265) ** 2 + t * ((left + 0.025) / 0.265) ** 2)
    );
  }
  bodyY(x, y, depth = false) {
    const target = (px, py) => {
      const wx =
        1 - smoothStep(Math.max(0, Math.min(1, (Math.abs(px) - 0.29) / 0.21)));
      const wy =
        py < -0.43
          ? smoothStep(Math.max(0, Math.min(1, (py + 0.68) / 0.25)))
          : 1 - smoothStep(Math.max(0, Math.min(1, (py - 0.04) / 0.13)));
      const newY =
        py +
        wx *
          wy *
          (this.curve(px) +
            KIRBY_EXPRESSION.apertureFactor * (py - KIRBY_EXPRESSION.centerY) -
            py);
      return depth ? this.surface(px, newY) - this.surface(px, py) : newY;
    };
    const left = -0.5 + Math.floor((x + 0.5) / 0.025) * 0.025,
      u = (x - left) / 0.025;
    let row = 0;
    while (row < EXPRESSION_ROWS.length - 2 && y > EXPRESSION_ROWS[row + 1])
      row++;
    const bottom = EXPRESSION_ROWS[row],
      top = EXPRESSION_ROWS[row + 1],
      v = (y - bottom) / (top - bottom);
    return v >= u
      ? (1 - v) * target(left, bottom) +
          (v - u) * target(left, top) +
          u * target(left + 0.025, top)
      : (1 - u) * target(left, bottom) +
          (u - v) * target(left + 0.025, bottom) +
          v * target(left + 0.025, top);
  }
  reset() {
    this.time = 0;
    this.apply(0);
  }
  update(delta) {
    const settings = KIRBY_EXPRESSION,
      closingEnd = settings.openDuration + settings.transitionDuration;
    const reopeningStart = closingEnd + settings.closedDuration;
    this.time = (this.time + delta) % settings.duration;
    const t = this.time;
    const amount =
      t <= settings.openDuration
        ? 0
        : t < closingEnd
          ? smoothStep(
              (t - settings.openDuration) / settings.transitionDuration,
            )
          : t <= reopeningStart
            ? 1
            : 1 -
              smoothStep((t - reopeningStart) / settings.transitionDuration);
    this.apply(amount);
  }
  apply(amount) {
    this.parts.tongue.visible = amount < KIRBY_EXPRESSION.tongueHideAt;
    if (amount === this.amount) return;
    this.amount = amount;
    for (const record of this.records) {
      const { geometry, open, closed, openNormals, closedNormals, affected } =
          record,
        p = geometry.vertices,
        n = geometry.normals;
      for (const vertex of affected)
        for (let k = 0; k < 3; k++) {
          const i = vertex * 3 + k;
          p[i] =
            amount === 0 ? open[i] : open[i] + amount * (closed[i] - open[i]);
        }
      if (amount === 0) n.set(openNormals);
      else if (record.body) {
        for (const vertex of affected) {
          const i = vertex * 3,
            x = openNormals[i] + amount * (closedNormals[i] - openNormals[i]),
            y =
              openNormals[i + 1] +
              amount * (closedNormals[i + 1] - openNormals[i + 1]),
            z =
              openNormals[i + 2] +
              amount * (closedNormals[i + 2] - openNormals[i + 2]),
            length = Math.hypot(x, y, z);
          n[i] = x / length;
          n[i + 1] = y / length;
          n[i + 2] = z / length;
        }
      } else {
        this.normals(record);
        // New subdivision vertices inherit the reviewed open shading.
        // Ease into geometric normals too, avoiding a shading pop at
        // the first nonzero deformation sample.
        if (amount < 1)
          for (const vertex of affected) {
            const i = vertex * 3,
              x = openNormals[i] + amount * (n[i] - openNormals[i]),
              y = openNormals[i + 1] + amount * (n[i + 1] - openNormals[i + 1]),
              z = openNormals[i + 2] + amount * (n[i + 2] - openNormals[i + 2]);
            const length = Math.hypot(x, y, z);
            n[i] = x / length;
            n[i + 1] = y / length;
            n[i + 2] = z / length;
          }
      }
      geometry.markChanged();
    }
    const body = this.records[0].geometry,
      edge = this.records[1].geometry;
    for (const pair of this.seam)
      for (let k = 0; k < 3; k++) {
        edge.vertices[pair[0] + k] = body.vertices[pair[1] + k];
        edge.normals[pair[0] + k] = body.normals[pair[1] + k];
      }
  }
  normals(record) {
    const { geometry, group, sums, openNormals } = record,
      p = geometry.vertices,
      n = geometry.normals,
      indices = geometry.indices;
    sums.fill(0);
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3,
        b = indices[i + 1] * 3,
        c = indices[i + 2] * 3;
      const x = p[b] - p[a],
        y = p[b + 1] - p[a + 1],
        z = p[b + 2] - p[a + 2],
        u = p[c] - p[a],
        v = p[c + 1] - p[a + 1],
        w = p[c + 2] - p[a + 2];
      const nx = y * w - z * v,
        ny = z * u - x * w,
        nz = x * v - y * u;
      for (let j = 0; j < 3; j++) {
        const g = group[indices[i + j]] * 3;
        sums[g] += nx;
        sums[g + 1] += ny;
        sums[g + 2] += nz;
      }
    }
    for (let vertex = 0; vertex < group.length; vertex++) {
      const i = vertex * 3,
        g = group[vertex] * 3,
        length = Math.hypot(sums[g], sums[g + 1], sums[g + 2]);
      n[i] = length ? sums[g] / length : openNormals[i];
      n[i + 1] = length ? sums[g + 1] / length : openNormals[i + 1];
      n[i + 2] = length ? sums[g + 2] / length : openNormals[i + 2];
    }
  }
}

/** Fixed, character-local treadmill gait; +Z is toward Kirby's face. */
export const KIRBY_WALK = Object.freeze({
  duration: 1.4,
  supportFraction: 0.6,
  stepReach: 0.38,
  backReach: 0.22,
  footLift: 0.3,
  footPitch: 0.45,
  swingEase: 0.65,
  forwardArrival: 0.6,
  bodyBob: 0.035,
  weightShift: 0.045,
  armSwing: 0.055,
  blendDuration: 0.24,
});
const smoothStep = (value) => value * value * (3 - 2 * value);

/** Fixed presentation timeline, in seconds; five complete 1.4-second gait cycles. */
export const KIRBY_SHOWCASE = (() => {
  let start = 0;
  const phases = [
    ["friendlyIdle", "Friendly idle", 2.8],
    ["walk", "Walk in place", KIRBY_WALK.duration * 5],
    ["settle", "Settling to holding pose", KIRBY_WALK.blendDuration],
    ["turn", "Turn right, left, then front", KIRBY_TURN.duration],
    ["gesture", "Diagonal Star Rod salute", 3],
    [
      "hop",
      "Hop forward and back",
      KIRBY_HOP.duration * 2 + KIRBY_HOP_TRAVEL.pauseDuration,
    ],
    ["rest", "Resting idle", 2.8],
  ].map(([name, label, duration]) => {
    const phase = Object.freeze({
      name,
      label,
      start,
      duration,
      end: start + duration,
    });
    start = phase.end;
    return phase;
  });
  return Object.freeze({
    phases: Object.freeze(phases),
    duration: start,
    walkCycles: 5,
    idleFade: 0.24,
  });
})();

/**
 * Application-only gait owner. Normal idle/one-shot players are stopped while
 * this runs; only the disjoint six-node blink player continues. Every pose is
 * rebuilt from construction-time values, including the transition destination.
 * No foot, camera, geometry or GPU resource is created during sampling.
 */
class KirbyWalkCycle {
  constructor(parts, root) {
    this.parts = parts;
    this.root = root;
    this.time = 0;
    this.blendTime = 0;
    this.active = false;
    this.playing = false;
    this.exiting = false;
    const eyes = new Set([
      parts.leftEye,
      parts.rightEye,
      parts.leftPupil,
      parts.rightPupil,
      parts.leftHighlight,
      parts.rightHighlight,
    ]);
    this.poses = [];
    root.traverse((node) => {
      if (eyes.has(node)) return;
      const pose = node.transform;
      this.poses.push({
        node,
        position: new Vector3().copy(pose.position),
        rotation: new Quaternion().copy(pose.rotation),
        scale: new Vector3().copy(pose.scale),
        sourcePosition: new Vector3(),
        sourceRotation: new Quaternion(),
        sourceScale: new Vector3(),
      });
    });
    this.feet = [parts.leftFoot, parts.rightFoot].map((node) => ({
      node,
      base: this.poses.find((pose) => pose.node === node),
      sourceBottom: 0,
      lift: 0,
    }));
    this.armBase = this.poses.find((pose) => pose.node === parts.leftArmPivot);
    this.delta = new Quaternion();
    this.axis = new Vector3(1, 0, 0);
    root.updateWorldMatrices();
    // Use actual sampled vertices, not centre height or an unrotated radius.
    this.groundHeight = this.lowestPoint(parts.leftFoot);
    this.captureSource();
  }
  lowestPoint(node) {
    const matrix = node.worldMatrix,
      vertices = node.mesh.geometry.vertices;
    let bottom = Infinity;
    for (let index = 0; index < vertices.length; index += 3) {
      bottom = Math.min(
        bottom,
        matrix[1] * vertices[index] +
          matrix[5] * vertices[index + 1] +
          matrix[9] * vertices[index + 2] +
          matrix[13],
      );
    }
    return bottom;
  }
  captureSource() {
    for (const pose of this.poses) {
      pose.sourcePosition.copy(pose.node.transform.position);
      pose.sourceRotation.copy(pose.node.transform.rotation);
      pose.sourceScale.copy(pose.node.transform.scale);
    }
    this.root.updateWorldMatrices();
    for (const foot of this.feet)
      foot.sourceBottom = this.lowestPoint(foot.node);
  }
  restore() {
    for (const pose of this.poses)
      pose.node.transform.position.copy(pose.position);
    for (const pose of this.poses) {
      pose.node.transform.rotation.copy(pose.rotation);
      pose.node.transform.scale.copy(pose.scale);
    }
  }
  start(exiting = false) {
    this.exiting = exiting;
    this.blendTime = 0;
    if (!exiting) this.time = 0;
    this.active = true;
    this.playing = true;
    this.apply();
  }
  restart() {
    this.restore();
    this.captureSource();
    this.start();
  }
  stop() {
    this.restore();
    this.active = false;
    this.playing = false;
    this.exiting = false;
  }
  update(deltaSeconds) {
    if (!this.playing) return 0;
    const step = this.exiting
      ? Math.min(deltaSeconds, KIRBY_WALK.blendDuration - this.blendTime)
      : deltaSeconds;
    this.time = (this.time + step) % KIRBY_WALK.duration;
    this.blendTime = Math.min(KIRBY_WALK.blendDuration, this.blendTime + step);
    this.apply();
    return step;
  }
  apply() {
    const settings = KIRBY_WALK;
    const blend = smoothStep(this.blendTime / settings.blendDuration);
    const weight = this.exiting ? 1 - blend : blend;
    const phase = this.time / settings.duration,
      angle = 2 * Math.PI * phase;
    this.restore();
    const lateral = -settings.weightShift * Math.sin(angle) * weight;
    this.root.transform.position.x += lateral;
    this.root.transform.position.y +=
      settings.bodyBob * (1 - Math.cos(2 * angle)) * 0.5 * weight;
    // Swing about the existing free-arm pivot; the holding branch stays authored.
    this.delta.setFromAxisAngle(
      this.axis,
      settings.armSwing * Math.sin(angle) * weight,
    );
    this.parts.leftArmPivot.transform.rotation
      .copy(this.armBase.rotation)
      .multiply(this.delta);
    for (let index = 0; index < 2; index++) {
      const foot = this.feet[index],
        footPhase = (phase + index * 0.5) % 1;
      const supporting = footPhase < settings.supportFraction;
      const progress = supporting
        ? footPhase / settings.supportFraction
        : (footPhase - settings.supportFraction) /
          (1 - settings.supportFraction);
      // Monotone time warp: derivative 1 + ease*cos(2*pi*p) stays
      // positive, slowing through the raised pose without a frozen hold.
      const swingProgress =
        progress +
        (settings.swingEase * Math.sin(2 * Math.PI * progress)) / (2 * Math.PI);
      const swing = supporting ? 0 : Math.sin(Math.PI * swingProgress) ** 2;
      // Reach forward before peak lift, then lower into placement. The
      // old symmetric stroke was still centred under Kirby at peak lift.
      const reach = supporting
        ? settings.stepReach -
          (settings.stepReach + settings.backReach) * smoothStep(progress)
        : -settings.backReach +
          (settings.stepReach + settings.backReach) *
            smoothStep(Math.min(1, swingProgress / settings.forwardArrival));
      foot.lift = settings.footLift * swing * weight;
      foot.node.transform.position.x -= lateral;
      foot.node.transform.position.z += reach * weight;
      // Negative local-X pitch tips the toe up and exposes the broad
      // rounded sole toward the front. It eases to zero before support.
      this.delta.setFromAxisAngle(
        this.axis,
        -settings.footPitch * swing * weight,
      );
      foot.node.transform.rotation
        .copy(foot.base.rotation)
        .multiply(this.delta);
    }
    if (blend < 1) {
      // This is one owner's explicit mode transition, not competing players.
      // Source snapshots are temporary blend endpoints, NEVER authored bases.
      for (const pose of this.poses) {
        const target = pose.node.transform,
          source = pose.sourcePosition;
        target.position.set(
          source.x + (target.position.x - source.x) * blend,
          source.y + (target.position.y - source.y) * blend,
          source.z + (target.position.z - source.z) * blend,
        );
        const scale = pose.sourceScale;
        target.scale.set(
          scale.x + (target.scale.x - scale.x) * blend,
          scale.y + (target.scale.y - scale.y) * blend,
          scale.z + (target.scale.z - scale.z) * blend,
        );
        this.delta.copy(target.rotation);
        target.rotation.copy(pose.sourceRotation).slerp(this.delta, blend);
      }
    }
    this.root.updateWorldMatrices();
    for (const foot of this.feet) {
      const bottom =
        this.groundHeight +
        foot.lift +
        (foot.sourceBottom - this.groundHeight) * (1 - blend);
      // Full inherited TRS and actual foot pitch/splay are included. A local
      // Y correction moves world Y by parent[5]; parents remain nonsingular.
      foot.node.transform.position.y +=
        (bottom - this.lowestPoint(foot.node)) /
        foot.node.parent.worldMatrix[5];
    }
  }
}

/**
 * Final application pose pass: ground-relative hop scale, sampled sole contact,
 * and rigid-rod scale inheritance. It owns only the derived action translation,
 * foot Y offsets, and the compensation matrix, never another player's rotation.
 */
class KirbyHopPose {
  constructor(parts, action, groundHeight) {
    this.parts = parts;
    this.action = action;
    this.groundHeight = groundHeight;
    this.feet = [parts.leftFoot, parts.rightFoot].map((node) => ({
      node,
      authoredY: node.transform.position.y,
    }));
    this.actionY = parts.actionRoot.transform.position.y;
    this.actionZ = parts.actionRoot.transform.position.z;
    this.rotation = new Quaternion();
    this.rotationPose = new LocalPose();
    parts.rodScaleCompensation.useLocalPose = false;
  }
  lowest(node) {
    const m = node.worldMatrix,
      v = node.mesh.geometry.vertices;
    let bottom = Infinity;
    for (let i = 0; i < v.length; i += 3)
      bottom = Math.min(
        bottom,
        m[1] * v[i] + m[5] * v[i + 1] + m[9] * v[i + 2] + m[13],
      );
    return bottom;
  }
  apply(actionActive, groundedPreview, travelZ = 0) {
    const p = this.parts;
    let height = 0;
    if (actionActive) {
      // Resample the uncorrected authored + offset pose, even when paused.
      // Compensation therefore cannot feed back into the next pose.
      this.action.apply();
      height = evaluateKirbyHopHeight(this.action.time);
      p.actionRoot.transform.position.y =
        this.actionY +
        height +
        this.groundHeight * (1 - p.actionRoot.transform.scale.y);
    }
    // Terapkan perpindahan setelah posisi dasar dari clip dipulihkan.
    // Saat transisi ke jalan, posisi Z masih diatur oleh animasi berjalan.
    if (actionActive || groundedPreview) {
      p.actionRoot.transform.position.z = this.actionZ + travelZ;
    }
    if (groundedPreview) {
      for (const foot of this.feet)
        foot.node.transform.position.y = foot.authoredY;
      p.animationRoot.updateWorldMatrices();
      for (const foot of this.feet) {
        foot.node.transform.position.y +=
          (this.groundHeight + height - this.lowest(foot.node)) /
          foot.node.parent.worldMatrix[5];
      }
      // This same small sole lock bridges ordinary preview and hop. It
      // avoids entry/exit pops from idle bob/sway, without changing those
      // tracks or touching walking's separate ground-contact owner.
    }
    this.preserveRigidRod();
  }
  preserveRigidRod() {
    const p = this.parts,
      s = p.actionRoot.transform.scale,
      m = p.rodScaleCompensation.baseMatrix;
    m.fill(0);
    m[0] = m[5] = m[10] = m[15] = 1;
    if (s.x === 1 && s.y === 1 && s.z === 1) return;
    // Between actionRoot's scale S and the grip lies only rotation R.
    // C = transpose(R) * inverse(S) * R gives S*R*C = R, at the same
    // scaled grip origin. A matrix node is required: rotated anisotropic
    // stretch generally cannot be cancelled by local XYZ scale alone.
    this.rotation
      .copy(p.kirbyRoot.transform.rotation)
      .multiply(p.rightArmPivot.transform.rotation)
      .multiply(p.gripAnchor.transform.rotation);
    this.rotationPose
      .setRotationFromQuaternion(this.rotation)
      .updateLocalMatrix();
    const r = this.rotationPose.localMatrix.elements;
    for (let row = 0; row < 3; row++)
      for (let column = 0; column < 3; column++) {
        m[column * 4 + row] =
          (r[row * 4] * r[column * 4]) / s.x +
          (r[row * 4 + 1] * r[column * 4 + 1]) / s.y +
          (r[row * 4 + 2] * r[column * 4 + 2]) / s.z;
      }
  }
}

/** Authored shared-motion settings; no geometry or clip amplitude changes. */
export const KIRBY_GRIP_SUPPORT = Object.freeze({
  inwardSeat: 0.16,
  referenceAngle: (50 * Math.PI) / 180,
});

/**
 * Final application-only shared hand/rod composition. Clip players retain the
 * original gripAnchor and starRodRoot quaternion tracks. Their product Q is
 * also applied to the rigid hand, with both origins orbiting the authored
 * shoulder centre S: S + Q*(A-S), S + Q*(G-S). Nothing is reparented beneath a
 * scaled mesh; the existing rod compensation is still applied exactly once.
 */
class KirbyGripSupportPose {
  /** Capture authored poses before playback; allocate scratch only once. */
  constructor(parts) {
    this.parts = parts;
    const arm = parts.rightArm.transform;
    this.armPosition = new Vector3().copy(arm.position);
    this.armRotation = new Quaternion().copy(arm.rotation);
    this.gripPosition = new Vector3().copy(parts.gripAnchor.transform.position);
    this.rotation = new Quaternion();
    this.shoulder = new Vector3();
    const length =
        parts.rightArm.mesh.geometry.parameters.vMax ** 2 * arm.scale.z,
      q = this.armRotation;
    this.shoulder.set(
      arm.position.x + 2 * (q.x * q.z + q.w * q.y) * length,
      arm.position.y + 2 * (q.y * q.z - q.w * q.x) * length,
      arm.position.z + (1 - 2 * (q.x * q.x + q.y * q.y)) * length,
    );
    this.referenceSineSquared =
      Math.sin(KIRBY_GRIP_SUPPORT.referenceAngle / 2) ** 2;
    this.previousCorrection = 0;
  }
  /** Remove only the preceding derived correction before players resample. */
  restoreInput() {
    this.parts.rightArmPivot.transform.position.x += this.previousCorrection;
    this.previousCorrection = 0;
  }
  /** Mode/restart restoration already reset the authored parent position. */
  reset() {
    this.previousCorrection = 0;
  }
  /** Rotate an authored offset about the fixed shoulder into a reused value. */
  orbit(out, base, q) {
    const s = this.shoulder,
      x = base.x - s.x,
      y = base.y - s.y,
      z = base.z - s.z;
    const tx = 2 * (q.y * z - q.z * y),
      ty = 2 * (q.z * x - q.x * z),
      tz = 2 * (q.x * y - q.y * x);
    out.set(
      s.x + x + q.w * tx + q.y * tz - q.z * ty,
      s.y + y + q.w * ty + q.z * tx - q.x * tz,
      s.z + z + q.w * tz + q.x * ty - q.y * tx,
    );
  }
  /** Compose from authored data, never from the preceding animated hand. */
  apply(walking) {
    const p = this.parts,
      q = this.rotation
        .copy(p.gripAnchor.transform.rotation)
        .multiply(p.starRodRoot.transform.rotation);
    if (q.x === 0 && q.y === 0 && q.z === 0 && q.w === 1) {
      p.rightArm.transform.position.copy(this.armPosition);
      p.rightArm.transform.rotation.copy(this.armRotation);
      p.gripAnchor.transform.position.copy(this.gripPosition);
      this.previousCorrection = 0;
      return;
    }
    this.orbit(p.rightArm.transform.position, this.armPosition, q);
    p.rightArm.transform.rotation.copy(q).multiply(this.armRotation);
    this.orbit(p.gripAnchor.transform.position, this.gripPosition, q);
    // A small smooth inward seat keeps the open rigid shoulder rim inside
    // the body during the full +50-degree sweep. The original whole-arm Y
    // lift and all rotation keys remain unchanged. During walking's blend,
    // its captured parent translation already includes this source offset.
    this.previousCorrection = walking
      ? 0
      : (KIRBY_GRIP_SUPPORT.inwardSeat * (1 - q.w * q.w)) /
        this.referenceSineSquared;
    p.rightArmPivot.transform.position.x -= this.previousCorrection;
  }
}

const MODES = Object.freeze(["animated", "neutral", "holding", "walk"]);

/**
 * Application-only static poses. Construct once after character/Animator creation,
 * before any playback: snapshots always describe authored transforms, never a
 * paused animation sample. Animators keep their original bindings for all modes.
 */
class KirbyInspectionModes {
  #character;
  #controller;
  #authored = [];
  #mode = null;

  /**
   * Captures authored local poses without modifying the hierarchy or resources.
   * @param {object} character - Result of createKirby().
   * @param {object} animationRoot - Authored neutral idle wrapper.
   * @param {object} actionRoot - Authored neutral hop wrapper.
   * @param {KirbyAnimationController} controller - Unstarted animation controller.
   */
  constructor(character, animationRoot, actionRoot, controller) {
    if (
      !(controller instanceof KirbyAnimationController) ||
      !controller.paused
    ) {
      throw new TypeError(
        "Inspection modes must be created before animation playback.",
      );
    }
    this.#character = character;
    this.#controller = controller;
    const capture = (node) =>
      this.#authored.push({
        node,
        position: node.transform.position.toArray(),
        rotation: node.transform.rotation.toArray(),
        scale: node.transform.scale.toArray(),
        visible: node.visible,
      });
    capture(animationRoot);
    capture(actionRoot);
    character.root.traverse(capture);
  }

  /** @returns {string|null} Selected inspection mode. */
  get mode() {
    return this.#mode;
  }

  /**
   * Applies a deterministic static pose or restarts approved animated playback.
   * Viewing transforms and camera zoom are deliberately outside this controller.
   * @param {string} mode - animated, neutral, holding, or walk.
   * @returns {KirbyInspectionModes} This mode controller.
   */
  setMode(mode) {
    if (!MODES.includes(mode))
      throw new RangeError("Unknown Kirby inspection mode.");
    if (mode === this.#mode) return this;
    this.#controller.stop();
    for (const pose of this.#authored) {
      pose.node.transform
        .setPosition(...pose.position)
        .setRotation(...pose.rotation)
        .setScale(...pose.scale);
      pose.node.setVisible(pose.visible);
    }
    if (mode === "neutral") {
      const { leftArm, rightArm, rightArmPivot, starRodRoot } =
        this.#character.parts;
      // Mirror the authored relaxed arm, including scale: the holding
      // pose has a modest axial extension, not a new neutral proportion.
      const left = leftArm.transform;
      rightArmPivot.transform.setPosition(0, 0, 0).setRotation(0, 0, 0, 1);
      rightArm.transform
        .setPosition(-left.position.x, left.position.y, left.position.z)
        .setRotation(
          left.rotation.x,
          -left.rotation.y,
          -left.rotation.z,
          left.rotation.w,
        )
        .setScale(left.scale.x, left.scale.y, left.scale.z);
      starRodRoot.setVisible(false);
    }
    this.#mode = mode;
    if (mode === "animated") this.#controller.restart();
    return this;
  }
}

const PINK = new Float32Array([1.0, 0.55, 0.72, 1.0]);
const RED = new Float32Array([0.76, 0.075, 0.16, 1.0]);
const EYE_COLOR = new Float32Array([0.055, 0.035, 0.12, 1.0]);
const PUPIL_COLOR = new Float32Array([0.1, 0.25, 0.59, 1.0]);
const HIGHLIGHT_COLOR = new Float32Array([1.55, 1.55, 1.55, 1.0]);
const CHEEK_COLOR = new Float32Array([1.15, 0.35, 0.5, 1.0]);
const MOUTH_COLOR = new Float32Array([0.16, 0.015, 0.045, 1.0]);
const TONGUE_COLOR = new Float32Array([1.1, 0.24, 0.34, 1.0]);
const ROD_COLOR = new Float32Array([1.1, 1.02, 0.86, 1.0]);
const ROD_STRIPE_COLOR = new Float32Array([0.95, 0.08, 0.24, 1.0]);
const ROD_STAR_COLOR = new Float32Array([1.0, 0.72, 0.05, 1.0]);

export const KIRBY_COLORS = Object.freeze({
  pink: PINK,
  red: RED,
  eye: EYE_COLOR,
  pupil: PUPIL_COLOR,
  highlight: HIGHLIGHT_COLOR,
  cheek: CHEEK_COLOR,
  mouth: MOUTH_COLOR,
  tongue: TONGUE_COLOR,
  rod: ROD_COLOR,
  stripe: ROD_STRIPE_COLOR,
  star: ROD_STAR_COLOR,
});

/**
 * Create Kirby using a BORROWED WebGL context. sharedResources may supply a
 * colors palette; shader/program/camera ownership always remains with the host.
 * Returns root (SceneNode), named parts, resources, playback state, update(dt),
 * setMode(animated|neutral|holding|walk), setPlaying(boolean), restart(), dispose().
 * update changes poses only; the host calls root.updateAndDraw(shaderInfo).
 * Neither creation nor update queries the page, owns a camera or starts RAF.
 * @param {WebGLRenderingContext} gl - Borrowed active rendering context.
 * @param {{colors?: object}} [sharedResources={}] - Optional borrowed palette.
 * @returns {object} Independently owned character rig and playback interface.
 */
export function createKirby(gl, sharedResources = {}) {
  if (!gl || typeof gl.createBuffer !== "function")
    throw new TypeError("A shared WebGL context is required");
  const colors = sharedResources.colors ?? KIRBY_COLORS;
  const character = buildKirby(
    gl,
    colors.pink,
    colors.red,
    colors,
    colors.rod,
    colors.stripe,
    colors.star,
  );
  const expression = new KirbyExpressionCycle(character.parts);
  const registry = new Map();
  try {
    for (const mesh of character.resources.meshes) mesh.setup(registry);
  } catch (error) {
    for (const bundle of registry.values())
      for (const name of ["positionBuffer", "normalBuffer", "indexBuffer"])
        gl.deleteBuffer(bundle[name]);
    for (const mesh of character.resources.meshes) mesh.dispose();
    throw error;
  }
  const animationRoot = new SceneNode("animationRoot"),
    actionRoot = new SceneNode("actionRoot");
  animationRoot.addChild(actionRoot);
  actionRoot.addChild(character.root);
  animationRoot.traverse((node) => {
    node.useLocalPose = true;
    node.transform.updateLocalMatrix();
    node.baseMatrix.set(node.transform.localMatrix.elements);
  });
  const parts = {
    ...character.parts,
    animationRoot,
    actionRoot,
    kirbyRoot: character.root,
  };
  const idle = new ClipPlayer(
    createKirbyReadyClip(),
    new Map([
      ["animationRoot", animationRoot],
      ["body", parts.body],
      ["rightArmPivot", parts.rightArmPivot],
      ["starRodRoot", parts.starRodRoot],
    ]),
  );
  const blink = new ClipPlayer(
    createKirbyBlinkClip(parts),
    new Map([
      ["leftEye", parts.leftEye],
      ["rightEye", parts.rightEye],
      ["leftPupil", parts.leftPupil],
      ["rightPupil", parts.rightPupil],
      ["leftHighlight", parts.leftHighlight],
      ["rightHighlight", parts.rightHighlight],
    ]),
  );
  const oneShotTargets = new Map([
    ["actionRoot", actionRoot],
    ["rightArmPivot", parts.rightArmPivot],
    ["gripAnchor", parts.gripAnchor],
  ]);
  const gesture = new ClipPlayer(
    createKirbyStarRodIdleGestureClip(),
    oneShotTargets,
    { loop: false },
  );
  const action = new ClipPlayer(
    createKirbyStarRodActionClip(),
    oneShotTargets,
    { loop: false },
  );
  const walk = new KirbyWalkCycle(parts, animationRoot);
  // This local Y axis passes through the virtual floor beneath the body.
  // The fixed inverse translation preserves every existing authored coordinate.
  // Hosts place the returned rig via an OUTER placement node, independently.
  const turnRoot = new SceneNode("turnRoot"),
    turnOrigin = new SceneNode("turnOrigin");
  turnRoot.useLocalPose = turnOrigin.useLocalPose = true;
  turnRoot.transform.setPosition(0, walk.groundHeight, 0);
  turnOrigin.transform.setPosition(0, -walk.groundHeight, 0);
  turnRoot.addChild(turnOrigin);
  turnOrigin.addChild(animationRoot);
  parts.turnRoot = turnRoot;
  parts.turnOrigin = turnOrigin;
  const turn = new ClipPlayer(
    createKirbyTurnClip(),
    new Map([["turnRoot", turnRoot]]),
    { loop: false },
  );
  const hopPose = new KirbyHopPose(parts, action, walk.groundHeight);
  const gripSupport = new KirbyGripSupportPose(parts);
  const controller = new KirbyAnimationController(
    idle,
    gesture,
    action,
    turn,
    walk,
    hopPose,
  );
  const modes = new KirbyInspectionModes(
    character,
    animationRoot,
    actionRoot,
    controller,
  );
  let disposed = false,
    returningFromWalk = false;
  const requireActive = () => {
    if (disposed) throw new Error("Disposed Kirby character");
  };
  const result = {
    root: turnRoot,
    parts,
    resources: character.resources,
    get mode() {
      return modes.mode;
    },
    get playing() {
      return returningFromWalk || modes.mode === "walk"
        ? walk.playing
        : !controller.paused;
    },
    get disposed() {
      return disposed;
    },
    get showcasePhase() {
      return returningFromWalk ? "settle" : controller.phase.name;
    },
    get showcaseLabel() {
      return returningFromWalk
        ? "Settling to showcase start"
        : controller.phase.label;
    },
    get showcaseTime() {
      return controller.time;
    },
    get showcaseCycles() {
      return controller.cycles;
    },
    get walkingActive() {
      return walk.active;
    },
    get actionActive() {
      return controller.actionActive;
    },
    get gestureActive() {
      return controller.gestureActive;
    },
    get turnActive() {
      return controller.turnActive;
    },
    get secondsUntilTurn() {
      return controller.secondsUntilTurn;
    },
    get secondsUntilAction() {
      return controller.secondsUntilAction;
    },
    get secondsUntilGesture() {
      return controller.secondsUntilGesture;
    },
    get expressionTime() {
      return expression.time;
    },
    get expressionAmount() {
      return expression.amount;
    },
    get blinkTime() {
      return blink.time;
    },
    /** Advance animation from the shared loop, in seconds; @returns {object} this rig. */
    update(deltaSeconds) {
      requireActive();
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
        throw new RangeError("Invalid elapsed seconds");
      const advance = result.playing && deltaSeconds > 0;
      if (advance) {
        gripSupport.restoreInput();
        expression.update(deltaSeconds);
        blink.update(deltaSeconds);
      }
      if (returningFromWalk) {
        const consumed = walk.update(deltaSeconds);
        if (walk.blendTime === KIRBY_WALK.blendDuration) {
          returningFromWalk = false;
          walk.stop();
          controller.restart();
          controller.update(deltaSeconds - consumed);
        } else hopPose.apply(false, false);
      } else if (modes.mode === "walk") {
        walk.update(deltaSeconds);
        hopPose.apply(false, false);
      } else if (modes.mode === "animated") controller.update(deltaSeconds);
      if (advance) gripSupport.apply(walk.active);
      // Pose restoration never owns tongue visibility; the expression
      // has sole ownership and reasserts it after mode/pose sampling.
      expression.apply(expression.amount);
      return result;
    },
    /** Restore a deterministic pose; animated mode restarts clocks; @returns {object} this rig. */
    setMode(mode) {
      requireActive();
      if (!MODES.includes(mode))
        throw new RangeError("Unknown Kirby inspection mode.");
      if (mode === modes.mode) return result;
      const wasDedicatedWalk = modes.mode === "walk";
      expression.reset();
      blink.stop();
      returningFromWalk = false;
      if (mode === "walk" || (mode === "animated" && wasDedicatedWalk)) {
        const fromNeutral = modes.mode === "neutral";
        if (!fromNeutral) walk.captureSource();
        modes.setMode(mode);
        controller.stop();
        // The hidden-rod neutral pose has no matching grip. Restore the
        // complete holding assembly together before introducing a gait,
        // just as Neutral -> Animated Preview already does.
        if (fromNeutral) walk.captureSource();
        walk.start(mode === "animated");
        returningFromWalk = mode === "animated";
        blink.restart();
      } else {
        walk.stop();
        modes.setMode(mode);
        if (mode === "animated") blink.restart();
      }
      hopPose.apply(
        controller.actionActive,
        mode === "animated" && !walk.active,
      );
      gripSupport.reset();
      if (mode !== "neutral") gripSupport.apply(walk.active);
      return result;
    },
    /** Pause/resume preview or walking, including blink and transitions; @returns {object} this rig. */
    setPlaying(playing) {
      requireActive();
      if (typeof playing !== "boolean")
        throw new TypeError("Playing must be boolean");
      if (returningFromWalk || modes.mode === "walk") walk.playing = playing;
      else if (modes.mode === "animated") {
        if (playing) controller.play();
        else controller.pause();
      }
      return result;
    },
    /** Cancel one-shots and restart idle/blink/countdowns; static modes stay still; @returns {object} this rig. */
    restart() {
      requireActive();
      if (modes.mode === "walk" || modes.mode === "animated") {
        expression.reset();
        blink.restart();
        returningFromWalk = false;
      }
      if (modes.mode === "walk") {
        controller.stop();
        walk.restart();
        blink.restart();
      } else if (modes.mode === "animated") {
        walk.stop();
        controller.restart();
      }
      hopPose.apply(
        controller.actionActive,
        modes.mode === "animated" && !walk.active,
      );
      gripSupport.reset();
      if (modes.mode !== "neutral") gripSupport.apply(walk.active);
      return result;
    },
    /** Release owned buffers once, never the borrowed context/program; @returns {void}. */
    dispose() {
      if (disposed) return;
      walk.stop();
      controller.dispose();
      blink.dispose();
      for (const bundle of registry.values())
        for (const name of ["positionBuffer", "normalBuffer", "indexBuffer"])
          gl.deleteBuffer(bundle[name]);
      registry.clear();
      for (const mesh of character.resources.meshes) mesh.dispose();
      disposed = true;
    },
  };
  result.setMode("animated");
  return result;
}
