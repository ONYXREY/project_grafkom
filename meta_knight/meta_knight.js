/**
 * meta_knight/meta_knight.js
 * Modul Wrapper ES6 untuk Karakter ke-3 (Meta Knight).
 * Membungkus shader, buffer mesh, dan hierarki animasi dari meta_knight/main.js
 * agar dapat dirender bersama Kirby, King Dedede, dan Environment dalam 1 frame WebGL.
 */

export function initMetaKnight(GL) {
    const shader_vertex_source = `
        attribute vec3 position;
        attribute vec3 normal;
        attribute vec3 color;
        
        uniform mat4 Mmatrix;
        uniform mat4 VPmatrix;
        uniform mat3 NMmatrix;
        uniform vec3 uTint;
        
        uniform float uTime;
        uniform float uWave;
        
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        varying vec3 vColor;
        
        void main(void) {
            vec3 pos = position;
            
            // Animasi Gelombang pada Sayap
            float k = length(pos.xy);
            pos.z += uWave * 0.03 * k * sin(k * 3.0 - uTime * 5.0);
            
            vec4 worldPos = Mmatrix * vec4(pos, 1.0);
            vWorldPos = worldPos.xyz;
            vNormal = NMmatrix * normal;
            vColor = color * uTint;
            
            gl_Position = VPmatrix * worldPos;
        }
    `;

    const shader_fragment_source = `
        precision mediump float;
        
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        varying vec3 vColor;
        
        uniform vec3 uCameraPos;
        uniform vec3 uLightDir;
        uniform float uGlow;
        uniform float uSpecularIntensity;
        
        void main(void) {
            vec3 N = normalize(vNormal);
            vec3 V = normalize(uCameraPos - vWorldPos);
            vec3 L = normalize(uLightDir);
            
            if (dot(N, V) < 0.0) N = -N; // Two-sided lighting
            
            float diffuse = max(dot(N, L), 0.0);
            
            // Hemisphere ambient
            vec3 ambient = mix(vec3(0.2, 0.17, 0.34), vec3(0.5, 0.5, 0.78), 0.5 + 0.5 * N.y);
            
            // Specular Blinn-Phong
            vec3 H = normalize(L + V);
            float specular = pow(max(dot(N, H), 0.0), 40.0) * uSpecularIntensity;
            
            // Rim Light (Pantulan pada pinggiran objek)
            float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
            
            vec3 finalColor = vColor * (ambient + vec3(1.0, 0.95, 0.9) * diffuse * 0.85) + specular + vec3(0.45, 0.5, 1.0) * rim * 0.25;
            
            // Efek mata menyala
            gl_FragColor = vec4(mix(finalColor, vColor * 1.3, uGlow), 1.0);
        }
    `;

    const compile_shader = function(source, type, typeString) {
        const shader = GL.createShader(type);
        GL.shaderSource(shader, source);
        GL.compileShader(shader);
        if (!GL.getShaderParameter(shader, GL.COMPILE_STATUS)) {
            console.error("ERROR IN META KNIGHT " + typeString + " SHADER: " + GL.getShaderInfoLog(shader));
            return null;
        }
        return shader;
    };

    const shader_vertex = compile_shader(shader_vertex_source, GL.VERTEX_SHADER, "VERTEX");
    const shader_fragment = compile_shader(shader_fragment_source, GL.FRAGMENT_SHADER, "FRAGMENT");

    const SHADER_PROGRAM = GL.createProgram();
    GL.attachShader(SHADER_PROGRAM, shader_vertex);
    GL.attachShader(SHADER_PROGRAM, shader_fragment);
    GL.linkProgram(SHADER_PROGRAM);

    const locs = {
        _position: GL.getAttribLocation(SHADER_PROGRAM, "position"),
        _normal: GL.getAttribLocation(SHADER_PROGRAM, "normal"),
        _color: GL.getAttribLocation(SHADER_PROGRAM, "color"),
        _VPmatrix: GL.getUniformLocation(SHADER_PROGRAM, "VPmatrix"),
        _Mmatrix: GL.getUniformLocation(SHADER_PROGRAM, "Mmatrix"),
        _NMmatrix: GL.getUniformLocation(SHADER_PROGRAM, "NMmatrix"),
        _uTint: GL.getUniformLocation(SHADER_PROGRAM, "uTint"),
        _uGlow: GL.getUniformLocation(SHADER_PROGRAM, "uGlow"),
        _uSpecular: GL.getUniformLocation(SHADER_PROGRAM, "uSpecularIntensity"),
        _uWave: GL.getUniformLocation(SHADER_PROGRAM, "uWave"),
        _uTime: GL.getUniformLocation(SHADER_PROGRAM, "uTime"),
        _uCamera: GL.getUniformLocation(SHADER_PROGRAM, "uCameraPos"),
        _uLight: GL.getUniformLocation(SHADER_PROGRAM, "uLightDir")
    };

    const buildBuffer = function(meshData) {
        const vbo = GL.createBuffer();
        GL.bindBuffer(GL.ARRAY_BUFFER, vbo);
        GL.bufferData(GL.ARRAY_BUFFER, new Float32Array(meshData.vertices), GL.STATIC_DRAW);
        
        const ibo = GL.createBuffer();
        GL.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, ibo);
        GL.bufferData(GL.ELEMENT_ARRAY_BUFFER, new Uint16Array(meshData.indices), GL.STATIC_DRAW);
        
        return { vbo: vbo, ibo: ibo, count: meshData.indices.length };
    };

    const MESHES = {
        sphere: buildBuffer(GEOMETRY.createEllipsoid(1, 1, 1, GEOMETRY.COLOR_WHITE)),
        cylinder: buildBuffer(GEOMETRY.createCylinder(GEOMETRY.COLOR_WHITE)),
        cone: buildBuffer(GEOMETRY.createCone(GEOMETRY.COLOR_WHITE)),
        paraboloid: buildBuffer(GEOMETRY.createEllipticParaboloid(GEOMETRY.COLOR_WHITE)),
        
        head: buildBuffer(GEOMETRY.createEllipsoid(1, 1, 1, function(u, v, p) {
            return (p[2] > 0.3 && GEOMETRY.maskSlitCondition(p[0], p[1], 0.1)) ? [0.04, 0.04, 0.08] : GEOMETRY.COLOR_WHITE;
        }, { numU: 96, numV: 64 })),
        
        mask: buildBuffer(GEOMETRY.createEllipsoid(0.88, 0.82, 0.66, GEOMETRY.COLOR_WHITE, {
            cy: -0.1, cz: 0.4, startAngle: 0, endAngle: Math.PI, numU: 110, numV: 70,
            skipCondition: function(center) { return GEOMETRY.maskSlitCondition(center[0], center[1]); }
        })),

        horn: buildBuffer(GEOMETRY.createTube(
            function(t) { return GEOMETRY.evaluateBezier([[0.72, 0.5, 0.3], [1.25, 0.62, 0.25], [1.42, 1.0, 0.2], [1.15, 1.4, 0.2]], t); },
            function(t) { return 0.12 * (1 - t) + 0.01; },
            GEOMETRY.COLOR_WHITE
        )),
        wing: buildBuffer(GEOMETRY.createPlate(
            [[0, 0.5, 0], [1.1, 1.6, 0], [2.4, 2.6, 1], [2, 1.3, 0], [3.2, 1, 1], [2.4, 0.05, 0], [2.8, -1.1, 1], [1.4, -0.45, 0], [0.2, -0.6, 0]], 
            [0.5, 0.2], 
            function(u, v) { return v > 0.95 ? [0.3, 0.25, 0.5] : [0.7 + 0.3 * v, 0.7 + 0.3 * v, 0.85 + 0.15 * v]; }, 
            0.08
        )),
        guard: buildBuffer(GEOMETRY.createPlate(
            [[0, 0.1, 0], [0.28, 0.06, 0], [0.62, 0.3, 1], [0.46, 0, 0], [0.52, -0.22, 1], [0.2, -0.1, 0], [0, -0.15, 0], [-0.2, -0.1, 0], [-0.52, -0.22, 1], [-0.46, 0, 0], [-0.62, 0.3, 1], [-0.28, 0.06, 0]], 
            [0, 0], 
            GEOMETRY.COLOR_WHITE, 
            0.07
        ))
    };

    const COLORS = {
        navy: [0.24, 0.32, 0.8], purple: [0.52, 0.3, 0.74],
        purpDark: [0.38, 0.22, 0.6], silver: [0.92, 0.94, 1],
        gold: [1, 0.78, 0.22], goldDark: [0.85, 0.6, 0.15],
        red: [0.95, 0.15, 0.2], white: [1, 1, 1],
        maroon: [0.64, 0.22, 0.44], yellow: [1, 0.9, 0.2],
        wingBase: [0.45, 0.34, 0.9]
    };

    return {
        program: SHADER_PROGRAM,
        locs,
        MESHES,
        COLORS
    };
}

