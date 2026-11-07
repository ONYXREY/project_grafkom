/**
 * main.js (Root Penggabungan Project Kelompok - 3 Karakter Lengkap)
 * Menggabungkan:
 * 1. Environment Latar Belakang Animasi dari ./environment/environment.js
 * 2. Karakter 1: Kirby dari ./kirby-standalone/object.js (Kiri Panggung)
 * 3. Karakter 2: King Dedede dari ./king_dedede_ObjectAnimation/dedede.js (Tengah Panggung)
 * 4. Karakter 3: Meta Knight dari ./meta_knight/meta_knight.js (Kanan Panggung)
 * ke dalam satu frame, satu environment, dan satu kamera interaktif.
 */

import { buildEnvironment, updateEnvironmentAnimation } from './environment/environment.js';
import { buildKingDedede, updateKingDededeAnimation } from './king_dedede_ObjectAnimation/dedede.js';
import { createKirby, SceneNode as KirbySceneNode } from './kirby-standalone/object.js';
import { initMetaKnight, drawMetaKnight } from './meta_knight/meta_knight.js';

let gl;
let dededeShaderInfo;
let kirbyShaderInfo;

let envData;
let dededeNodes;
let kirbyInstance;
let kirbyPlacementNode;
let metaKnightData;
let metaKnightPlacementMatrix;

const appState = {
    camYaw: 0.0,
    camPitch: 0.18,
    camDist: 15.8,
    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,
    accumulatedTime: 0,
    lastFrameTime: 0
};

// ============================================================================
//  SHADER ENVIRONMENT & KING DEDEDE 
// ============================================================================
const dededeVsSource = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec3 aColor;

    uniform mat4 uModelMatrix;
    uniform mat4 uViewMatrix;
    uniform mat4 uProjectionMatrix;
    uniform mat3 uNormalMatrix;

    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec3 vColor;

    void main() {
        vec4 worldPos = uModelMatrix * vec4(aPosition, 1.0);
        vWorldPos = worldPos.xyz;
        vNormal = normalize(uNormalMatrix * aNormal);
        vColor = aColor;
        gl_Position = uProjectionMatrix * uViewMatrix * worldPos;
    }
`;

const dededeFsSource = `
    precision mediump float;

    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec3 vColor;

    uniform vec3 uLightDir1;
    uniform vec3 uLightDir2;
    uniform vec3 uViewPos;
    uniform float uShininess;
    uniform float uSpecularStrength;

    void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(uViewPos - vWorldPos);

        float skyFactor = 0.5 * N.y + 0.5;
        vec3 ambientColor = mix(vec3(0.28, 0.26, 0.34), vec3(0.46, 0.50, 0.62), skyFactor);
        vec3 ambient = ambientColor * vColor;

        vec3 L1 = normalize(uLightDir1);
        float diff1 = max(dot(N, L1), 0.0);
        float smoothDiff1 = pow(diff1 * 0.65 + 0.35, 1.4);
        vec3 H1 = normalize(L1 + V);
        float spec1 = pow(max(dot(N, H1), 0.0), uShininess) * uSpecularStrength;

        vec3 L2 = normalize(uLightDir2);
        float diff2 = max(dot(N, L2), 0.0) * 0.28;

        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.2) * 0.18;

        vec3 color = ambient
                   + vColor * smoothDiff1 * vec3(0.95, 0.93, 0.88)
                   + vColor * diff2 * vec3(0.65, 0.78, 1.0)
                   + vec3(1.0, 0.98, 0.90) * spec1
                   + vec3(0.85, 0.90, 1.0) * rim;

        gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
`;

// ============================================================================
//  SHADER  KIRBY STANDALONE 
// ============================================================================
const kirbyVsSource = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    uniform mat4 uModelMatrix;
    uniform mat4 uViewProjectionMatrix;
    uniform mat3 uNormalMatrix;
    varying vec3 vNormal;
    void main() {
        vec4 worldPosition = uModelMatrix * vec4(aPosition, 1.0);
        vNormal = uNormalMatrix * aNormal;
        gl_Position = uViewProjectionMatrix * worldPosition;
    }
`;

const kirbyFsSource = `
    precision mediump float;
    uniform vec4 uBaseColor;
    uniform vec3 uLightDirection;
    uniform vec3 uFillDirection;
    uniform vec3 uLighting;
    varying vec3 vNormal;
    void main() {
        vec3 surfaceNormal = normalize(vNormal);
        vec3 lightDirection = normalize(uLightDirection);
        float diffuse = max(dot(surfaceNormal, lightDirection), 0.0);
        float fill = max(dot(surfaceNormal, normalize(uFillDirection)), 0.0);
        gl_FragColor = vec4(uBaseColor.rgb * (uLighting.x + uLighting.y * diffuse + uLighting.z * fill), uBaseColor.a);
    }
`;

