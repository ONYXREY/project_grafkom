export const GeometryGenerator = {
    /**
     * Catatan=
     * OBJECT 1: Ellipsoid
     * Persamaan: (x/a)^2 + (y/b)^2 + (z/c)^2 = 1
     */
    createEllipsoid: function(a, b, c, stacks = 24, sectors = 36, phiMin = -Math.PI / 2, phiMax = Math.PI / 2) {
        const vertices = [];
        const normals = [];
        const indices = [];

        for (let i = 0; i <= stacks; ++i) {
            const v = i / stacks;
            const phi = phiMin + v * (phiMax - phiMin);
            const cosPhi = Math.cos(phi);
            const sinPhi = Math.sin(phi);

            for (let j = 0; j <= sectors; ++j) {
                const u = j / sectors;
                const theta = u * 2.0 * Math.PI;
                const cosTheta = Math.cos(theta);
                const sinTheta = Math.sin(theta);

                const x = a * cosPhi * cosTheta;
                const y = b * sinPhi;
                const z = c * cosPhi * sinTheta;
                vertices.push(x, y, z);

                const nx = cosPhi * cosTheta / a;
                const ny = sinPhi / b;
                const nz = cosPhi * sinTheta / c;
                const n = Libs.vec3.normalize([nx, ny, nz]);
                normals.push(n[0], n[1], n[2]);
            }
        }

        for (let i = 0; i < stacks; ++i) {
            let k1 = i * (sectors + 1);
            let k2 = k1 + sectors + 1;
            for (let j = 0; j < sectors; ++j, ++k1, ++k2) {
                indices.push(k1, k2, k1 + 1);
                indices.push(k1 + 1, k2, k2 + 1);
            }
        }

        return { vertices, normals, indices };
    },

    /**
     * OBJECT 2: Cylinder
     */
    createCylinder: function(rTop, rBottom, height, stacks = 16, sectors = 36, closed = true) {
        const vertices = [];
        const normals = [];
        const indices = [];
        const halfH = height / 2.0;

        for (let i = 0; i <= stacks; ++i) {
            const v = i / stacks;
            const y = -halfH + v * height;
            const r = rBottom + v * (rTop - rBottom);
            const slope = (rBottom - rTop) / height;

            for (let j = 0; j <= sectors; ++j) {
                const u = j / sectors;
                const theta = u * 2.0 * Math.PI;
                const cosTheta = Math.cos(theta);
                const sinTheta = Math.sin(theta);

                const x = r * cosTheta;
                const z = r * sinTheta;
                vertices.push(x, y, z);

                const n = Libs.vec3.normalize([cosTheta, slope, sinTheta]);
                normals.push(n[0], n[1], n[2]);
            }
        }

        for (let i = 0; i < stacks; ++i) {
            let k1 = i * (sectors + 1);
            let k2 = k1 + sectors + 1;
            for (let j = 0; j < sectors; ++j, ++k1, ++k2) {
                indices.push(k1, k1 + 1, k2);
                indices.push(k1 + 1, k2 + 1, k2);
            }
        }

        if (closed) {
            const topCenterIdx = vertices.length / 3;
            vertices.push(0, halfH, 0);
            normals.push(0, 1, 0);
            for (let j = 0; j <= sectors; ++j) {
                const theta = (j / sectors) * 2.0 * Math.PI;
                vertices.push(rTop * Math.cos(theta), halfH, rTop * Math.sin(theta));
                normals.push(0, 1, 0);
            }
            for (let j = 0; j < sectors; ++j) {
                indices.push(topCenterIdx, topCenterIdx + j + 2, topCenterIdx + j + 1);
            }

            const botCenterIdx = vertices.length / 3;
            vertices.push(0, -halfH, 0);
            normals.push(0, -1, 0);
            for (let j = 0; j <= sectors; ++j) {
                const theta = (j / sectors) * 2.0 * Math.PI;
                vertices.push(rBottom * Math.cos(theta), -halfH, rBottom * Math.sin(theta));
                normals.push(0, -1, 0);
            }
            for (let j = 0; j < sectors; ++j) {
                indices.push(botCenterIdx, botCenterIdx + j + 1, botCenterIdx + j + 2);
            }
        }

        return { vertices, normals, indices };
    },

    /**
     * OBJECT 2 : Sabuk Perut 
     */
    createZigZagBelt: function(rx, rz, height, stacks = 12, sectors = 48) {
        const vertices = [];
        const normals = [];
        const colors = [];
        const indices = [];
        const halfH = height / 2.0;

        const red = [0.88, 0.12, 0.15];
        const yellow = [0.98, 0.82, 0.12];
        const borderGold = [0.90, 0.68, 0.08];

        for (let i = 0; i <= stacks; ++i) {
            const v = i / stacks;
            const y = -halfH + v * height;
            const bulge = 1.0 + 0.04 * Math.sin(v * Math.PI);

            for (let j = 0; j <= sectors; ++j) {
                const u = j / sectors;
                const theta = u * 2.0 * Math.PI;
                const cosT = Math.cos(theta);
                const sinT = Math.sin(theta);

                const x = rx * bulge * cosT;
                const z = rz * bulge * sinT;
                vertices.push(x, y, z);

                const n = Libs.vec3.normalize([cosT / rx, 0, sinT / rz]);
                normals.push(n[0], n[1], n[2]);

                if (v < 0.12 || v > 0.88) {
                    colors.push(...borderGold);
                } else {
                    const normalizedV = (v - 0.12) / 0.76;
                    const periods = 10.0;
                    const phase = (u * periods) % 1.0;
                    const triWave = phase < 0.5 ? (phase * 2.0) : (2.0 - phase * 2.0);
                    const c = (normalizedV > triWave) ? red : yellow;
                    colors.push(...c);
                }
            }
        }

        for (let i = 0; i < stacks; ++i) {
            let k1 = i * (sectors + 1);
            let k2 = k1 + sectors + 1;
            for (let j = 0; j < sectors; ++j, ++k1, ++k2) {
                indices.push(k1, k1 + 1, k2);
                indices.push(k1 + 1, k2 + 1, k2);
            }
        }

        return { vertices, normals, colors, indices };
    },

    /**
     * OBJECT 3 (Quadric 1): Elliptic Paraboloid
     * Persamaan Kuadrik: y / c = (x / a)^2 + (z / b)^2
     */
    createEllipticParaboloid: function(a, b, c, stacks = 20, sectors = 36, capped = true) {
        const vertices = [];
        const normals = [];
        const indices = [];

        for (let i = 0; i <= stacks; ++i) {
            const u = i / stacks;
            const y = c * (1.0 - u * u);

            for (let j = 0; j <= sectors; ++j) {
                const theta = (j / sectors) * 2.0 * Math.PI;
                const cosT = Math.cos(theta);
                const sinT = Math.sin(theta);

                const x = a * u * cosT;
                const z = b * u * sinT;
                vertices.push(x, y, z);

                const nx = (2.0 * u * cosT) / a;
                const ny = 1.0 / c;
                const nz = (2.0 * u * sinT) / b;
                const n = Libs.vec3.normalize([nx, ny, nz]);
                normals.push(n[0], n[1], n[2]);
            }
        }

        for (let i = 0; i < stacks; ++i) {
            let k1 = i * (sectors + 1);
            let k2 = k1 + sectors + 1;
            for (let j = 0; j < sectors; ++j, ++k1, ++k2) {
                indices.push(k1, k2, k1 + 1);
                indices.push(k1 + 1, k2, k2 + 1);
            }
        }

        if (capped) {
            const baseCenterIdx = vertices.length / 3;
            vertices.push(0, 0, 0);
            normals.push(0, -1, 0);
            for (let j = 0; j <= sectors; ++j) {
                const theta = (j / sectors) * 2.0 * Math.PI;
                vertices.push(a * Math.cos(theta), 0, b * Math.sin(theta));
                normals.push(0, -1, 0);
            }
            for (let j = 0; j < sectors; ++j) {
                indices.push(baseCenterIdx, baseCenterIdx + j + 1, baseCenterIdx + j + 2);
            }
        }

        return { vertices, normals, indices };
    },

    /**
     * OBJECT 3 (Quadric 2): Cone (Kerucut Kuadrik)
     * Persamaan Kuadrik: (y / c)^2 = (x / a)^2 + (z / b)^2
     */
    createCone: function(a, b, c, stacks = 16, sectors = 28) {
        const vertices = [];
        const normals = [];
        const indices = [];

        for (let i = 0; i <= stacks; ++i) {
            const u = i / stacks;
            const y = c * (1.0 - u);

            for (let j = 0; j <= sectors; ++j) {
                const theta = (j / sectors) * 2.0 * Math.PI;
                const cosT = Math.cos(theta);
                const sinT = Math.sin(theta);

                const x = a * u * cosT;
                const z = b * u * sinT;
                vertices.push(x, y, z);

                const nx = cosT / a;
                const ny = 1.0 / c;
                const nz = sinT / b;
                const n = Libs.vec3.normalize([nx, ny, nz]);
                normals.push(n[0], n[1], n[2]);
            }
        }

        for (let i = 0; i < stacks; ++i) {
            let k1 = i * (sectors + 1);
            let k2 = k1 + sectors + 1;
            for (let j = 0; j < sectors; ++j, ++k1, ++k2) {
                indices.push(k1, k2, k1 + 1);
                indices.push(k1 + 1, k2, k2 + 1);
            }
        }

        return { vertices, normals, indices };
    },

    /**
     * OBJECT 3 (Quadric 3): Hyperboloid of 1 Sheet
     * Persamaan Kuadrik: (x / a)^2 + (z / b)^2 - (y / c)^2 = 1
     */
    createHyperboloidOneSheet: function(a, b, c, vMin = -1.35, vMax = 0.25, stacks = 24, sectors = 40, thetaStart = 0, thetaEnd = 2 * Math.PI, thickness = 0.08) {
        const vertices = [];
        const normals = [];
        const indices = [];

        for (let i = 0; i <= stacks; ++i) {
            const t = i / stacks;
            const v = vMin + t * (vMax - vMin);
            const y = c * v;
            const factor = Math.sqrt(1.0 + v * v);

            for (let j = 0; j <= sectors; ++j) {
                const s = j / sectors;
                const theta = thetaStart + s * (thetaEnd - thetaStart);
                const cosT = Math.cos(theta);
                const sinT = Math.sin(theta);

                const x = a * factor * cosT;
                const z = b * factor * sinT;
                vertices.push(x, y, z);

                const nx = (factor * cosT) / a;
                const ny = -v / c;
                const nz = (factor * sinT) / b;
                const n = Libs.vec3.normalize([nx, ny, nz]);
                normals.push(n[0], n[1], n[2]);
            }
        }

        for (let i = 0; i < stacks; ++i) {
            let k1 = i * (sectors + 1);
            let k2 = k1 + sectors + 1;
            for (let j = 0; j < sectors; ++j, ++k1, ++k2) {
                indices.push(k1, k1 + 1, k2);
                indices.push(k1 + 1, k2 + 1, k2);
            }
        }

        if (thickness > 0) {
            const offset = vertices.length / 3;
            for (let i = 0; i <= stacks; ++i) {
                const t = i / stacks;
                const v = vMin + t * (vMax - vMin);
                const y = c * v;
                const factor = Math.max(0.1, Math.sqrt(1.0 + v * v) - thickness);

                for (let j = 0; j <= sectors; ++j) {
                    const s = j / sectors;
                    const theta = thetaStart + s * (thetaEnd - thetaStart);
                    const cosT = Math.cos(theta);
                    const sinT = Math.sin(theta);

                    const x = a * factor * cosT;
                    const z = b * factor * sinT;
                    vertices.push(x, y, z);

                    const nx = -(factor * cosT) / a;
                    const ny = v / c;
                    const nz = -(factor * sinT) / b;
                    const n = Libs.vec3.normalize([nx, ny, nz]);
                    normals.push(n[0], n[1], n[2]);
                }
            }

            for (let i = 0; i < stacks; ++i) {
                let k1 = offset + i * (sectors + 1);
                let k2 = k1 + sectors + 1;
                for (let j = 0; j < sectors; ++j, ++k1, ++k2) {
                    indices.push(k1, k2, k1 + 1);
                    indices.push(k1 + 1, k2, k2 + 1);
                }
            }
        }

        return { vertices, normals, indices };
    },

    /**
     * SYARAT 3D CURVE (Di Karakter): 3D Cubic Bezier Tube
     */
    createBezierTube: function(p0, p1, p2, p3, baseRadius, tubularSegments = 32, radialSegments = 16, puffFreq = 0) {
        const vertices = [];
        const normals = [];
        const indices = [];

        for (let i = 0; i <= tubularSegments; ++i) {
            const t = i / tubularSegments;
            const center = Libs.bezier3D.getPoint(t, p0, p1, p2, p3);
            const tangent = Libs.bezier3D.getTangent(t, p0, p1, p2, p3);

            let up = [0, 1, 0];
            if (Math.abs(Libs.vec3.dot(tangent, up)) > 0.92) {
                up = [1, 0, 0];
            }
            const binormal = Libs.vec3.normalize(Libs.vec3.cross(tangent, up));
            const normal = Libs.vec3.normalize(Libs.vec3.cross(binormal, tangent));

            let r = baseRadius;
            if (puffFreq > 0) {
                r = baseRadius * (1.0 + 0.14 * Math.sin(t * Math.PI * puffFreq));
            } else if (puffFreq < 0) {
                r = baseRadius * (1.0 - 0.35 * Math.pow(2.0 * t - 1.0, 2));
            }

            for (let j = 0; j <= radialSegments; ++j) {
                const theta = (j / radialSegments) * 2.0 * Math.PI;
                const cosT = Math.cos(theta);
                const sinT = Math.sin(theta);

                const nx = cosT * normal[0] + sinT * binormal[0];
                const ny = cosT * normal[1] + sinT * binormal[1];
                const nz = cosT * normal[2] + sinT * binormal[2];

                const vx = center[0] + r * nx;
                const vy = center[1] + r * ny;
                const vz = center[2] + r * nz;

                vertices.push(vx, vy, vz);
                normals.push(nx, ny, nz);
            }
        }

        for (let i = 0; i < tubularSegments; ++i) {
            let k1 = i * (radialSegments + 1);
            let k2 = k1 + radialSegments + 1;
            for (let j = 0; j < radialSegments; ++j, ++k1, ++k2) {
                indices.push(k1, k2, k1 + 1);
                indices.push(k1 + 1, k2, k2 + 1);
            }
        }

        return { vertices, normals, indices };
    }
};