export function drawMetaKnight(GL, metaData, time, vpMatrix, cameraEye, basePlacementMatrix) {
    const { program, locs, MESHES, COLORS } = metaData;
    const rootMat = basePlacementMatrix || LIBS.get_I4();

    GL.useProgram(program);
    GL.enable(GL.DEPTH_TEST);
    GL.depthFunc(GL.LEQUAL);
    // Matikan CULL_FACE karena sayap & tanduk kiri menggunakan skala cermin (-1) dan two-sided lighting
    GL.disable(GL.CULL_FACE);

    GL.enableVertexAttribArray(locs._position);
    GL.enableVertexAttribArray(locs._normal);
    GL.enableVertexAttribArray(locs._color);

    GL.uniformMatrix4fv(locs._VPmatrix, false, vpMatrix);
    GL.uniform3fv(locs._uCamera, cameraEye);
    GL.uniform3f(locs._uLight, 0.5, 0.8, 0.7);
    GL.uniform1f(locs._uTime, time);

    const drawMesh = function(mesh, modelMatrix, tint, glow, specular, waveIntensity) {
        GL.bindBuffer(GL.ARRAY_BUFFER, mesh.vbo);
        GL.vertexAttribPointer(locs._position, 3, GL.FLOAT, false, 36, 0);
        GL.vertexAttribPointer(locs._normal, 3, GL.FLOAT, false, 36, 12);
        GL.vertexAttribPointer(locs._color, 3, GL.FLOAT, false, 36, 24);

        GL.uniformMatrix4fv(locs._Mmatrix, false, modelMatrix);
        GL.uniformMatrix3fv(locs._NMmatrix, false, LIBS.inverseTranspose3x3(modelMatrix));
        
        GL.uniform3fv(locs._uTint, tint || COLORS.white);
        GL.uniform1f(locs._uGlow, glow || 0.0);
        GL.uniform1f(locs._uSpecular, specular !== undefined ? specular : 0.3);
        GL.uniform1f(locs._uWave, waveIntensity || 0.0);

        GL.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, mesh.ibo);
        GL.drawElements(GL.TRIANGLES, mesh.count, GL.UNSIGNED_SHORT, 0);
    };

    // Animasi Melayang (Hover) + Base Rotation di dalam ruang lokal rootMat
    const floatY = Math.sin(time * 1.6) * 0.18;
    const floatX = Math.sin(time * 0.5) * 0.5;
    
    let bodyMatrix = LIBS.multiply(rootMat, LIBS.translate(floatX, floatY, 0));
    bodyMatrix = LIBS.multiply(bodyMatrix, LIBS.rotateArbitrary(30 * Math.sin(time * 0.8) * Math.PI / 180, 0.15, 1, 0.1));
    bodyMatrix = LIBS.multiply(bodyMatrix, LIBS.scale(1 + 0.03 * Math.sin(time * 3)));

    // Bayangan di bawah karakter (menapak di permukaan panggung bersama)
    const shadowWidth = 1.1 / (1 + 0.25 * Math.max(0, floatY + 1));
    const shadowMat = LIBS.multiply(rootMat, LIBS.multiply(LIBS.translate(floatX, -1.09, 0), LIBS.scale(shadowWidth, 0.01, shadowWidth)));
    drawMesh(MESHES.sphere, shadowMat, [0.12, 0.08, 0.24], 0, 0);

    // Karakter Utama (Torso)
    drawMesh(MESHES.sphere, LIBS.multiply(bodyMatrix, LIBS.scale(0.6, 0.62, 0.55)), COLORS.purple);

    // Kepala & Aksesoris
    let headMatrix = LIBS.multiply(bodyMatrix, LIBS.translate(0, 1, 0.02));
    headMatrix = LIBS.multiply(headMatrix, LIBS.rotateArbitrary(Math.sin(time * 0.9) * 0.15, 0, 1, 0));
    headMatrix = LIBS.multiply(headMatrix, LIBS.rotateArbitrary(Math.sin(time * 1.3) * 0.04, 1, 0, 0));
    
    drawMesh(MESHES.head, headMatrix, COLORS.navy, 0, 0.5);
    drawMesh(MESHES.mask, headMatrix, COLORS.silver, 0, 0.7);
    
    // Mata & Tanduk (Kanan & Kiri)
    const blinkPhase = (time % 3.7) < 0.12 ? Math.abs((time % 3.7) - 0.06) / 0.06 : 1.0;
    
    [1, -1].forEach(function(side) {
        // Mata
        const eyePos = LIBS.multiply(headMatrix, LIBS.translate(side * 0.27, 0.015, 0.945));
        const eyeRot = LIBS.multiply(eyePos, LIBS.rotateArbitrary(side * 0.38, 0, 0, 1));
        drawMesh(MESHES.sphere, LIBS.multiply(eyeRot, LIBS.scale(0.15, 0.06 * blinkPhase + 0.004, 0.05)), COLORS.yellow, 1.0);
        
        // Tanduk
        drawMesh(MESHES.horn, LIBS.multiply(headMatrix, LIBS.scale(side, 1, 1)), COLORS.gold, 0, 0.8);
        
        // Bahu, Lengan, & Sepatu
        const shoulderRoot = LIBS.multiply(bodyMatrix, LIBS.translate(side * 0.68, 0.05, 0.05));
        const pauldronRot = LIBS.multiply(shoulderRoot, LIBS.rotateArbitrary(-0.45 * side, 0, 0, 1));
        
        drawMesh(MESHES.paraboloid, LIBS.multiply(pauldronRot, LIBS.scale(0.38, 0.3, 0.36)), COLORS.gold, 0, 0.8);
        drawMesh(MESHES.sphere, LIBS.multiply(pauldronRot, LIBS.multiply(LIBS.translate(0, 0.07, 0.33), LIBS.scale(0.07, 0.07, 0.05))), COLORS.red, 0.5, 1);
        
        // Tangan
        const swordSwing = ((time % 4) / 1.2) < 1 ? Math.sin(((time % 4) / 1.2) * Math.PI) : 0;
        const armAngle = side < 0 ? -0.5 + Math.sin(time * 1.7) * 0.12 : 2.0 + Math.sin(time * 2.1) * 0.1 + 0.3 * swordSwing;
        const armRot = LIBS.multiply(LIBS.multiply(shoulderRoot, LIBS.rotateArbitrary(-0.45, 1, 0, 0)), LIBS.rotateArbitrary(armAngle, 0, 0, 1));
        
        drawMesh(MESHES.sphere, LIBS.multiply(armRot, LIBS.multiply(LIBS.translate(0, -0.27, 0), LIBS.scale(0.14, 0.3, 0.14))), COLORS.purpDark);
        
        const handMatrix = LIBS.multiply(armRot, LIBS.translate(0, -0.55, 0));
        drawMesh(MESHES.sphere, LIBS.multiply(handMatrix, LIBS.scale(0.25, 0.21, 0.2)), COLORS.white);
        drawMesh(MESHES.sphere, LIBS.multiply(handMatrix, LIBS.multiply(LIBS.translate(0, 0.02, 0.19), LIBS.scale(0.09, 0.1, 0.09))), COLORS.white);
        
        // Sepatu
        drawMesh(MESHES.sphere, LIBS.multiply(bodyMatrix, LIBS.multiply(LIBS.translate(side * 0.33, -0.58, 0.12), LIBS.scale(0.28, 0.16, 0.42))), COLORS.maroon);
        drawMesh(MESHES.sphere, LIBS.multiply(bodyMatrix, LIBS.multiply(LIBS.translate(side * 0.33, -0.6, 0.4), LIBS.scale(0.2, 0.12, 0.14))), [0.78, 0.3, 0.58]);
        
        // Sayap (Rotate Arbitrary Axis)
        const flapAngle = 0.35 + 0.3 * Math.sin(time * 3.2);
        let wingRoot = LIBS.multiply(bodyMatrix, LIBS.translate(side * 0.45, 0.3, -0.42));
        wingRoot = LIBS.multiply(wingRoot, LIBS.rotateArbitrary(side * flapAngle, side * 0.3, 1, 0.25));
        wingRoot = LIBS.multiply(wingRoot, LIBS.scale(0.68 * side, 0.68, 0.68));
        
        drawMesh(MESHES.wing, wingRoot, COLORS.wingBase, 0, 0.15, 1.0);
        drawMesh(MESHES.cone, LIBS.multiply(wingRoot, LIBS.multiply(LIBS.translate(2.4, 2.6, 0), LIBS.multiply(LIBS.rotateArbitrary(-0.35, 0, 0, 1), LIBS.scale(0.07, 0.5, 0.07)))), COLORS.white);
        drawMesh(MESHES.cone, LIBS.multiply(wingRoot, LIBS.multiply(LIBS.translate(3.2, 1, 0), LIBS.multiply(LIBS.rotateArbitrary(-1.2, 0, 0, 1), LIBS.scale(0.07, 0.45, 0.07)))), COLORS.white);
        
        // Pedang Galaxia
        if (side > 0) {
            const p = (time % 4) / 1.2;
            const swordTwirl = p < 1 ? (3*p*p - 2*p*p*p) * Math.PI * 2 : 0;
            
            let swordMatrix = handMatrix;
            swordMatrix = LIBS.multiply(swordMatrix, LIBS.rotateArbitrary(-2, 0, 0, 1));
            swordMatrix = LIBS.multiply(swordMatrix, LIBS.rotateArbitrary(0.45, 1, 0, 0));
            swordMatrix = LIBS.multiply(swordMatrix, LIBS.rotateArbitrary(-0.6, 0, 0, 1));
            swordMatrix = LIBS.multiply(swordMatrix, LIBS.rotateArbitrary(0.2, 1, 0, 0));
            swordMatrix = LIBS.multiply(swordMatrix, LIBS.rotateArbitrary(0.5 * swordSwing, 0, 0, 1));
            swordMatrix = LIBS.multiply(swordMatrix, LIBS.rotateArbitrary(swordTwirl, 0, 1, 0));
            
            drawMesh(MESHES.cylinder, LIBS.multiply(swordMatrix, LIBS.scale(0.055, 0.5, 0.055)), [0.3, 0.22, 0.6]);
            drawMesh(MESHES.sphere, LIBS.multiply(swordMatrix, LIBS.multiply(LIBS.translate(0, -0.3, 0), LIBS.scale(0.09, 0.09, 0.09))), COLORS.gold, 0, 0.8);
            
            const guardRoot = LIBS.multiply(swordMatrix, LIBS.multiply(LIBS.translate(0, 0.3, 0), LIBS.scale(0.75, 0.75, 0.75)));
            drawMesh(MESHES.guard, guardRoot, COLORS.goldDark, 0, 0.8);
            drawMesh(MESHES.guard, LIBS.multiply(guardRoot, LIBS.scale(1, 1, -1)), COLORS.goldDark, 0, 0.8);
            
            drawMesh(MESHES.cylinder, LIBS.multiply(swordMatrix, LIBS.multiply(LIBS.translate(0, 0.66, 0), LIBS.scale(0.2, 0.68, 0.04))), COLORS.gold, 0.3, 0.9);
            drawMesh(MESHES.cone, LIBS.multiply(swordMatrix, LIBS.multiply(LIBS.translate(0, 1, 0), LIBS.scale(0.2, 0.55, 0.04))), COLORS.gold, 0.3, 0.9);
        }
    });

    // Matikan attrib array Meta Knight setelah selesai menggambar agar tidak mengganggu shader karakter lain
    if (locs._color >= 0) GL.disableVertexAttribArray(locs._color);
}