function compileProgram(gl, vsSrc, fsSrc) {
    const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error(gl.getShaderInfoLog(s));
        }
        return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(prog);
    return prog;
}

function initShaders(gl) {
    const dProg = compileProgram(gl, dededeVsSource, dededeFsSource);
    dededeShaderInfo = {
        program: dProg,
        attribs: {
            aPosition: gl.getAttribLocation(dProg, "aPosition"),
            aNormal: gl.getAttribLocation(dProg, "aNormal"),
            aColor: gl.getAttribLocation(dProg, "aColor")
        },
        uniforms: {
            uModelMatrix: gl.getUniformLocation(dProg, "uModelMatrix"),
            uViewMatrix: gl.getUniformLocation(dProg, "uViewMatrix"),
            uProjectionMatrix: gl.getUniformLocation(dProg, "uProjectionMatrix"),
            uNormalMatrix: gl.getUniformLocation(dProg, "uNormalMatrix"),
            uLightDir1: gl.getUniformLocation(dProg, "uLightDir1"),
            uLightDir2: gl.getUniformLocation(dProg, "uLightDir2"),
            uViewPos: gl.getUniformLocation(dProg, "uViewPos"),
            uShininess: gl.getUniformLocation(dProg, "uShininess"),
            uSpecularStrength: gl.getUniformLocation(dProg, "uSpecularStrength")
        }
    };

    const kProg = compileProgram(gl, kirbyVsSource, kirbyFsSource);
    kirbyShaderInfo = {
        program: kProg,
        attribs: {
            aPosition: gl.getAttribLocation(kProg, "aPosition"),
            aNormal: gl.getAttribLocation(kProg, "aNormal")
        },
        uniforms: {
            uModelMatrix: gl.getUniformLocation(kProg, "uModelMatrix"),
            uViewProjectionMatrix: gl.getUniformLocation(kProg, "uViewProjectionMatrix"),
            uNormalMatrix: gl.getUniformLocation(kProg, "uNormalMatrix"),
            uBaseColor: gl.getUniformLocation(kProg, "uBaseColor"),
            uLightDirection: gl.getUniformLocation(kProg, "uLightDirection"),
            uFillDirection: gl.getUniformLocation(kProg, "uFillDirection"),
            uLighting: gl.getUniformLocation(kProg, "uLighting")
        }
    };
}

function setupControls(canvas) {
    canvas.addEventListener("mousedown", e => {
        appState.isDragging = true;
        appState.lastMouseX = e.clientX;
        appState.lastMouseY = e.clientY;
    });

    window.addEventListener("mouseup", () => {
        appState.isDragging = false;
    });

    window.addEventListener("mousemove", e => {
        if (!appState.isDragging) return;
        const dx = e.clientX - appState.lastMouseX;
        const dy = e.clientY - appState.lastMouseY;
        appState.lastMouseX = e.clientX;
        appState.lastMouseY = e.clientY;

        appState.camYaw -= dx * 0.008;
        appState.camPitch = Math.max(-0.45, Math.min(1.25, appState.camPitch + dy * 0.008));
    });

    canvas.addEventListener("wheel", e => {
        e.preventDefault();
        appState.camDist = Math.max(5.0, Math.min(30.0, appState.camDist + e.deltaY * 0.008));
    }, { passive: false });
}

