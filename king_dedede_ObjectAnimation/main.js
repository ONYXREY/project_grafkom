/**
 * main.js
 * Program Utama WebGL (ES Module): Perakitan Karakter King Dedede Step-by-Step,
 * Environment Dream Land, Kamera Interaktif Mouse, dan Animasi Transformasi Hierarkis.
 */

import { GeometryGenerator, Mesh, SceneNode } from './object.js';

let gl;
let shaderInfo;
let dededeNodes = {};
let envNodes = {};

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

// --- GLSL Shaders ---
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

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error("Program link error:", gl.getProgramInfoLog(prog));
    }
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

/**
 * MEMBANGUN KARAKTER KING DEDEDE STEP-BY-STEP (Kepala -> Badan -> Tangan/Kaki -> Jet Hammer)
 */
function buildKingDedede(gl) {
    const COL_BLUE       = [0.14, 0.42, 0.86];
    const COL_BELLY      = [0.98, 0.91, 0.72];
    const COL_BEAK       = [1.00, 0.68, 0.08];
    const COL_MOUTH_IN   = [0.68, 0.14, 0.20];
    const COL_ROBE_RED   = [0.86, 0.10, 0.16];
    const COL_FUR_WHITE  = [0.97, 0.97, 0.99];
    const COL_GOLD       = [0.98, 0.80, 0.12];
    const COL_MITTEN     = [0.98, 0.78, 0.10];
    const COL_WOOD_DARK  = [0.46, 0.25, 0.11];
    const COL_WOOD_LIGHT = [0.65, 0.39, 0.18];
    const COL_STEEL      = [0.76, 0.80, 0.86];
    const COL_EYE_WHITE  = [0.99, 0.99, 1.00];
    const COL_PUPIL      = [0.06, 0.06, 0.09];

    const characterRoot = new SceneNode("CharacterRoot");
    const torsoNode = new SceneNode("TorsoNode");
    Libs.mat4.translate(torsoNode.baseMatrix, torsoNode.baseMatrix, [0.0, 0.35, 0.0]);
    characterRoot.addChild(torsoNode);

    // =========================================================================
    // STEP 1: KEPALA, WAJAH, PARUH, TOPI, & MAHKOTA (Head Assembly)
    // =========================================================================
    const headNode = new SceneNode("HeadNode");
    Libs.mat4.translate(headNode.baseMatrix, headNode.baseMatrix, [0.0, 1.55, 0.08]);
    torsoNode.addChild(headNode);

    const headMesh = new Mesh(gl, GeometryGenerator.createEllipsoid(1.08, 0.96, 1.02, 28, 40), COL_BLUE, 28.0, 0.25);
    headNode.addMesh(headMesh);

    const cheekGeom = GeometryGenerator.createEllipsoid(0.45, 0.36, 0.42, 18, 24);
    const cheekMesh = new Mesh(gl, cheekGeom, COL_BLUE, 28.0, 0.25);
    const leftCheekMat = Libs.mat4.create();
    Libs.mat4.translate(leftCheekMat, leftCheekMat, [-0.74, -0.18, 0.48]);
    headNode.addMesh(cheekMesh, leftCheekMat);

    const rightCheekMat = Libs.mat4.create();
    Libs.mat4.translate(rightCheekMat, rightCheekMat, [0.74, -0.18, 0.48]);
    headNode.addMesh(cheekMesh, rightCheekMat);

    // Paruh Atas & Bawah (Object 3 - Elliptic Paraboloid)
    const upperBeakNode = new SceneNode("UpperBeakNode");
    Libs.mat4.translate(upperBeakNode.baseMatrix, upperBeakNode.baseMatrix, [0.0, -0.12, 0.68]);
    headNode.addChild(upperBeakNode);

    const upperBeakGeom = GeometryGenerator.createEllipticParaboloid(0.76, 0.38, 0.92, 22, 36, true);
    const upperBeakMesh = new Mesh(gl, upperBeakGeom, COL_BEAK, 42.0, 0.45);
    const upperBeakOffset = Libs.mat4.create();
    Libs.mat4.rotateX(upperBeakOffset, upperBeakOffset, Libs.degToRad(84));
    upperBeakNode.addMesh(upperBeakMesh, upperBeakOffset);

    const lowerBeakNode = new SceneNode("LowerBeakNode");
    Libs.mat4.translate(lowerBeakNode.baseMatrix, lowerBeakNode.baseMatrix, [0.0, -0.26, 0.65]);
    headNode.addChild(lowerBeakNode);

    const lowerBeakGeom = GeometryGenerator.createEllipticParaboloid(0.68, 0.30, 0.78, 20, 32, true);
    const lowerBeakMesh = new Mesh(gl, lowerBeakGeom, COL_BEAK, 42.0, 0.45);
    const lowerBeakOffset = Libs.mat4.create();
    Libs.mat4.rotateX(lowerBeakOffset, lowerBeakOffset, Libs.degToRad(102));
    lowerBeakNode.addMesh(lowerBeakMesh, lowerBeakOffset);

    const mouthInMesh = new Mesh(gl, GeometryGenerator.createEllipsoid(0.45, 0.12, 0.42, 12, 20), COL_MOUTH_IN, 10.0, 0.1);
    const mouthOffset = Libs.mat4.create();
    Libs.mat4.translate(mouthOffset, mouthOffset, [0.0, 0.05, 0.25]);
    lowerBeakNode.addMesh(mouthInMesh, mouthOffset);

    // Mata & Pupil (Object 1 - Ellipsoid)
    const eyeWhiteMesh = new Mesh(gl, GeometryGenerator.createEllipsoid(0.24, 0.34, 0.14, 20, 24), COL_EYE_WHITE, 64.0, 0.6);
    const pupilMesh = new Mesh(gl, GeometryGenerator.createEllipsoid(0.11, 0.17, 0.08, 16, 20), COL_PUPIL, 90.0, 0.9);
    const eyeHighlightMesh = new Mesh(gl, GeometryGenerator.createEllipsoid(0.045, 0.06, 0.05, 10, 12), COL_EYE_WHITE, 90.0, 1.0);

    [-1, 1].forEach(side => {
        const eyeMat = Libs.mat4.create();
        Libs.mat4.translate(eyeMat, eyeMat, [side * 0.34, 0.24, 0.90]);
        Libs.mat4.rotateY(eyeMat, eyeMat, side * Libs.degToRad(14));
        Libs.mat4.rotateX(eyeMat, eyeMat, Libs.degToRad(-8));
        headNode.addMesh(eyeWhiteMesh, eyeMat);

        const pupilMat = Libs.mat4.clone(eyeMat);
        Libs.mat4.translate(pupilMat, pupilMat, [-side * 0.03, 0.02, 0.10]);
        headNode.addMesh(pupilMesh, pupilMat);

        const hiMat = Libs.mat4.clone(pupilMat);
        Libs.mat4.translate(hiMat, hiMat, [0.03, 0.06, 0.06]);
        headNode.addMesh(eyeHighlightMesh, hiMat);
    });

    // Alis Mata (3D Curve - Cubic Bezier Tube)
    const leftBrowCurve = GeometryGenerator.createBezierTube(
        [-0.12, 0.42, 0.98], [-0.26, 0.56, 0.98], [-0.46, 0.58, 0.90], [-0.62, 0.46, 0.78],
        0.055, 20, 12, -1
    );
    const rightBrowCurve = GeometryGenerator.createBezierTube(
        [0.12, 0.42, 0.98], [0.26, 0.56, 0.98], [0.46, 0.58, 0.90], [0.62, 0.46, 0.78],
        0.055, 20, 12, -1
    );
    headNode.addMesh(new Mesh(gl, leftBrowCurve, COL_BEAK, 24.0, 0.3));
    headNode.addMesh(new Mesh(gl, rightBrowCurve, COL_BEAK, 24.0, 0.3));

    // Topi Merah, Mahkota Emas, & Pom-Pom
    const hatNode = new SceneNode("HatNode");
    Libs.mat4.translate(hatNode.baseMatrix, hatNode.baseMatrix, [0.0, 0.52, -0.08]);
    Libs.mat4.rotateX(hatNode.baseMatrix, hatNode.baseMatrix, Libs.degToRad(-12));
    headNode.addChild(hatNode);

    const hatDomeGeom = GeometryGenerator.createEllipticParaboloid(0.84, 0.84, 0.95, 24, 36, true);
    hatNode.addMesh(new Mesh(gl, hatDomeGeom, COL_ROBE_RED, 20.0, 0.2));

    const crownBandMesh = new Mesh(gl, GeometryGenerator.createCylinder(0.88, 0.86, 0.24, 8, 36, true), COL_GOLD, 72.0, 0.85);
    const crownBandMat = Libs.mat4.create();
    Libs.mat4.translate(crownBandMat, crownBandMat, [0.0, 0.10, 0.0]);
    hatNode.addMesh(crownBandMesh, crownBandMat);

    const crownSpikeMesh = new Mesh(gl, GeometryGenerator.createCone(0.16, 0.08, 0.32, 12, 20), COL_GOLD, 72.0, 0.85);
    const numSpikes = 10;
    for (let i = 0; i < numSpikes; ++i) {
        const angle = (i / numSpikes) * 2.0 * Math.PI;
        const spikeMat = Libs.mat4.create();
        Libs.mat4.rotateY(spikeMat, spikeMat, -angle);
        Libs.mat4.translate(spikeMat, spikeMat, [0.86, 0.20, 0.0]);
        Libs.mat4.rotateY(spikeMat, spikeMat, Math.PI / 2);
        hatNode.addMesh(crownSpikeMesh, spikeMat);
    }

    const hatRimFront = GeometryGenerator.createBezierTube(
        [-0.90, 0.0, 0.0], [-0.90, 0.06, 1.18], [0.90, 0.06, 1.18], [0.90, 0.0, 0.0],
        0.15, 28, 14, 7
    );
    const hatRimBack = GeometryGenerator.createBezierTube(
        [0.90, 0.0, 0.0], [0.90, 0.0, -1.18], [-0.90, 0.0, -1.18], [-0.90, 0.0, 0.0],
        0.15, 28, 14, 7
    );
    hatNode.addMesh(new Mesh(gl, hatRimFront, COL_FUR_WHITE, 12.0, 0.1));
    hatNode.addMesh(new Mesh(gl, hatRimBack, COL_FUR_WHITE, 12.0, 0.1));

    const pomPomNode = new SceneNode("PomPomNode");
    Libs.mat4.translate(pomPomNode.baseMatrix, pomPomNode.baseMatrix, [0.0, 0.98, 0.0]);
    hatNode.addChild(pomPomNode);
    pomPomNode.addMesh(new Mesh(gl, GeometryGenerator.createEllipsoid(0.28, 0.26, 0.28, 20, 28), COL_FUR_WHITE, 12.0, 0.1));

    // =========================================================================
    // STEP 2: BADAN, PERUT BUNCIT, SABUK ZIG-ZAG, JUBAH HIPERBOLOID, & KURVA BULU
    // =========================================================================
    const torsoMesh = new Mesh(gl, GeometryGenerator.createEllipsoid(1.52, 1.72, 1.38, 30, 44), COL_BLUE, 24.0, 0.2);
    torsoNode.addMesh(torsoMesh);

    const bellyNode = new SceneNode("BellyNode");
    torsoNode.addChild(bellyNode);

    const bellyMesh = new Mesh(gl, GeometryGenerator.createEllipsoid(1.36, 1.48, 1.26, 28, 40), COL_BELLY, 20.0, 0.18);
    const bellyOffset = Libs.mat4.create();
    Libs.mat4.translate(bellyOffset, bellyOffset, [0.0, -0.08, 0.28]);
    bellyNode.addMesh(bellyMesh, bellyOffset);

    const beltGeom = GeometryGenerator.createZigZagBelt(1.54, 1.48, 0.56, 14, 60);
    const beltMesh = new Mesh(gl, beltGeom, [1, 1, 1], 32.0, 0.35);
    const beltOffset = Libs.mat4.create();
    Libs.mat4.translate(beltOffset, beltOffset, [0.0, -0.18, 0.08]);
    bellyNode.addMesh(beltMesh, beltOffset);

    const robeStartTheta = Math.PI / 2 + 0.52;
    const robeEndTheta = 2.0 * Math.PI + Math.PI / 2 - 0.52;
    const robeGeom = GeometryGenerator.createHyperboloidOneSheet(
        1.18, 1.12, 1.15, -1.38, 0.30, 26, 48, robeStartTheta, robeEndTheta, 0.07
    );
    const robeMesh = new Mesh(gl, robeGeom, COL_ROBE_RED, 22.0, 0.22);
    const robeOffset = Libs.mat4.create();
    Libs.mat4.translate(robeOffset, robeOffset, [0.0, 0.32, -0.04]);
    torsoNode.addMesh(robeMesh, robeOffset);

    const furMeshes = [
        GeometryGenerator.createBezierTube([-0.85, 1.02, 0.85], [-1.55, 1.22, -0.65], [1.55, 1.22, -0.65], [0.85, 1.02, 0.85], 0.24, 34, 16, 9),
        GeometryGenerator.createBezierTube([-0.82, 1.00, 0.85], [-1.12, 0.35, 1.05], [-1.38, -0.45, 1.22], [-1.68, -1.25, 1.38], 0.20, 28, 16, 7),
        GeometryGenerator.createBezierTube([0.82, 1.00, 0.85], [1.12, 0.35, 1.05], [1.38, -0.45, 1.22], [1.68, -1.25, 1.38], 0.20, 28, 16, 7),
        GeometryGenerator.createBezierTube([-1.68, -1.25, 1.38], [-2.45, -1.28, 0.15], [-1.65, -1.28, -1.95], [0.0, -1.28, -2.02], 0.22, 30, 16, 8),
        GeometryGenerator.createBezierTube([0.0, -1.28, -2.02], [1.65, -1.28, -1.95], [2.45, -1.28, 0.15], [1.68, -1.25, 1.38], 0.22, 30, 16, 8)
    ];

    for (const fg of furMeshes) {
        torsoNode.addMesh(new Mesh(gl, fg, COL_FUR_WHITE, 14.0, 0.12));
    }

    const claspCord = GeometryGenerator.createBezierTube(
        [-0.78, 0.82, 0.95], [-0.25, 0.72, 1.28], [0.25, 0.72, 1.28], [0.78, 0.82, 0.95],
        0.055, 20, 12, 0
    );
    torsoNode.addMesh(new Mesh(gl, claspCord, COL_GOLD, 64.0, 0.8));

    const claspButtonMesh = new Mesh(gl, GeometryGenerator.createEllipsoid(0.18, 0.18, 0.12, 14, 20), COL_GOLD, 72.0, 0.85);
    [-0.78, 0.78].forEach(xPos => {
        const cMat = Libs.mat4.create();
        Libs.mat4.translate(cMat, cMat, [xPos, 0.82, 0.95]);
        torsoNode.addMesh(claspButtonMesh, cMat);
    });

    // =========================================================================
    // STEP 3: LENGAN, TANGAN MITTENS, KAKI, & SENJATA JET HAMMER (Limbs & Weapon)
    // =========================================================================
    const sleeveMesh = new Mesh(gl, GeometryGenerator.createEllipsoid(0.55, 0.78, 0.52, 20, 28), COL_ROBE_RED, 22.0, 0.22);
    const cuffFurMesh = new Mesh(gl, GeometryGenerator.createCylinder(0.46, 0.48, 0.26, 8, 28, true), COL_FUR_WHITE, 14.0, 0.12);
    const handPalmMesh = new Mesh(gl, GeometryGenerator.createEllipsoid(0.40, 0.44, 0.36, 18, 24), COL_MITTEN, 32.0, 0.35);
    const handThumbMesh = new Mesh(gl, GeometryGenerator.createEllipsoid(0.18, 0.24, 0.18, 14, 18), COL_MITTEN, 32.0, 0.35);

    const leftShoulderNode = new SceneNode("LeftShoulderNode");
    Libs.mat4.translate(leftShoulderNode.baseMatrix, leftShoulderNode.baseMatrix, [-1.42, 0.72, 0.08]);
    Libs.mat4.rotateZ(leftShoulderNode.baseMatrix, leftShoulderNode.baseMatrix, Libs.degToRad(-28));
    torsoNode.addChild(leftShoulderNode);

    const leftSleeveMat = Libs.mat4.create();
    Libs.mat4.translate(leftSleeveMat, leftSleeveMat, [0.0, -0.45, 0.0]);
    leftShoulderNode.addMesh(sleeveMesh, leftSleeveMat);

    const leftCuffMat = Libs.mat4.create();
    Libs.mat4.translate(leftCuffMat, leftCuffMat, [0.0, -0.95, 0.0]);
    leftShoulderNode.addMesh(cuffFurMesh, leftCuffMat);

    const leftHandNode = new SceneNode("LeftHandNode");
    Libs.mat4.translate(leftHandNode.baseMatrix, leftHandNode.baseMatrix, [0.0, -1.25, 0.05]);
    leftShoulderNode.addChild(leftHandNode);
    leftHandNode.addMesh(handPalmMesh);

    const leftThumbMat = Libs.mat4.create();
    Libs.mat4.translate(leftThumbMat, leftThumbMat, [0.28, 0.10, 0.22]);
    Libs.mat4.rotateZ(leftThumbMat, leftThumbMat, Libs.degToRad(-35));
    leftHandNode.addMesh(handThumbMesh, leftThumbMat);

    const rightShoulderNode = new SceneNode("RightShoulderNode");
    Libs.mat4.translate(rightShoulderNode.baseMatrix, rightShoulderNode.baseMatrix, [1.42, 0.72, 0.08]);
    Libs.mat4.rotateZ(rightShoulderNode.baseMatrix, rightShoulderNode.baseMatrix, Libs.degToRad(32));
    Libs.mat4.rotateX(rightShoulderNode.baseMatrix, rightShoulderNode.baseMatrix, Libs.degToRad(-22));
    torsoNode.addChild(rightShoulderNode);

    const rightSleeveMat = Libs.mat4.create();
    Libs.mat4.translate(rightSleeveMat, rightSleeveMat, [0.0, -0.45, 0.0]);
    rightShoulderNode.addMesh(sleeveMesh, rightSleeveMat);

    const rightCuffMat = Libs.mat4.create();
    Libs.mat4.translate(rightCuffMat, rightCuffMat, [0.0, -0.95, 0.0]);
    rightShoulderNode.addMesh(cuffFurMesh, rightCuffMat);

    const rightHandNode = new SceneNode("RightHandNode");
    Libs.mat4.translate(rightHandNode.baseMatrix, rightHandNode.baseMatrix, [0.0, -1.25, 0.05]);
    rightShoulderNode.addChild(rightHandNode);
    rightHandNode.addMesh(handPalmMesh);

    const rightThumbMat = Libs.mat4.create();
    Libs.mat4.translate(rightThumbMat, rightThumbMat, [-0.28, 0.10, 0.22]);
    Libs.mat4.rotateZ(rightThumbMat, rightThumbMat, Libs.degToRad(35));
    rightHandNode.addMesh(handThumbMesh, rightThumbMat);

    // Senjata Jet Hammer King Dedede
    const hammerNode = new SceneNode("HammerNode");
    Libs.mat4.translate(hammerNode.baseMatrix, hammerNode.baseMatrix, [0.05, -0.05, 0.15]);
    Libs.mat4.rotateX(hammerNode.baseMatrix, hammerNode.baseMatrix, Libs.degToRad(65));
    Libs.mat4.rotateZ(hammerNode.baseMatrix, hammerNode.baseMatrix, Libs.degToRad(-18));
    rightHandNode.addChild(hammerNode);

    const handleMesh = new Mesh(gl, GeometryGenerator.createCylinder(0.14, 0.16, 3.4, 16, 28, true), COL_WOOD_DARK, 28.0, 0.3);
    const handleOffset = Libs.mat4.create();
    Libs.mat4.translate(handleOffset, handleOffset, [0.0, 0.95, 0.0]);
    hammerNode.addMesh(handleMesh, handleOffset);

    const pommelMesh = new Mesh(gl, GeometryGenerator.createEllipsoid(0.24, 0.18, 0.24, 14, 20), COL_GOLD, 64.0, 0.8);
    const pommelOffset = Libs.mat4.create();
    Libs.mat4.translate(pommelOffset, pommelOffset, [0.0, -0.78, 0.0]);
    hammerNode.addMesh(pommelMesh, pommelOffset);

    const hammerHeadNode = new SceneNode("HammerHeadNode");
    Libs.mat4.translate(hammerHeadNode.baseMatrix, hammerHeadNode.baseMatrix, [0.0, 2.35, 0.0]);
    hammerNode.addChild(hammerHeadNode);

    const barrelMesh = new Mesh(gl, GeometryGenerator.createCylinder(0.72, 0.72, 1.95, 16, 36, true), COL_WOOD_DARK, 25.0, 0.28);
    const barrelMat = Libs.mat4.create();
    Libs.mat4.rotateX(barrelMat, barrelMat, Math.PI / 2);
    hammerHeadNode.addMesh(barrelMesh, barrelMat);

    const padMesh = new Mesh(gl, GeometryGenerator.createCylinder(0.64, 0.68, 0.16, 8, 36, true), COL_WOOD_LIGHT, 20.0, 0.2);
    [-0.98, 0.98].forEach(zPos => {
        const pMat = Libs.mat4.create();
        Libs.mat4.translate(pMat, pMat, [0.0, 0.0, zPos]);
        Libs.mat4.rotateX(pMat, pMat, Math.PI / 2);
        hammerHeadNode.addMesh(padMesh, pMat);
    });

    const ironBandMesh = new Mesh(gl, GeometryGenerator.createCylinder(0.75, 0.75, 0.20, 8, 36, true), COL_STEEL, 72.0, 0.85);
    const studConeMesh = new Mesh(gl, GeometryGenerator.createCone(0.11, 0.11, 0.18, 10, 16), COL_GOLD, 72.0, 0.85);

    [-0.68, 0.68].forEach(zBand => {
        const bMat = Libs.mat4.create();
        Libs.mat4.translate(bMat, bMat, [0.0, 0.0, zBand]);
        Libs.mat4.rotateX(bMat, bMat, Math.PI / 2);
        hammerHeadNode.addMesh(ironBandMesh, bMat);

        for (let k = 0; k < 8; ++k) {
            const ang = (k / 8) * 2.0 * Math.PI;
            const sMat = Libs.mat4.create();
            Libs.mat4.translate(sMat, sMat, [0.0, 0.0, zBand]);
            Libs.mat4.rotateZ(sMat, sMat, ang);
            Libs.mat4.translate(sMat, sMat, [0.0, 0.74, 0.0]);
            hammerHeadNode.addMesh(studConeMesh, sMat);
        }
    });

    const jetNozzleGeom = GeometryGenerator.createHyperboloidOneSheet(0.28, 0.28, 0.25, -0.8, 0.8, 14, 24, 0, 2 * Math.PI, 0.04);
    const jetNozzleMesh = new Mesh(gl, jetNozzleGeom, COL_STEEL, 80.0, 0.9);
    const nozzleMat = Libs.mat4.create();
    Libs.mat4.translate(nozzleMat, nozzleMat, [0.0, 0.0, -1.18]);
    Libs.mat4.rotateX(nozzleMat, nozzleMat, Math.PI / 2);
    hammerHeadNode.addMesh(jetNozzleMesh, nozzleMat);

    // Kaki / Sepatu Kuning King Dedede
    const footMesh = new Mesh(gl, GeometryGenerator.createEllipsoid(0.54, 0.34, 0.82, 20, 28), COL_MITTEN, 32.0, 0.35);

    const leftFootNode = new SceneNode("LeftFootNode");
    Libs.mat4.translate(leftFootNode.baseMatrix, leftFootNode.baseMatrix, [-0.72, -1.52, 0.28]);
    Libs.mat4.rotateY(leftFootNode.baseMatrix, leftFootNode.baseMatrix, Libs.degToRad(12));
    torsoNode.addChild(leftFootNode);
    leftFootNode.addMesh(footMesh);

    const rightFootNode = new SceneNode("RightFootNode");
    Libs.mat4.translate(rightFootNode.baseMatrix, rightFootNode.baseMatrix, [0.72, -1.52, 0.28]);
    Libs.mat4.rotateY(rightFootNode.baseMatrix, rightFootNode.baseMatrix, Libs.degToRad(-12));
    torsoNode.addChild(rightFootNode);
    rightFootNode.addMesh(footMesh);

    return {
        characterRoot,
        torsoNode,
        headNode,
        lowerBeakNode,
        hatNode,
        pomPomNode,
        bellyNode,
        leftShoulderNode,
        leftHandNode,
        rightShoulderNode,
        rightHandNode,
        hammerNode,
        hammerHeadNode,
        leftFootNode,
        rightFootNode
    };
}

