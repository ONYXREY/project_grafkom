/**
 * king_dedede_ObjectAnimation/main.js
 * Program standalone untuk melihat King Dedede sendiri (sudah tidak mengambang & menggunakan environment.js)
 */

import { buildKingDedede, updateKingDededeAnimation } from './dedede.js';
import { buildEnvironment, updateEnvironmentAnimation } from '../environment/environment.js';

let gl;
let shaderInfo;
let dededeNodes = {};
let envData = {};

const appState = {
    camYaw: 0.35,
    camPitch: 0.22,
    camDist: 10.5,
    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,
    accumulatedTime: 0,
    lastFrameTime: 0
};

const vsSource = `
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

const fsSource = `
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

function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("Shader compile error:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function initShaders(gl) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    return {
        program: prog,
        attribs: {
            aPosition: gl.getAttribLocation(prog, "aPosition"),
            aNormal: gl.getAttribLocation(prog, "aNormal"),
            aColor: gl.getAttribLocation(prog, "aColor")
        },
        uniforms: {
            uModelMatrix: gl.getUniformLocation(prog, "uModelMatrix"),
            uViewMatrix: gl.getUniformLocation(prog, "uViewMatrix"),
            uProjectionMatrix: gl.getUniformLocation(prog, "uProjectionMatrix"),
            uNormalMatrix: gl.getUniformLocation(prog, "uNormalMatrix"),
            uLightDir1: gl.getUniformLocation(prog, "uLightDir1"),
            uLightDir2: gl.getUniformLocation(prog, "uLightDir2"),
            uViewPos: gl.getUniformLocation(prog, "uViewPos"),
            uShininess: gl.getUniformLocation(prog, "uShininess"),
            uSpecularStrength: gl.getUniformLocation(prog, "uSpecularStrength")
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
        appState.camDist = Math.max(4.5, Math.min(24.0, appState.camDist + e.deltaY * 0.006));
    }, { passive: false });
}

function main() {
    const canvas = document.getElementById("mycanvas");
    gl = canvas.getContext("webgl", { antialias: true });
    if (!gl) return;

    shaderInfo = initShaders(gl);
    dededeNodes = buildKingDedede(gl);
    envData = buildEnvironment(gl);
    setupControls(canvas);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    const projMatrix = Libs.mat4.create();
    const viewMatrix = Libs.mat4.create();

    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const width = Math.floor(canvas.clientWidth * dpr);
        const height = Math.floor(canvas.clientHeight * dpr);
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        Libs.mat4.perspective(projMatrix, Libs.degToRad(45), canvas.width / canvas.height, 0.1, 100.0);
    }
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    function render(nowMs) {
        const nowSec = nowMs * 0.001;
        const dt = appState.lastFrameTime ? (nowSec - appState.lastFrameTime) : 0.016;
        appState.lastFrameTime = nowSec;
        appState.accumulatedTime += dt;

        gl.clearColor(0.52, 0.78, 0.98, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        const eyeX = appState.camDist * Math.cos(appState.camPitch) * Math.sin(appState.camYaw);
        const eyeY = appState.camDist * Math.sin(appState.camPitch) + 0.55;
        const eyeZ = appState.camDist * Math.cos(appState.camPitch) * Math.cos(appState.camYaw);
        const eyePos = [eyeX, eyeY, eyeZ];

        Libs.mat4.lookAt(viewMatrix, eyePos, [0.0, 0.45, 0.0], [0.0, 1.0, 0.0]);

        gl.uniformMatrix4fv(shaderInfo.uniforms.uProjectionMatrix, false, projMatrix);
        gl.uniformMatrix4fv(shaderInfo.uniforms.uViewMatrix, false, viewMatrix);
        gl.uniform3fv(shaderInfo.uniforms.uViewPos, eyePos);
        gl.uniform3fv(shaderInfo.uniforms.uLightDir1, [0.65, 0.85, 0.75]);
        gl.uniform3fv(shaderInfo.uniforms.uLightDir2, [-0.70, 0.35, -0.60]);

        updateEnvironmentAnimation(envData, appState.accumulatedTime);
        updateKingDededeAnimation(dededeNodes, appState.accumulatedTime);

        envData.envRoot.updateAndDraw(shaderInfo, null);
        dededeNodes.characterRoot.updateAndDraw(shaderInfo, null);

        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
}

main();
