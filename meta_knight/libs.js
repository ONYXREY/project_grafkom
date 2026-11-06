var LIBS = {
    degToRad: function(angle) {
        return angle * Math.PI / 180;
    },

    get_I4: function() {
        return [
            1,0,0,0,
            0,1,0,0,
            0,0,1,0,
            0,0,0,1
        ];
    },

    multiply: function(a, b) {
        var out = new Array(16);
        for (var c = 0; c < 4; c++) {
            for (var r = 0; r < 4; r++) {
                var sum = 0;
                for (var k = 0; k < 4; k++) {
                    sum += a[k * 4 + r] * b[c * 4 + k];
                }
                out[c * 4 + r] = sum;
            }
        }
        return out;
    },

    translate: function(x, y, z) {
        return [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            x, y, z, 1
        ];
    },

    scale: function(x, y, z) {
        if (y === undefined) y = x;
        if (z === undefined) z = x;
        return [
            x, 0, 0, 0,
            0, y, 0, 0,
            0, 0, z, 0,
            0, 0, 0, 1
        ];
    },

    // Rotasi berdasarkan Arbitrary Axis
    rotateArbitrary: function(angle, x, y, z) {
        var len = Math.sqrt(x*x + y*y + z*z);
        if (len < 0.0001) { x = 0; y = 1; z = 0; len = 1; }
        x /= len; y /= len; z /= len;

        var c = Math.cos(angle);
        var s = Math.sin(angle);
        var t = 1 - c;

        return [
            c + x*x*t,       y*x*t + z*s,     z*x*t - y*s,     0,
            x*y*t - z*s,     c + y*y*t,       z*y*t + x*s,     0,
            x*z*t + y*s,     y*z*t - x*s,     c + z*z*t,       0,
            0,               0,               0,               1
        ];
    },

    perspective: function(fovy, aspect, near, far) {
        var f = 1.0 / Math.tan(fovy / 2);
        var rangeInv = 1.0 / (near - far);
        return [
            f / aspect, 0, 0, 0,
            0, f, 0, 0,
            0, 0, (near + far) * rangeInv, -1,
            0, 0, near * far * rangeInv * 2, 0
        ];
    },

    lookAt: function(eye, center, up) {
        var normalize = function(v) {
            var len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
            return [v[0]/len, v[1]/len, v[2]/len];
        };
        var cross = function(a, b) {
            return [
                a[1]*b[2] - a[2]*b[1],
                a[2]*b[0] - a[0]*b[2],
                a[0]*b[1] - a[1]*b[0]
            ];
        };
        var dot = function(a, b) {
            return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
        };

        var z = normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
        var x = normalize(cross(up, z));
        var y = cross(z, x);

        return [
            x[0], y[0], z[0], 0,
            x[1], y[1], z[1], 0,
            x[2], y[2], z[2], 0,
            -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
        ];
    },

    // Mengkalkulasi Normal Matrix untuk shading
    inverseTranspose3x3: function(m) {
        var out = [];
        var getVal = function(r, c) { return m[c * 4 + r]; };
        for (var j = 0; j < 3; j++) {
            for (var i = 0; i < 3; i++) {
                var row = [0, 1, 2].filter(function(x) { return x !== i; });
                var col = [0, 1, 2].filter(function(x) { return x !== j; });
                var det2x2 = getVal(row[0], col[0]) * getVal(row[1], col[1]) - getVal(row[0], col[1]) * getVal(row[1], col[0]);
                var sign = ((i + j) % 2 !== 0) ? -1 : 1;
                out.push(sign * det2x2);
            }
        }
        return out;
    }
};