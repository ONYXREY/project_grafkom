

import { GeometryGenerator, Mesh, SceneNode } from '../king_dedede_ObjectAnimation/object.js';

export function buildEnvironment(gl) {
    const envRoot = new SceneNode("EnvironmentRoot");

    // Panggung Arena Utama (Permukaan atas rumput berada tepat di Y = -1.525)
    const grassPlatform = new Mesh(
        gl,
        GeometryGenerator.createCylinder(8.5, 8.5, 0.35, 6, 72, true),
        [0.26, 0.78, 0.36],
        16.0,
        0.15
    );
    const grassMat = Libs.mat4.create();
    //lapisan rumput berada tepat di Y = -1.70
    Libs.mat4.translate(grassMat, grassMat, [0.0, -1.70, 0.0]);
    envRoot.addMesh(grassPlatform, grassMat);

    const stoneBase = new Mesh(
        gl,
        // batu / lapisan paling dasar 
        GeometryGenerator.createCylinder(8.9, 7.9, 0.95, 8, 72, true),
        [0.88, 0.85, 0.78],
        20.0,
        0.20
    );
    // lapisan batu berada tepat di sumbu Y (tepatnya di y= -2.30)
    const stoneMat = Libs.mat4.create();
    Libs.mat4.translate(stoneMat, stoneMat, [0.0, -2.30, 0.0]);
    envRoot.addMesh(stoneBase, stoneMat);

    // ring emas
    const goldRing = new Mesh(
        gl,
        GeometryGenerator.createCylinder(8.68, 8.68, 0.15, 4, 72, true),
        [0.96, 0.80, 0.18],
        64.0,
        0.80
    );
    // ring emas berada di sumbu Y 
    const ringMat = Libs.mat4.create();
    Libs.mat4.translate(ringMat, ringMat, [0.0, -1.68, 0.0]);
    envRoot.addMesh(goldRing, ringMat);
    

    //  Pilar-Pilar Istana 
    const pillarMesh = new Mesh(
        gl,
        GeometryGenerator.createHyperboloidOneSheet(0.35, 0.35, 1.0, -1.2, 1.2, 16, 28, 0, 2 * Math.PI, 0),
        [0.92, 0.90, 0.96],
        36.0,
        0.40
    );
    const domeCapMesh = new Mesh(
        gl,
        GeometryGenerator.createEllipticParaboloid(0.52, 0.52, 0.48, 14, 24, true),
        [0.98, 0.80, 0.15],
        72.0,
        0.85
    );

    const pillarCoords = [
        [-6.0, -4.0, 1.0],
        [-3.2, -6.0, 1.15],
        [ 3.2, -6.0, 1.15],
        [ 6.0, -4.0, 1.0]
    ];
    pillarCoords.forEach(([px, pz, hScale]) => {
        const pMat = Libs.mat4.create();
        Libs.mat4.translate(pMat, pMat, [px, -0.40 + (hScale - 1) * 0.8, pz]);
        Libs.mat4.scale(pMat, pMat, [1.0, hScale, 1.0]);
        envRoot.addMesh(pillarMesh, pMat);

        const cMat = Libs.mat4.create();
        Libs.mat4.translate(cMat, cMat, [px, 0.90 * hScale, pz]);
        envRoot.addMesh(domeCapMesh, cMat);
    });

    // Pohon 
    const trunkMesh = new Mesh(
        gl,
        GeometryGenerator.createCylinder(0.26, 0.40, 2.1, 10, 24, true),
        [0.52, 0.32, 0.16],
        14.0,
        0.10
    );
    const foliageMesh = new Mesh(
        gl,
        GeometryGenerator.createEllipsoid(1.10, 0.90, 1.10, 18, 28),
        [0.20, 0.72, 0.30],
        18.0,
        0.15
    );

    [-6.8, 6.8].forEach(tx => {
        const tz = -1.5;
        const trMat = Libs.mat4.create();
        Libs.mat4.translate(trMat, trMat, [tx, -0.55, tz]);
        envRoot.addMesh(trunkMesh, trMat);

        const fMat1 = Libs.mat4.create();
        Libs.mat4.translate(fMat1, fMat1, [tx, 0.80, tz]);
        envRoot.addMesh(foliageMesh, fMat1);

        const fMat2 = Libs.mat4.create();
        Libs.mat4.translate(fMat2, fMat2, [tx * 0.94, 1.38, tz]);
        Libs.mat4.scale(fMat2, fMat2, [0.76, 0.76, 0.76]);
        envRoot.addMesh(foliageMesh, fMat2);
    });

    //  Awan Putih 
    const cloudNodes = [];
    const cloudPuffMesh = new Mesh(
        gl,
        GeometryGenerator.createEllipsoid(0.75, 0.46, 0.52, 16, 24),
        [0.98, 0.99, 1.00],
        12.0,
        0.10
    );
    const cloudConfigs = [
        { x: -5.2, y: 4.3, z: -5.5, speed: 0.35 },
        { x:  0.4, y: 5.0, z: -6.5, speed: 0.25 },
        { x:  5.4, y: 4.1, z: -5.2, speed: 0.40 }
    ];
    cloudConfigs.forEach((cfg, idx) => {
        const cNode = new SceneNode("Cloud_" + idx);
        Libs.mat4.translate(cNode.baseMatrix, cNode.baseMatrix, [cfg.x, cfg.y, cfg.z]);
        cNode.addMesh(cloudPuffMesh);

        const leftPuff = Libs.mat4.create();
        Libs.mat4.translate(leftPuff, leftPuff, [-0.55, -0.08, 0.05]);
        Libs.mat4.scale(leftPuff, leftPuff, [0.75, 0.75, 0.75]);
        cNode.addMesh(cloudPuffMesh, leftPuff);

        const rightPuff = Libs.mat4.create();
        Libs.mat4.translate(rightPuff, rightPuff, [0.55, -0.08, 0.05]);
        Libs.mat4.scale(rightPuff, rightPuff, [0.75, 0.75, 0.75]);
        cNode.addMesh(cloudPuffMesh, rightPuff);

        envRoot.addChild(cNode);
        cloudNodes.push({ node: cNode, speed: cfg.speed, phase: idx * 2.0 });
    });

    // Bintang-Bintang 
    const starNodes = [];
    const starCoreMesh = new Mesh(
        gl,
        GeometryGenerator.createEllipsoid(0.22, 0.22, 0.14, 14, 20),
        [1.0, 0.88, 0.12],
        64.0,
        0.80
    );
    const starPointMesh = new Mesh(
        gl,
        GeometryGenerator.createCone(0.15, 0.10, 0.34, 10, 16),
        [1.0, 0.88, 0.12],
        64.0,
        0.80
    );

    for (let s = 0; s < 6; ++s) {
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
            baseAngle: (s / 6) * 2.0 * Math.PI,
            radius: 6.4 + (s % 2) * 0.75,
            height: 0.7 + (s % 3) * 1.0,
            speed: 0.50 + s * 0.10
        });
    }

    return {
        envRoot,
        cloudNodes,
        starNodes
    };
}

export function updateEnvironmentAnimation(envData, t) {
   

    // Animasi Awan 
    if (envData.cloudNodes) {
        envData.cloudNodes.forEach(c => {
            c.node.resetAnim();
            const driftX = Math.sin(t * c.speed + c.phase) * 0.60;
            const driftY = Math.cos(t * c.speed * 1.5 + c.phase) * 0.10;
            Libs.mat4.translate(c.node.animMatrix, c.node.animMatrix, [driftX, driftY, 0.0]);
        });
    }

    //  Animasi Bintang 
    if (envData.starNodes) {
        envData.starNodes.forEach((star, idx) => {
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
}