/**
 * MEMBANGUN ENVIRONMENT DREAM LAND
 */
function buildEnvironment(gl) {
    const envRoot = new SceneNode("EnvironmentRoot");

    const grassPlatform = new Mesh(gl, GeometryGenerator.createCylinder(6.2, 6.2, 0.35, 6, 64, true), [0.28, 0.76, 0.34], 16.0, 0.15);
    const grassMat = Libs.mat4.create();
    Libs.mat4.translate(grassMat, grassMat, [0.0, -1.70, 0.0]);
    envRoot.addMesh(grassPlatform, grassMat);

    const stoneBase = new Mesh(gl, GeometryGenerator.createCylinder(6.5, 5.8, 0.85, 8, 64, true), [0.88, 0.84, 0.76], 20.0, 0.2);
    const stoneMat = Libs.mat4.create();
    Libs.mat4.translate(stoneMat, stoneMat, [0.0, -2.25, 0.0]);
    envRoot.addMesh(stoneBase, stoneMat);

    const goldRing = new Mesh(gl, GeometryGenerator.createCylinder(6.32, 6.32, 0.14, 4, 64, true), [0.95, 0.78, 0.18], 64.0, 0.8);
    const ringMat = Libs.mat4.create();
    Libs.mat4.translate(ringMat, ringMat, [0.0, -1.68, 0.0]);
    envRoot.addMesh(goldRing, ringMat);

    const pillarMesh = new Mesh(gl, GeometryGenerator.createHyperboloidOneSheet(0.32, 0.32, 0.85, -1.2, 1.2, 16, 24, 0, 2 * Math.PI, 0), [0.92, 0.90, 0.95], 32.0, 0.4);
    const orbMesh = new Mesh(gl, GeometryGenerator.createEllipsoid(0.38, 0.38, 0.38, 16, 24), [0.98, 0.82, 0.15], 72.0, 0.85);

    const pillarAngles = [Libs.degToRad(145), Libs.degToRad(215), Libs.degToRad(180)];
    pillarAngles.forEach((ang, idx) => {
        const radius = idx === 2 ? 5.2 : 5.0;
        const heightScale = idx === 2 ? 1.25 : 0.95;
        const px = Math.sin(ang) * radius;
        const pz = Math.cos(ang) * radius;

        const pMat = Libs.mat4.create();
        Libs.mat4.translate(pMat, pMat, [px, -0.55 + (heightScale - 1) * 0.8, pz]);
        Libs.mat4.scale(pMat, pMat, [1.0, heightScale, 1.0]);
        envRoot.addMesh(pillarMesh, pMat);

        const oMat = Libs.mat4.create();
        Libs.mat4.translate(oMat, oMat, [px, 0.85 * heightScale, pz]);
        envRoot.addMesh(orbMesh, oMat);
    });

    const starNodes = [];
    const starCoreMesh = new Mesh(gl, GeometryGenerator.createEllipsoid(0.22, 0.22, 0.14, 14, 20), [1.0, 0.88, 0.12], 64.0, 0.8);
    const starPointMesh = new Mesh(gl, GeometryGenerator.createCone(0.15, 0.10, 0.34, 10, 16), [1.0, 0.88, 0.12], 64.0, 0.8);

    for (let s = 0; s < 5; ++s) {
        const starNode = new SceneNode("WarpStar_" + s);
        starNode.addMesh(starCoreMesh);
        for (let p = 0; p < 5; ++p) {
            const pAngle = (p / 5) * 2.0 * Math.PI;
            const ptMat = Libs.mat4.create();
            Libs.mat4.rotateZ(ptMat, ptMat, pAngle);
            Libs.mat4.translate(ptMat, ptMat, [0.0, 0.16, 0.0]);
            starNode.addMesh(starPointMesh, ptMat);
        }
        envRoot.addChild(starNode);
        starNodes.push({
            node: starNode,
            baseAngle: (s / 5) * 2.0 * Math.PI,
            radius: 4.3 + (s % 2) * 0.7,
            height: 0.8 + (s % 3) * 0.95,
            speed: 0.7 + s * 0.15
        });
    }

    return { envRoot, starNodes };
}

