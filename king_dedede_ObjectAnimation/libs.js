/**
 * libs.js
 * Library Matematika 3D, Matriks 4x4, Transformasi Sumbu Sembarang (Arbitrary Axis),
 * serta Evaluator Kurva 3D Cubic Bezier untuk Proyek Grafika Komputer WebGL - King Dedede.
 */

const Libs = {
    // --- Utilitas Sudut & Vektor ---
    degToRad: function(deg) {
        return deg * Math.PI / 180.0;
    },

    vec3: {
        create: function(x = 0, y = 0, z = 0) {
            return [x, y, z];
        },
        add: function(a, b) {
            return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
        },
        sub: function(a, b) {
            return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        },
        scale: function(a, s) {
            return [a[0] * s, a[1] * s, a[2] * s];
        },
        dot: function(a, b) {
            return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        },
        cross: function(a, b) {
            return [
                a[1] * b[2] - a[2] * b[1],
                a[2] * b[0] - a[0] * b[2],
                a[0] * b[1] - a[1] * b[0]
            ];
        },
        normalize: function(a) {
            const len = Math.hypot(a[0], a[1], a[2]);
            if (len < 1e-6) return [0, 1, 0];
            return [a[0] / len, a[1] / len, a[2] / len];
        }
    },

    // --- Operasi Matriks 4x4 (Column-Major sesuai standar WebGL) ---
    mat4: {
        create: function() {
            const out = new Float32Array(16);
            out[0] = 1; out[5] = 1; out[10] = 1; out[15] = 1;
            return out;
        },

        identity: function(out) {
            out.fill(0);
            out[0] = 1; out[5] = 1; out[10] = 1; out[15] = 1;
            return out;
        },

        clone: function(a) {
            return new Float32Array(a);
        },

        copy: function(out, a) {
            out.set(a);
            return out;
        },

        multiply: function(out, a, b) {
            const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
            const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
            const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
            const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

            let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
            out[0] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
            out[1] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
            out[2] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
            out[3] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

            b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
            out[4] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
            out[5] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
            out[6] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
            out[7] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

            b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
            out[8]  = b0*a00 + b1*a10 + b2*a20 + b3*a30;
            out[9]  = b0*a01 + b1*a11 + b2*a21 + b3*a31;
            out[10] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
            out[11] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

            b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
            out[12] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
            out[13] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
            out[14] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
            out[15] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
            return out;
        },

        // Syarat Transformasi: Translate
        translate: function(out, a, v) {
            const x = v[0], y = v[1], z = v[2];
            if (a === out) {
                out[12] = a[0]*x + a[4]*y + a[8]*z + a[12];
                out[13] = a[1]*x + a[5]*y + a[9]*z + a[13];
                out[14] = a[2]*x + a[6]*y + a[10]*z + a[14];
                out[15] = a[3]*x + a[7]*y + a[11]*z + a[15];
            } else {
                const t = Libs.mat4.create();
                t[12] = x; t[13] = y; t[14] = z;
                Libs.mat4.multiply(out, a, t);
            }
            return out;
        },

        // Syarat Transformasi: Scaling
        scale: function(out, a, v) {
            const x = v[0], y = v[1], z = v[2];
            out[0] = a[0] * x; out[1] = a[1] * x; out[2] = a[2] * x; out[3] = a[3] * x;
            out[4] = a[4] * y; out[5] = a[5] * y; out[6] = a[6] * y; out[7] = a[7] * y;
            out[8] = a[8] * z; out[9] = a[9] * z; out[10] = a[10] * z; out[11] = a[11] * z;
            out[12] = a[12];   out[13] = a[13];   out[14] = a[14];   out[15] = a[15];
            return out;
        },

        // Syarat Transformasi: Rotate (Sumbu X, Y, Z)
        rotateX: function(out, a, rad) {
            const s = Math.sin(rad), c = Math.cos(rad);
            const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
            const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
            if (a !== out) {
                out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; out[3] = a[3];
                out[12] = a[12]; out[13] = a[13]; out[14] = a[14]; out[15] = a[15];
            }
            out[4] = a10 * c + a20 * s;
            out[5] = a11 * c + a21 * s;
            out[6] = a12 * c + a22 * s;
            out[7] = a13 * c + a23 * s;
            out[8] = a20 * c - a10 * s;
            out[9] = a21 * c - a11 * s;
            out[10] = a22 * c - a12 * s;
            out[11] = a23 * c - a13 * s;
            return out;
        },

        rotateY: function(out, a, rad) {
            const s = Math.sin(rad), c = Math.cos(rad);
            const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
            const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
            if (a !== out) {
                out[4] = a[4]; out[5] = a[5]; out[6] = a[6]; out[7] = a[7];
                out[12] = a[12]; out[13] = a[13]; out[14] = a[14]; out[15] = a[15];
            }
            out[0] = a00 * c - a20 * s;
            out[1] = a01 * c - a21 * s;
            out[2] = a02 * c - a22 * s;
            out[3] = a03 * c - a23 * s;
            out[8] = a00 * s + a20 * c;
            out[9] = a01 * s + a21 * c;
            out[10] = a02 * s + a22 * c;
            out[11] = a03 * s + a23 * c;
            return out;
        },

        rotateZ: function(out, a, rad) {
            const s = Math.sin(rad), c = Math.cos(rad);
            const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
            const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
            if (a !== out) {
                out[8] = a[8]; out[9] = a[9]; out[10] = a[10]; out[11] = a[11];
                out[12] = a[12]; out[13] = a[13]; out[14] = a[14]; out[15] = a[15];
            }
            out[0] = a00 * c + a10 * s;
            out[1] = a01 * c + a11 * s;
            out[2] = a02 * c + a12 * s;
            out[3] = a03 * c + a13 * s;
            out[4] = a10 * c - a00 * s;
            out[5] = a11 * c - a01 * s;
            out[6] = a12 * c - a02 * s;
            out[7] = a13 * c - a03 * s;
            return out;
        },

        /**
         * Syarat Transformasi: Rotate Arbitrary Axis (Formula Rotasi Rodrigues dalam Matriks 4x4)
         * Memutar matriks terhadap garis/sumbu sembarang yang melewati titik pivot (atau origin)
         * dengan vektor arah axis = [ux, uy, uz].
         */
        rotateArbitraryAxis: function(out, a, rad, axis, pivot = [0, 0, 0]) {
            let [x, y, z] = axis;
            let len = Math.hypot(x, y, z);
            if (len < 1e-6) return out;
            x /= len; y /= len; z /= len;

            const s = Math.sin(rad);
            const c = Math.cos(rad);
            const t = 1 - c;

            // Matriks rotasi Rodrigues
            const r = Libs.mat4.create();
            r[0] = x * x * t + c;     r[1] = y * x * t + z * s; r[2] = z * x * t - y * s; r[3] = 0;
            r[4] = x * y * t - z * s; r[5] = y * y * t + c;     r[6] = z * y * t + x * s; r[7] = 0;
            r[8] = x * z * t + y * s; r[9] = y * z * t - x * s; r[10] = z * z * t + c;    r[11] = 0;

            const hasPivot = (pivot[0] !== 0 || pivot[1] !== 0 || pivot[2] !== 0);
            if (hasPivot) {
                Libs.mat4.translate(out, a, pivot);
                Libs.mat4.multiply(out, out, r);
                Libs.mat4.translate(out, out, [-pivot[0], -pivot[1], -pivot[2]]);
            } else {
                Libs.mat4.multiply(out, a, r);
            }
            return out;
        },

        perspective: function(out, fovy, aspect, near, far) {
            const f = 1.0 / Math.tan(fovy / 2);
            out.fill(0);
            out[0] = f / aspect;
            out[5] = f;
            out[10] = (far + near) / (near - far);
            out[11] = -1;
            out[14] = (2 * far * near) / (near - far);
            return out;
        },

        lookAt: function(out, eye, center, up) {
            const z = Libs.vec3.normalize(Libs.vec3.sub(eye, center));
            const x = Libs.vec3.normalize(Libs.vec3.cross(up, z));
            const y = Libs.vec3.normalize(Libs.vec3.cross(z, x));

            out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
            out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
            out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
            out[12] = -Libs.vec3.dot(x, eye);
            out[13] = -Libs.vec3.dot(y, eye);
            out[14] = -Libs.vec3.dot(z, eye);
            out[15] = 1;
            return out;
        },

        // Menghitung Normal Matrix (Inverse Transpose 3x3 dari Model Matrix)
        normalMatrix: function(out, m) {
            const a00 = m[0], a01 = m[1], a02 = m[2];
            const a10 = m[4], a11 = m[5], a12 = m[6];
            const a20 = m[8], a21 = m[9], a22 = m[10];

            const b01 = a22 * a11 - a12 * a21;
            const b11 = -a22 * a10 + a12 * a20;
            const b21 = a21 * a10 - a11 * a20;

            let det = a00 * b01 + a01 * b11 + a02 * b21;
            if (!det) return out;
            det = 1.0 / det;

            out[0] = b01 * det;
            out[1] = (-a22 * a01 + a02 * a21) * det;
            out[2] = (a12 * a01 - a02 * a11) * det;
            out[3] = b11 * det;
            out[4] = (a22 * a00 - a02 * a20) * det;
            out[5] = (-a12 * a00 + a02 * a10) * det;
            out[6] = b21 * det;
            out[7] = (-a21 * a00 + a01 * a20) * det;
            out[8] = (a11 * a00 - a01 * a10) * det;
            return out;
        }
    },

    // --- Evaluator Kurva 3D Cubic Bezier ---
    bezier3D: {
        // B(t) = (1-t)^3 P0 + 3(1-t)^2 t P1 + 3(1-t) t^2 P2 + t^3 P3
        getPoint: function(t, p0, p1, p2, p3) {
            const u = 1 - t;
            const b0 = u * u * u;
            const b1 = 3 * u * u * t;
            const b2 = 3 * u * t * t;
            const b3 = t * t * t;
            return [
                b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0],
                b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1],
                b0 * p0[2] + b1 * p1[2] + b2 * p2[2] + b3 * p3[2]
            ];
        },

        // Turunan pertama B'(t) untuk vektor singgung (tangent) kurva 3D
        getTangent: function(t, p0, p1, p2, p3) {
            const u = 1 - t;
            const d0 = -3 * u * u;
            const d1 = 3 * u * u - 6 * u * t;
            const d2 = 6 * u * t - 3 * t * t;
            const d3 = 3 * t * t;
            const tx = d0 * p0[0] + d1 * p1[0] + d2 * p2[0] + d3 * p3[0];
            const ty = d0 * p0[1] + d1 * p1[1] + d2 * p2[1] + d3 * p3[1];
            const tz = d0 * p0[2] + d1 * p1[2] + d2 * p2[2] + d3 * p3[2];
            return Libs.vec3.normalize([tx, ty, tz]);
        }
    }
};

window.Libs = Libs;