function main() {
    const canvas = document.getElementById("mycanvas");
    gl = canvas.getContext("webgl", { antialias: true });
    if (!gl) {
        alert("Browser tidak mendukung WebGL!");
        return;
    }

    initShaders(gl);

    //  Environment Dream Land
    envData = buildEnvironment(gl);

    //  Kirby (Ditempatkan di Sisi Kiri Panggung: x = -3.8, z = +0.6)
    kirbyInstance = createKirby(gl);
    kirbyPlacementNode = new KirbySceneNode("kirbyPlacementNode");
    kirbyPlacementNode.useLocalPose = true;

    // Tinggi rumput: -1.70 + 0.35/2.
    const kirbyGroundY = -1.525;
    kirbyPlacementNode.transform.setPosition(-4, kirbyGroundY - kirbyInstance.parts.turnRoot.transform.position.y, 1);
    kirbyPlacementNode.transform.setRotationFromEuler(0, 0.28,0 );
    kirbyPlacementNode.addChild(kirbyInstance.root);

    //  King Dedede (Ditempatkan di Tengah Panggung: x = 0.0, z = -0.5)
    dededeNodes = buildKingDedede(gl);
    Libs.mat4.translate(dededeNodes.characterRoot.baseMatrix, dededeNodes.characterRoot.baseMatrix, [0.0, 0.0, -0.5]);

    //  Bangun Meta Knight (Ditempatkan di Sisi Kanan Panggung: x = +3.8, z = +0.6)
    metaKnightData = initMetaKnight(gl);
    metaKnightPlacementMatrix = LIBS.multiply(
        LIBS.translate(4.5, -0.42, 0.8),
        LIBS.rotateArbitrary(LIBS.degToRad(-18), 0, 1, 0)
    );

    setupControls(canvas);

    const projMatrix = Libs.mat4.create();
    const viewMatrix = Libs.mat4.create();
    const viewProjMatrix = Libs.mat4.create();

    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const width = Math.floor(canvas.clientWidth * dpr);
        const height = Math.floor(canvas.clientHeight * dpr);
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        Libs.mat4.perspective(projMatrix, Libs.degToRad(45), canvas.width / canvas.height, 0.1, 120.0);
    }
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    function render(nowMs) {
        const nowSec = nowMs * 0.001;
        const dt = appState.lastFrameTime ? Math.min(nowSec - appState.lastFrameTime, 0.1) : 0.016;
        appState.lastFrameTime = nowSec;
        appState.accumulatedTime += dt;

        // Warna Langit envi
        gl.clearColor(0.50, 0.77, 0.98, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        const eyeX = appState.camDist * Math.cos(appState.camPitch) * Math.sin(appState.camYaw);
        const eyeY = appState.camDist * Math.sin(appState.camPitch) + 0.65;
        const eyeZ = appState.camDist * Math.cos(appState.camPitch) * Math.cos(appState.camYaw);
        const eyePos = [eyeX, eyeY, eyeZ];

        Libs.mat4.lookAt(viewMatrix, eyePos, [0.0, 0.40, -0.2], [0.0, 1.0, 0.0]);
        Libs.mat4.multiply(viewProjMatrix, projMatrix, viewMatrix);

        // ====================================================================
        // King dedede dan envi
        // ====================================================================
        gl.useProgram(dededeShaderInfo.program);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.CULL_FACE);

        gl.uniformMatrix4fv(dededeShaderInfo.uniforms.uProjectionMatrix, false, projMatrix);
        gl.uniformMatrix4fv(dededeShaderInfo.uniforms.uViewMatrix, false, viewMatrix);
        gl.uniform3fv(dededeShaderInfo.uniforms.uViewPos, eyePos);
        gl.uniform3fv(dededeShaderInfo.uniforms.uLightDir1, [0.65, 0.85, 0.75]);
        gl.uniform3fv(dededeShaderInfo.uniforms.uLightDir2, [-0.70, 0.35, -0.60]);

        updateEnvironmentAnimation(envData, appState.accumulatedTime);
        updateKingDededeAnimation(dededeNodes, appState.accumulatedTime);

        envData.envRoot.updateAndDraw(dededeShaderInfo, null);
        dededeNodes.characterRoot.updateAndDraw(dededeShaderInfo, null);

        if (dededeShaderInfo.attribs.aColor >= 0) {
            gl.disableVertexAttribArray(dededeShaderInfo.attribs.aColor);
        }

        // ====================================================================
        // Kirby
        // ====================================================================
        gl.useProgram(kirbyShaderInfo.program);
        gl.uniformMatrix4fv(kirbyShaderInfo.uniforms.uViewProjectionMatrix, false, viewProjMatrix);
        gl.uniform3fv(kirbyShaderInfo.uniforms.uLightDirection, [0.45, 0.85, 0.60]);
        gl.uniform3fv(kirbyShaderInfo.uniforms.uFillDirection, [-0.70, 0.25, 0.55]);
        gl.uniform3fv(kirbyShaderInfo.uniforms.uLighting, [0.42, 0.48, 0.10]);

        kirbyInstance.update(dt);
        kirbyPlacementNode.updateAndDraw(kirbyShaderInfo, null);

        // ====================================================================
        // Meta Knight
        // ====================================================================
        drawMetaKnight(gl, metaKnightData, appState.accumulatedTime, viewProjMatrix, eyePos, metaKnightPlacementMatrix);

        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
}

main();