/**
 * UPDATE SELURUH ANIMASI TRANSFORMASI SECARA OTOMATIS
 */
function updateAnimations(t) {
    Object.values(dededeNodes).forEach(node => {
        if (node && node.resetAnim) node.resetAnim();
    });

    // 1. Translate & Scaling (Berjalan, Melompat Squash-Stretch, dan Pernapasan Perut)
    const walkBobY = Math.abs(Math.sin(t * 3.6)) * 0.18;
    const walkSwayX = Math.cos(t * 1.8) * 0.25;

    const jumpCycle = (t * 0.85) % (2.0 * Math.PI);
    const jumpWave = Math.max(0.0, Math.sin(jumpCycle));
    const jumpY = Math.pow(jumpWave, 0.75) * 0.65;

    const stretch = 1.0 + 0.07 * Math.sin(jumpCycle * 2.0);
    const squashScale = [1.0 / Math.sqrt(stretch), stretch, 1.0 / Math.sqrt(stretch)];

    Libs.mat4.translate(dededeNodes.characterRoot.animMatrix, dededeNodes.characterRoot.animMatrix, [
        walkSwayX,
        walkBobY + jumpY,
        0.0
    ]);
    Libs.mat4.scale(dededeNodes.torsoNode.animMatrix, dededeNodes.torsoNode.animMatrix, squashScale);

    Libs.mat4.rotateZ(dededeNodes.torsoNode.animMatrix, dededeNodes.torsoNode.animMatrix, Math.sin(t * 3.6) * Libs.degToRad(5.5));
    Libs.mat4.rotateY(dededeNodes.torsoNode.animMatrix, dededeNodes.torsoNode.animMatrix, Math.cos(t * 1.8) * Libs.degToRad(10));

    const breath = 1.0 + 0.045 * Math.sin(t * 3.2);
    Libs.mat4.scale(dededeNodes.bellyNode.animMatrix, dededeNodes.bellyNode.animMatrix, [breath, breath, breath * 1.03]);

    // 2. Rotate & Hierarchical Transformation (Kepala, Paruh, Pom-Pom, Lengan, dan Kaki)
    Libs.mat4.rotateY(dededeNodes.headNode.animMatrix, dededeNodes.headNode.animMatrix, Math.sin(t * 1.8) * Libs.degToRad(14));
    Libs.mat4.rotateX(dededeNodes.headNode.animMatrix, dededeNodes.headNode.animMatrix, Math.cos(t * 3.2) * Libs.degToRad(5));

    const beakOpenAngle = (0.5 + 0.5 * Math.sin(t * 4.5)) * Libs.degToRad(16);
    Libs.mat4.rotateX(dededeNodes.lowerBeakNode.animMatrix, dededeNodes.lowerBeakNode.animMatrix, beakOpenAngle);

    Libs.mat4.translate(dededeNodes.pomPomNode.animMatrix, dededeNodes.pomPomNode.animMatrix, [
        Math.sin(t * 5.0) * 0.04,
        Math.abs(Math.cos(t * 5.0)) * 0.05,
        0.0
    ]);

    const stride = Math.sin(t * 3.6) * Libs.degToRad(28);
    Libs.mat4.rotateX(dededeNodes.leftFootNode.animMatrix, dededeNodes.leftFootNode.animMatrix, stride);
    Libs.mat4.rotateX(dededeNodes.rightFootNode.animMatrix, dededeNodes.rightFootNode.animMatrix, -stride);

    Libs.mat4.rotateX(dededeNodes.leftShoulderNode.animMatrix, dededeNodes.leftShoulderNode.animMatrix, Math.cos(t * 3.6) * Libs.degToRad(22));
    Libs.mat4.rotateZ(dededeNodes.leftShoulderNode.animMatrix, dededeNodes.leftShoulderNode.animMatrix, Math.sin(t * 2.4) * Libs.degToRad(10));
    Libs.mat4.rotateZ(dededeNodes.leftHandNode.animMatrix, dededeNodes.leftHandNode.animMatrix, Math.sin(t * 4.0) * Libs.degToRad(15));

    // 3. Rotate Arbitrary Axis (Ayunan Diagonal Bahu Kanan & Putaran Mekanis Jet Hammer)
    const swingAngle = Math.sin(t * 2.8) * Libs.degToRad(38);
    const diagonalSwingAxis = [0.82, 0.45, -0.35];
    Libs.mat4.rotateArbitraryAxis(
        dededeNodes.rightShoulderNode.animMatrix,
        dededeNodes.rightShoulderNode.animMatrix,
        swingAngle,
        diagonalSwingAxis,
        [0.0, 0.0, 0.0]
    );

    const arbitrarySpinAxis = [0.18, 0.96, 0.20];
    Libs.mat4.rotateArbitraryAxis(
        dededeNodes.hammerHeadNode.animMatrix,
        dededeNodes.hammerHeadNode.animMatrix,
        t * 5.5,
        arbitrarySpinAxis,
        [0.0, 0.0, 0.0]
    );

    // 4. Animasi Bintang Warp Star di Environment
    envNodes.starNodes.forEach((star, idx) => {
        star.node.resetAnim();
        const orbitAngle = star.baseAngle + t * 0.45 * star.speed;
        const sx = Math.cos(orbitAngle) * star.radius;
        const sz = Math.sin(orbitAngle) * star.radius;
        const sy = star.height + Math.sin(t * 2.5 + idx) * 0.28;

        Libs.mat4.translate(star.node.animMatrix, star.node.animMatrix, [sx, sy, sz]);
        Libs.mat4.rotateArbitraryAxis(
            star.node.animMatrix,
            star.node.animMatrix,
            t * 2.8,
            [0.3, 1.0, 0.4]
        );
    });
}

/**
 * KONTROL INTERAKSI KAMERA DENGAN MOUSE (DRAG & SCROLL ZOOM)
 */
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
        appState.camDist = Math.max(4.5, Math.min(20.0, appState.camDist + e.deltaY * 0.006));
    }, { passive: false });
}

function main() {
    const canvas = document.getElementById("mycanvas");
    gl = canvas.getContext("webgl", { antialias: true });
    if (!gl) {
        alert("Browser tidak mendukung WebGL!");
        return;
    }

    shaderInfo = initShaders(gl);
    dededeNodes = buildKingDedede(gl);
    envNodes = buildEnvironment(gl);
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

        updateAnimations(appState.accumulatedTime);
        envNodes.envRoot.updateAndDraw(shaderInfo, null);
        dededeNodes.characterRoot.updateAndDraw(shaderInfo, null);

        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
}

main();