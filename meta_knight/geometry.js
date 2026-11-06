var GEOMETRY = {
    // Fungsi pembantu warna
    COLOR_WHITE: [1, 1, 1],
    
    // Mesin utama untuk mengenerate mesh berdasarkan fungsi parametrik matematis
    generateParametric: function(func, numU, numV, colorCallback, skipCondition) {
        var vertices = [];
        var indices = [];
        var epsilon = 0.001;

        var clamp = function(val) {
            return Math.min(0.996, Math.max(0.004, val));
        };

        // Generate Vertices, Normals, and Colors
        for (var j = 0; j <= numV; j++) {
            for (var i = 0; i <= numU; i++) {
                var u = i / numU;
                var v = j / numV;
                var p = func(u, v);
                
                // Kalkulasi normal secara analitis menggunakan limit diferensial
                var vClamped = clamp(v);
                var pU1 = func(u + epsilon, vClamped);
                var pU2 = func(u - epsilon, vClamped);
                var pV1 = func(u, vClamped + epsilon);
                var pV2 = func(u, vClamped - epsilon);

                var dU = [pU1[0] - pU2[0], pU1[1] - pU2[1], pU1[2] - pU2[2]];
                var dV = [pV1[0] - pV2[0], pV1[1] - pV2[1], pV1[2] - pV2[2]];

                // Cross product untuk normal
                var nX = dU[1] * dV[2] - dU[2] * dV[1];
                var nY = dU[2] * dV[0] - dU[0] * dV[2];
                var nZ = dU[0] * dV[1] - dU[1] * dV[0];
                var len = Math.sqrt(nX*nX + nY*nY + nZ*nZ);
                var normal = len > 1e-12 ? [nX/len, nY/len, nZ/len] : [0, 1, 0];

                // Warna per-vertex
                var col = (typeof colorCallback === 'function') ? colorCallback(u, v, p) : colorCallback;

                vertices.push(p[0], p[1], p[2], normal[0], normal[1], normal[2], col[0], col[1], col[2]);
            }
        }

        // Generate Indices
        for (var j = 0; j < numV; j++) {
            for (var i = 0; i < numU; i++) {
                var a = j * (numU + 1) + i;
                var b = a + 1;
                var c = a + numU + 1;
                var d = c + 1;

                // Logika Boolean CSG: Melewatkan index jika area tersebut harus dilubangi (misal: topeng)
                if (skipCondition) {
                    var centerPoint = [0, 0, 0];
                    [a, b, c, d].forEach(function(idx) {
                        centerPoint[0] += vertices[idx * 9 + 0] / 4;
                        centerPoint[1] += vertices[idx * 9 + 1] / 4;
                        centerPoint[2] += vertices[idx * 9 + 2] / 4;
                    });
                    if (skipCondition(centerPoint)) continue;
                }

                indices.push(a, c, b, b, c, d);
            }
        }

        return { vertices: vertices, indices: indices };
    },

    // Menggabungkan beberapa bagian jaring menjadi satu objek (misal: silinder + tutup atas bawah)
    mergeMeshes: function(meshes) {
        var mergedVertices = [];
        var mergedIndices = [];
        
        meshes.forEach(function(mesh) {
            var offset = mergedVertices.length / 9;
            mergedVertices.push.apply(mergedVertices, mesh.vertices);
            mesh.indices.forEach(function(idx) {
                mergedIndices.push(idx + offset);
            });
        });
        return { vertices: mergedVertices, indices: mergedIndices };
    },

    // Evaluasi 3D Bezier Curve
    evaluateBezier: function(P, t) {
        var a = Math.pow(1 - t, 3);
        var b = 3 * t * Math.pow(1 - t, 2);
        var c = 3 * Math.pow(t, 2) * (1 - t);
        var d = Math.pow(t, 3);
        return [
            a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0],
            a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1],
            a * P[0][2] + b * P[1][2] + c * P[2][2] + d * P[3][2]
        ];
    },

    // Evaluasi Catmull-Rom Spline untuk mesh sayap bergelombang
    evaluateCatmullRomSpline: function(points, resolution) {
        var out = [];
        var n = points.length;
        for (var i = 0; i < n; i++) {
            var p0 = points[(i + n - 1) % n];
            var p1 = points[i];
            var p2 = points[(i + 1) % n];
            var p3 = points[(i + 2) % n];
            
            var m0 = p1[2] !== undefined && p1[2] ? [0,0] : [(p2[0]-p0[0])*0.5, (p2[1]-p0[1])*0.5];
            var m1 = p2[2] !== undefined && p2[2] ? [0,0] : [(p3[0]-p1[0])*0.5, (p3[1]-p1[1])*0.5];
            
            for (var k = 0; k < resolution; k++) {
                var s = k / resolution;
                var s2 = s * s;
                var s3 = s2 * s;
                
                var h1 =  2*s3 - 3*s2 + 1;
                var h2 = -2*s3 + 3*s2;
                var h3 =  s3 - 2*s2 + s;
                var h4 =  s3 - s2;
                
                out.push([
                    h1*p1[0] + h2*p2[0] + h3*m0[0] + h4*m1[0],
                    h1*p1[1] + h2*p2[1] + h3*m0[1] + h4*m1[1]
                ]);
            }
        }
        return out;
    },

    /*=================== GENERATOR QUADRIC OBJECT ===================*/

    createEllipsoid: function(rx, ry, rz, color, options) {
        options = options || {};
        var cx = options.cx || 0, cy = options.cy || 0, cz = options.cz || 0;
        var startAngle = options.startAngle || 0, endAngle = options.endAngle || Math.PI * 2;
        var numU = options.numU || 40, numV = options.numV || 26;

        return GEOMETRY.generateParametric(function(u, v) {
            var theta = startAngle + (endAngle - startAngle) * u;
            var phi = v * Math.PI;
            return [
                cx + rx * Math.sin(phi) * Math.cos(theta),
                cy + ry * Math.cos(phi),
                cz + rz * Math.sin(phi) * Math.sin(theta)
            ];
        }, numU, numV, color, options.skipCondition);
    },

    createEllipticParaboloid: function(color) {
        return GEOMETRY.generateParametric(function(u, v) {
            return [
                v * Math.cos(u * Math.PI * 2),
                1 - v * v, // Persamaan Paraboloid
                v * Math.sin(u * Math.PI * 2)
            ];
        }, 40, 16, color);
    },

    createCylinder: function(color) {
        var body = GEOMETRY.generateParametric(function(u, v) {
            return [Math.cos(u * Math.PI * 2), v - 0.5, Math.sin(u * Math.PI * 2)];
        }, 32, 1, color);
        
        var capTop = GEOMETRY.generateParametric(function(u, v) { return [v * Math.cos(u * Math.PI * 2), 0.5, v * Math.sin(u * Math.PI * 2)]; }, 32, 4, color);
        var capBot = GEOMETRY.generateParametric(function(u, v) { return [v * Math.cos(u * Math.PI * 2), -0.5, v * Math.sin(u * Math.PI * 2)]; }, 32, 4, color);
        
        return GEOMETRY.mergeMeshes([body, capTop, capBot]);
    },

    createCone: function(color) {
        var body = GEOMETRY.generateParametric(function(u, v) {
            return [(1 - v) * Math.cos(u * Math.PI * 2), v, (1 - v) * Math.sin(u * Math.PI * 2)];
        }, 32, 8, color);
        
        var base = GEOMETRY.generateParametric(function(u, v) { return [v * Math.cos(u * Math.PI * 2), 0, v * Math.sin(u * Math.PI * 2)]; }, 32, 4, color);
        
        return GEOMETRY.mergeMeshes([body, base]);
    },

    createTube: function(curveFunc, radiusFunc, color) {
        return GEOMETRY.generateParametric(function(u, v) {
            var p = curveFunc(v);
            var q = curveFunc(v + 0.002);
            
            var t = [q[0]-p[0], q[1]-p[1], q[2]-p[2]];
            var tLen = Math.sqrt(t[0]*t[0] + t[1]*t[1] + t[2]*t[2]);
            t = [t[0]/tLen, t[1]/tLen, t[2]/tLen];
            
            var n = [t[1], -t[0], 0];
            var nLen = Math.sqrt(n[0]*n[0] + n[1]*n[1] + n[2]*n[2]) || 1;
            n = [n[0]/nLen, n[1]/nLen, n[2]/nLen];
            
            var b = [
                t[1]*n[2] - t[2]*n[1],
                t[2]*n[0] - t[0]*n[2],
                t[0]*n[1] - t[1]*n[0]
            ];
            
            var r = Math.max(0, radiusFunc(v));
            var a = u * Math.PI * 2;
            
            return [
                p[0] + r * (Math.cos(a)*n[0] + Math.sin(a)*b[0]),
                p[1] + r * (Math.cos(a)*n[1] + Math.sin(a)*b[1]),
                p[2] + r * (Math.cos(a)*n[2] + Math.sin(a)*b[2])
            ];
        }, 12, 30, color);
    },

    createPlate: function(points, center, color, heightFunc, numV) {
        var spline = GEOMETRY.evaluateCatmullRomSpline(points, 8);
        var n = spline.length;
        
        return GEOMETRY.generateParametric(function(u, v) {
            var w = (((u % 1) + 1) % 1) * n;
            var i = Math.floor(w);
            var f = w - i;
            var a = spline[i % n];
            var b = spline[(i + 1) % n];
            
            return [
                center[0] + v * (a[0] + (b[0] - a[0]) * f - center[0]),
                center[1] + v * (a[1] + (b[1] - a[1]) * f - center[1]),
                heightFunc * (1 - v * v)
            ];
        }, n, numV || 10, color);
    },

    // Logika Celah Mata Topeng
    maskSlitCondition: function(x, y, margin) {
        margin = margin || 0;
        var width = 0.7;
        if (Math.abs(x) > width + margin) return false;
        
        var t = Math.min(1, Math.max(0, (x + width) / (2 * width)));
        var quad = (1 - t) * (1 - t);
        var r = 2 * t * (1 - t);
        var s = t * t;
        
        var yUpper = 0.3 * quad - 0.05 * r + 0.3 * s;
        var yLower = 0.3 * quad - 0.75 * r + 0.3 * s;
        
        return y < yUpper + margin && y > yLower - margin;
    }
};