export class Mesh {
    constructor(gl, geomData, baseColor = [1.0, 1.0, 1.0], shininess = 32.0, specularStrength = 0.35) {
        this.gl = gl;
        this.indexCount = geomData.indices.length;
        this.shininess = shininess;
        this.specularStrength = specularStrength;

        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geomData.vertices), gl.STATIC_DRAW);

        this.normalBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geomData.normals), gl.STATIC_DRAW);

        const vertexCount = geomData.vertices.length / 3;
        let colorArray = geomData.colors;
        if (!colorArray) {
            colorArray = new Float32Array(vertexCount * 3);
            for (let i = 0; i < vertexCount; ++i) {
                colorArray[i * 3]     = baseColor[0];
                colorArray[i * 3 + 1] = baseColor[1];
                colorArray[i * 3 + 2] = baseColor[2];
            }
        } else {
            colorArray = new Float32Array(colorArray);
        }
        this.colorBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, colorArray, gl.STATIC_DRAW);

        this.indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geomData.indices), gl.STATIC_DRAW);
    }

    draw(shaderInfo, worldMatrix) {
        const gl = this.gl;

        gl.uniformMatrix4fv(shaderInfo.uniforms.uModelMatrix, false, worldMatrix);
        const normMat = new Float32Array(9);
        Libs.mat4.normalMatrix(normMat, worldMatrix);
        gl.uniformMatrix3fv(shaderInfo.uniforms.uNormalMatrix, false, normMat);

        gl.uniform1f(shaderInfo.uniforms.uShininess, this.shininess);
        gl.uniform1f(shaderInfo.uniforms.uSpecularStrength, this.specularStrength);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.vertexAttribPointer(shaderInfo.attribs.aPosition, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(shaderInfo.attribs.aPosition);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
        gl.vertexAttribPointer(shaderInfo.attribs.aNormal, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(shaderInfo.attribs.aNormal);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        gl.vertexAttribPointer(shaderInfo.attribs.aColor, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(shaderInfo.attribs.aColor);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
    }
}

export class SceneNode {
    constructor(name = "Node") {
        this.name = name;
        this.baseMatrix = Libs.mat4.create();
        this.animMatrix = Libs.mat4.create();
        this.localMatrix = Libs.mat4.create();
        this.worldMatrix = Libs.mat4.create();
        this.meshes = [];
        this.children = [];
    }

    addChild(childNode) {
        this.children.push(childNode);
        return childNode;
    }

    addMesh(mesh, offsetMatrix = null) {
        this.meshes.push({
            mesh: mesh,
            offsetMatrix: offsetMatrix ? Libs.mat4.clone(offsetMatrix) : Libs.mat4.create()
        });
        return this;
    }

    resetAnim() {
        Libs.mat4.identity(this.animMatrix);
    }

    updateAndDraw(shaderInfo, parentWorldMatrix = null) {
        Libs.mat4.multiply(this.localMatrix, this.baseMatrix, this.animMatrix);

        if (parentWorldMatrix) {
            Libs.mat4.multiply(this.worldMatrix, parentWorldMatrix, this.localMatrix);
        } else {
            Libs.mat4.copy(this.worldMatrix, this.localMatrix);
        }

        const meshWorldMat = Libs.mat4.create();
        for (const item of this.meshes) {
            Libs.mat4.multiply(meshWorldMat, this.worldMatrix, item.offsetMatrix);
            item.mesh.draw(shaderInfo, meshWorldMat);
        }

        for (const child of this.children) {
            child.updateAndDraw(shaderInfo, this.worldMatrix);
        }
    }
}