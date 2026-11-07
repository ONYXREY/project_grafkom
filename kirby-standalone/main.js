import {LocalPose,identityMatrix,multiplyMatrices,perspective,cameraInverse} from "./libs.js";
import {createKirby,SceneNode,GeometryData,Mesh} from "./object.js";

// Host responsibilities only: one canvas/context/camera/RAF and removable UI.
// Character geometry, authored poses and animation are in object.js.
const Node=SceneNode;

/** Small host camera exposing the operations used by the existing view controls. */
class ViewCamera {
    constructor() {
        this.transform=new LocalPose();this.aspect=1;this.fov=Math.PI/3;
        this.projection=identityMatrix();this.view=identityMatrix();
        this.viewProjectionMatrix={elements:identityMatrix()};
    }
    /** Set vertical field of view in radians; @returns {ViewCamera} this. */
    setFov(fov){this.fov=fov;return this;}
    /** Set viewport aspect; @returns {ViewCamera} this. */
    setAspect(aspect){this.aspect=aspect;return this;}
    /** Rebuild camera matrices into reusable arrays; @returns {ViewCamera} this. */
    updateCameraMatrices(){
        this.transform.updateLocalMatrix();cameraInverse(this.view,this.transform.localMatrix.elements);
        perspective(this.projection,this.fov,this.aspect);
        multiplyMatrices(this.viewProjectionMatrix.elements,this.projection,this.view);return this;
    }
}

const INSPECTION_PIVOT_Y = 1;
// Includes the measured 2.785-unit character envelope and the platform's
// lower rim (3.36 units from the existing Y=1 inspection pivot).
const INSPECTION_FRAME_RADIUS = 3.4;
const HORIZONTAL_FRAME_RADIUS = 2.45;
const FOV = Math.PI / 3;
const PITCH = -0.16;
const YAW = 0.11;
const FRAME_PADDING = 1.06;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;
const ZOOM_SENSITIVITY = 0.0015;
const ZOOM_RESPONSE = 12;

/** Camera-distance zoom and padded vertical/radial fits for the complete stage. */
class KirbyInspectionCamera {
    #camera;
    #defaultDistance = 1;
    #zoom = 1;
    #targetZoom = 1;

    /**
     * Initializes the application's camera orientation and default framing.
     * @param {object} camera - Existing PerspectiveCamera; no resource ownership.
     */
    constructor(camera) {
        this.#camera = camera;
        camera.setFov(FOV);
        camera.transform.setRotationFromEuler(PITCH, YAW, 0);
        this.resize(camera.aspect);
    }

    /** @returns {number} Smoothed distance factor relative to the current fit. */
    get zoom() { return this.#zoom; }
    /** @returns {number} User-selected distance factor, retained on resize. */
    get targetZoom() { return this.#targetZoom; }
    /** @returns {number} Current fitted, unzoomed camera distance. */
    get defaultDistance() { return this.#defaultDistance; }
    /** @returns {number} Current camera distance from the inspection pivot. */
    get distance() { return this.#defaultDistance * this.#zoom; }

    /**
     * Fits separate vertical and horizontal envelopes around the drag pivot.
     * The smaller radial bound avoids unnecessarily tiny narrow-screen views.
     * Extreme tilted close-ups can still be explored with user-controlled zoom.
     * @param {number} aspect - Positive viewport width divided by height.
     * @returns {KirbyInspectionCamera} This viewing controller.
     */
    resize(aspect) {
        if (!Number.isFinite(aspect) || aspect <= 0) throw new RangeError("Camera aspect must be positive.");
        this.#camera.setAspect(aspect);
        const halfAngle = Math.atan(Math.tan(FOV / 2) * aspect);
        this.#defaultDistance = FRAME_PADDING*Math.max(INSPECTION_FRAME_RADIUS/Math.sin(FOV/2),
            HORIZONTAL_FRAME_RADIUS/Math.sin(halfAngle));
        this.#applyDistance();
        return this;
    }

    /**
     * Changes the bounded zoom target using normalized wheel pixels.
     * @param {number} pixels - Positive zooms out; negative zooms in.
     * @returns {KirbyInspectionCamera} This viewing controller.
     */
    zoomBy(pixels) {
        if (!Number.isFinite(pixels)) return this;
        const factor = Math.exp(Math.max(-1000, Math.min(1000, pixels)) * ZOOM_SENSITIVITY);
        this.#targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.#targetZoom * factor));
        return this;
    }

    /**
     * Smooths distance independently of whether character animation is stopped.
     * @param {number} elapsed - Non-negative frame delta in seconds.
     * @returns {KirbyInspectionCamera} This viewing controller.
     */
    update(elapsed) {
        if (!Number.isFinite(elapsed) || elapsed < 0) throw new RangeError("Viewing delta must be non-negative.");
        this.#zoom += (this.#targetZoom - this.#zoom) * (1 - Math.exp(-ZOOM_RESPONSE * elapsed));
        if (Math.abs(this.#zoom - this.#targetZoom) < 1e-5) this.#zoom = this.#targetZoom;
        this.#applyDistance();
        return this;
    }

    /** @returns {KirbyInspectionCamera} Restores fitted zoom immediately. */
    reset() {
        this.#zoom = this.#targetZoom = 1;
        this.#applyDistance();
        return this;
    }

    #applyDistance() {
        const distance = this.distance;
        // Camera local +Z transformed by Rx(pitch) * Ry(yaw), so the viewing
        // axis passes through the same pivot used by inspection rotation.
        this.#camera.transform.setPosition(distance * Math.sin(YAW),
            INSPECTION_PIVOT_Y - distance * Math.sin(PITCH) * Math.cos(YAW),
            distance * Math.cos(PITCH) * Math.cos(YAW));
    }
}


const HORIZONTAL_SENSITIVITY = 0.006;
const VERTICAL_SENSITIVITY = 0.004;
const PITCH_LIMIT = 1.5;
const TWO_PI = 2 * Math.PI;

/**
 * Creates the neutral preview parent without changing Kirby's internal hierarchy.
 *
 * @param {Node} characterRoot - The existing character root.
 * @returns {Node} The inspection node containing the character root.
 */
function createInspectionRoot(characterRoot) {
    const inspectionRoot = new Node({ name: "inspectionRoot" });
    inspectionRoot.addChild(characterRoot);
    return inspectionRoot;
}

/** Pointer-driven, preview-only yaw and pitch control for an inspection node. */
class InspectionControls {
    #canvas;
    #inspectionRoot;
    #eventTarget;
    #resetButton;
    #viewCamera;
    #wheelHandler;
    #yaw = 0;
    #pitch = 0;
    #activePointerId = null;
    #lastX = 0;
    #lastY = 0;
    #attached = false;
    #disposed = false;
    #pointerDownHandler;
    #pointerMoveHandler;
    #pointerUpHandler;
    #pointerCancelHandler;
    #lostCaptureHandler;
    #keyDownHandler;
    #resetClickHandler;

    /**
     * Initializes controls without installing listeners or modifying the node.
     *
     * @param {HTMLCanvasElement} canvas - The WebGL canvas receiving pointer presses.
     * @param {Node} inspectionRoot - The neutral node to rotate.
     * @param {Window} eventTarget - Window receiving pointer movement and keyboard input.
     * @param {HTMLButtonElement} resetButton - The overlay reset button.
     * @param {object|null} [viewCamera=null] - Application distance/zoom controller.
     */
    constructor(canvas, inspectionRoot, eventTarget, resetButton, viewCamera = null) {
        if (!canvas || typeof canvas.addEventListener !== "function" || typeof canvas.removeEventListener !== "function") {
            throw new TypeError("InspectionControls requires an event-capable canvas.");
        }
        if (!(inspectionRoot instanceof Node)) {
            throw new TypeError("InspectionControls requires an inspection Node.");
        }
        if (!eventTarget || typeof eventTarget.addEventListener !== "function" || typeof eventTarget.removeEventListener !== "function") {
            throw new TypeError("InspectionControls requires an event-capable window.");
        }
        if (!resetButton || typeof resetButton.addEventListener !== "function" || typeof resetButton.removeEventListener !== "function") {
            throw new TypeError("InspectionControls requires an event-capable reset button.");
        }

        this.#canvas = canvas;
        this.#inspectionRoot = inspectionRoot;
        this.#eventTarget = eventTarget;
        this.#resetButton = resetButton;
        this.#viewCamera = viewCamera;
        this.#wheelHandler = this.#onWheel.bind(this);
        this.#pointerDownHandler = this.#onPointerDown.bind(this);
        this.#pointerMoveHandler = this.#onPointerMove.bind(this);
        this.#pointerUpHandler = this.#onPointerUp.bind(this);
        this.#pointerCancelHandler = this.#onPointerCancel.bind(this);
        this.#lostCaptureHandler = this.#onLostCapture.bind(this);
        this.#keyDownHandler = this.#onKeyDown.bind(this);
        this.#resetClickHandler = this.reset.bind(this);
    }

    /** @returns {number} Current horizontal inspection angle in radians. */
    get yaw() { return this.#yaw; }

    /** @returns {number} Current vertical inspection angle in radians. */
    get pitch() { return this.#pitch; }

    /** @returns {boolean} Whether one pointer is currently dragging. */
    get dragging() { return this.#activePointerId !== null; }

    /** @returns {boolean} Whether these controls have been disposed. */
    get disposed() { return this.#disposed; }

    /**
     * Installs input listeners and applies the front-facing default orientation.
     *
     * @returns {InspectionControls} These controls.
     * @throws {Error} If the controls have already been disposed.
     */
    attach() {
        if (this.#disposed) throw new Error("Disposed inspection controls cannot be attached.");
        if (this.#attached) return this;

        this.#canvas.addEventListener("pointerdown", this.#pointerDownHandler);
        this.#canvas.addEventListener("lostpointercapture", this.#lostCaptureHandler);
        this.#canvas.addEventListener("wheel", this.#wheelHandler, { passive: false });
        this.#eventTarget.addEventListener("pointermove", this.#pointerMoveHandler);
        this.#eventTarget.addEventListener("pointerup", this.#pointerUpHandler);
        this.#eventTarget.addEventListener("pointercancel", this.#pointerCancelHandler);
        this.#eventTarget.addEventListener("keydown", this.#keyDownHandler);
        this.#resetButton.addEventListener("click", this.#resetClickHandler);
        this.#attached = true;
        this.#applyRotation();
        this.#viewCamera?.reset();
        return this;
    }

    /**
     * Restores the original front view without changing the character pose.
     *
     * @returns {InspectionControls} These controls.
     */
    reset() {
        if (this.#disposed) return this;
        this.#endDrag();
        this.#yaw = 0;
        this.#pitch = 0;
        this.#applyRotation();
        this.#viewCamera?.reset();
        return this;
    }

    /**
     * Releases capture, removes every installed listener, and disables input.
     *
     * @returns {InspectionControls} These controls.
     */
    dispose() {
        if (this.#disposed) return this;
        this.#endDrag();
        if (this.#attached) {
            this.#canvas.removeEventListener("pointerdown", this.#pointerDownHandler);
            this.#canvas.removeEventListener("lostpointercapture", this.#lostCaptureHandler);
            this.#canvas.removeEventListener("wheel", this.#wheelHandler);
            this.#eventTarget.removeEventListener("pointermove", this.#pointerMoveHandler);
            this.#eventTarget.removeEventListener("pointerup", this.#pointerUpHandler);
            this.#eventTarget.removeEventListener("pointercancel", this.#pointerCancelHandler);
            this.#eventTarget.removeEventListener("keydown", this.#keyDownHandler);
            this.#resetButton.removeEventListener("click", this.#resetClickHandler);
            this.#attached = false;
        }
        this.#disposed = true;
        return this;
    }

    #applyRotation() {
        // Intrinsic Y then X composes world-facing yaw before local inspection pitch.
        this.#inspectionRoot.transform.setRotationFromEuler(this.#pitch, this.#yaw, 0, "YXZ");
        const q = this.#inspectionRoot.transform.rotation;
        this.#inspectionRoot.transform.setPosition(
            -2 * (q.x * q.y - q.w * q.z) * INSPECTION_PIVOT_Y,
            2 * (q.x * q.x + q.z * q.z) * INSPECTION_PIVOT_Y,
            -2 * (q.y * q.z + q.w * q.x) * INSPECTION_PIVOT_Y
        );
    }

    #onPointerDown(event) {
        if (this.#disposed || this.#activePointerId !== null || !Number.isInteger(event.pointerId) ||
            !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY) ||
            (event.pointerType === "mouse" && event.button !== 0)) return;

        this.#activePointerId = event.pointerId;
        this.#lastX = event.clientX;
        this.#lastY = event.clientY;
        this.#canvas.focus?.({ preventScroll: true });
        event.preventDefault();
        if (typeof this.#canvas.setPointerCapture === "function") {
            try { this.#canvas.setPointerCapture(event.pointerId); } catch { /* Window listeners still track this drag. */ }
        }
    }

    #onPointerMove(event) {
        if (this.#disposed || event.pointerId !== this.#activePointerId ||
            !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;

        const nextYaw = this.#yaw + (event.clientX - this.#lastX) * HORIZONTAL_SENSITIVITY;
        const nextPitch = this.#pitch + (event.clientY - this.#lastY) * VERTICAL_SENSITIVITY;
        if (!Number.isFinite(nextYaw) || !Number.isFinite(nextPitch)) return;

        this.#yaw = ((nextYaw + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
        this.#pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, nextPitch));
        this.#lastX = event.clientX;
        this.#lastY = event.clientY;
        event.preventDefault();
        this.#applyRotation();
    }

    #onPointerUp(event) {
        if (event.pointerId === this.#activePointerId) this.#endDrag();
    }

    #onPointerCancel(event) {
        if (event.pointerId === this.#activePointerId) this.#endDrag();
    }

    #onLostCapture(event) {
        if (event.pointerId === this.#activePointerId) this.#activePointerId = null;
    }

    #onKeyDown(event) {
        if (this.#disposed || event.altKey || event.ctrlKey || event.metaKey ||
            event.target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || "")) return;
        const key = event.key?.toLowerCase();
        if (key === "r") {
            event.preventDefault();
            this.reset();
        } else if (event.target === this.#canvas) {
            if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) {
                this.#yaw += key === "arrowleft" ? -0.12 : key === "arrowright" ? 0.12 : 0;
                this.#pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT,
                    this.#pitch + (key === "arrowup" ? -0.12 : key === "arrowdown" ? 0.12 : 0)));
                this.#yaw = ((this.#yaw + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
                this.#applyRotation();
                event.preventDefault();
            } else if (["+", "=", "-", "_"].includes(key)) {
                this.#viewCamera?.zoomBy(key === "-" || key === "_" ? 180 : -180);
                event.preventDefault();
            }
        }
    }

    #onWheel(event) {
        if (this.#disposed || !this.#viewCamera || !Number.isFinite(event.deltaY)) return;
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.#canvas.clientHeight || 800 : 1;
        this.#viewCamera.zoomBy(event.deltaY * unit);
        event.preventDefault();
    }

    #endDrag() {
        const pointerId = this.#activePointerId;
        if (pointerId === null) return;
        this.#activePointerId = null;
        if (typeof this.#canvas.releasePointerCapture === "function") {
            try {
                if (typeof this.#canvas.hasPointerCapture !== "function" || this.#canvas.hasPointerCapture(pointerId)) {
                    this.#canvas.releasePointerCapture(pointerId);
                }
            } catch { /* Capture may already have been lost after cancellation. */ }
        }
    }
}

function requireElement(element, name) {
    if (element === null || typeof element !== "object" ||
        typeof element.addEventListener !== "function" ||
        typeof element.removeEventListener !== "function" ||
        typeof element.setAttribute !== "function") {
        throw new TypeError(`${name} must be an interactive element.`);
    }
}

/**
 * Coordinates the application information panel's accessible hide/show controls.
 *
 * This controller changes only HTML visibility and accessibility state. It has
 * no references to the scene, camera, animation, renderer, or inspection input.
 */
class InfoPanelControls {
    #panel;
    #hideButton;
    #showButton;
    #attached = false;
    #disposed = false;
    #onHide = () => this.hide();
    #onShow = () => this.show();

    constructor(panel, hideButton, showButton) {
        requireElement(panel, "Info panel");
        requireElement(hideButton, "Hide Info button");
        requireElement(showButton, "Show Info button");
        this.#panel = panel;
        this.#hideButton = hideButton;
        this.#showButton = showButton;
    }

    get hidden() { return this.#panel.hidden; }
    get attached() { return this.#attached; }
    get disposed() { return this.#disposed; }

    attach() {
        this.#requireActive();
        if (this.#attached) return this;
        this.#hideButton.addEventListener("click", this.#onHide);
        this.#showButton.addEventListener("click", this.#onShow);
        this.#attached = true;
        this.#applyState(false, false);
        return this;
    }

    hide() {
        this.#requireActive();
        this.#applyState(true, true);
        return this;
    }

    show() {
        this.#requireActive();
        this.#applyState(false, true);
        return this;
    }

    dispose() {
        if (this.#disposed) return this;
        if (this.#attached) {
            this.#hideButton.removeEventListener("click", this.#onHide);
            this.#showButton.removeEventListener("click", this.#onShow);
        }
        this.#attached = false;
        this.#disposed = true;
        return this;
    }

    #applyState(hidden, moveFocus) {
        this.#panel.hidden = hidden;
        this.#showButton.hidden = !hidden;
        this.#hideButton.setAttribute("aria-expanded", String(!hidden));
        this.#showButton.setAttribute("aria-expanded", String(!hidden));
        if (moveFocus) {
            const focusTarget = hidden ? this.#showButton : this.#hideButton;
            if (typeof focusTarget.focus === "function") focusTarget.focus();
        }
    }

    #requireActive() {
        if (this.#disposed) throw new Error("Disposed InfoPanelControls cannot be used.");
    }
}


/** Host-only, replaceable presentation settings. No values enter createKirby(). */
const PRESENTATION = Object.freeze({
    enabled: true,
    stage: Object.freeze({radius:2.15,thickness:.16,segments:96,
        top:Object.freeze([.49,.45,.61,1]),side:Object.freeze([.36,.32,.46,1])}),
    shadow: Object.freeze({enabled:true,offset:.006,radiusX:1.42,radiusZ:1.14,
        opacity:.28,airborneSpread:.22,airborneFade:.52,heightRange:.55,
        color:Object.freeze([.13,.10,.20])}),
    lighting: Object.freeze({key:Object.freeze([.45,.85,.60]),
        fill:Object.freeze([-.70,.25,.55]),weights:Object.freeze([.42,.48,.10])})
});

/** Measure real transformed foot vertices, independent of the host orbit.
 * @param {object} character - A newly authored createKirby instance.
 * @returns {number} Existing virtual ground height, not a new nominal floor.
 */
function measureGround(character) {
    character.root.updateWorldMatrices();let ground=Infinity;
    for(const foot of [character.parts.leftFoot,character.parts.rightFoot]) {
        const m=foot.worldMatrix,v=foot.mesh.geometry.vertices;
        for(let i=0;i<v.length;i+=3)
            ground=Math.min(ground,m[1]*v[i]+m[5]*v[i+1]+m[9]*v[i+2]+m[13]);
    }
    return ground;
}

/** Fixed, outward-wound top and side/bottom surfaces with separate hard normals.
 * @param {object} settings - Radius, thickness and segment count.
 * @returns {GeometryData[]} Two CPU geometries; upload only during setup.
 */
function createStageGeometry(settings) {
    const {radius,thickness,segments}=settings;
    const topPositions=[0,0,0],topNormals=[0,1,0],topIndices=[];
    const sidePositions=[],sideNormals=[],sideIndices=[];
    for(let i=0;i<=segments;i++) {
        const angle=i/segments*2*Math.PI,x=Math.cos(angle),z=Math.sin(angle);
        topPositions.push(radius*x,0,radius*z);topNormals.push(0,1,0);
        sidePositions.push(radius*x,0,radius*z,radius*x,-thickness,radius*z);
        sideNormals.push(x,0,z,x,0,z);
        if(i<segments) {
            topIndices.push(0,i+2,i+1);
            const a=2*i;sideIndices.push(a,a+2,a+1,a+2,a+3,a+1);
        }
    }
    const center=sidePositions.length/3;sidePositions.push(0,-thickness,0);sideNormals.push(0,-1,0);
    for(let i=0;i<=segments;i++) {
        const a=i/segments*2*Math.PI;sidePositions.push(radius*Math.cos(a),-thickness,radius*Math.sin(a));sideNormals.push(0,-1,0);
        if(i<segments)sideIndices.push(center,center+i+1,center+i+2);
    }
    const geometry=(positions,normals,indices)=>new GeometryData()
        .setAttribute("position",new Float32Array(positions),3)
        .setAttribute("normal",new Float32Array(normals),3).setIndices(new Uint16Array(indices));
    return [geometry(topPositions,topNormals,topIndices),geometry(sidePositions,sideNormals,sideIndices)];
}

const SHADOW_VERTEX_SOURCE=`
attribute vec3 aPosition;
uniform mat4 uModelMatrix;
uniform mat4 uViewProjectionMatrix;
varying vec2 vDisc;
void main(){vDisc=aPosition.xz;gl_Position=uViewProjectionMatrix*uModelMatrix*vec4(aPosition,1.0);}`;
const SHADOW_FRAGMENT_SOURCE=`
precision mediump float;
uniform vec4 uShadowColor;
varying vec2 vDisc;
void main(){
    float fade=1.0-smoothstep(0.05,1.0,length(vDisc));
    gl_FragColor=vec4(uShadowColor.rgb,uShadowColor.a*fade*sqrt(fade));
}`;

/** Removable host stage and analytic contact shadow; never a character part. */
class KirbyPresentation {
    /** Initialize CPU ownership only; @param {WebGLRenderingContext} gl Borrowed context.
     * @param {object} config Host presentation settings. */
    constructor(gl,config=PRESENTATION) {
        this.gl=gl;this.config=config;this.root=new SceneNode("presentationStage");this.root.useLocalPose=true;
        this.geometries=[];this.meshes=[];this.registry=new Map();this.shadowBuffers=[];this.shader=null;
        this.shadowPose=new LocalPose();this.shadowMatrix=identityMatrix();
        this.shadowColor=new Float32Array([...config.shadow.color,config.shadow.opacity]);
        this.groundHeight=0;this.restBodyHeight=0;this.bodyRise=0;this.disposed=false;this.ready=false;
    }
    /** Measure the authored ground and allocate presentation resources once.
     * @param {object} character Newly created rig, before playback/orbit. @returns {KirbyPresentation} this. */
    setup(character) {
        if(this.ready||this.disposed)throw new Error("Presentation setup is one-shot.");
        this.ready=true;this.groundHeight=measureGround(character);
        this.restBodyHeight=character.parts.body.worldMatrix[13]-this.groundHeight;
        this.root.transform.setPosition(0,this.groundHeight,0);
        if(!this.config.enabled)return this;
        try {
            this.geometries=createStageGeometry(this.config.stage);
            for(let i=0;i<2;i++) {
                const mesh=new Mesh(this.gl,this.geometries[i],i===0?this.config.stage.top:this.config.stage.side,{name:i===0?"stageTop":"stageSide"});
                this.meshes.push(mesh);mesh.setup(this.registry);this.root.addChild(new SceneNode({name:mesh.name,mesh}));
            }
            if(this.config.shadow.enabled) {
                const gl=this.gl;
                this.shader=createShaderInfo(gl,SHADOW_VERTEX_SOURCE,SHADOW_FRAGMENT_SOURCE,
                    ["uModelMatrix","uViewProjectionMatrix","uShadowColor"],["aPosition"]);
                for(const [target,data] of [[gl.ARRAY_BUFFER,new Float32Array([-1,0,-1,1,0,-1,1,0,1,-1,0,1])],
                    [gl.ELEMENT_ARRAY_BUFFER,new Uint16Array([0,2,1,0,3,2])]]) {
                    const buffer=gl.createBuffer();if(!buffer)throw new Error("Shadow buffer allocation failed");
                    this.shadowBuffers.push(buffer);gl.bindBuffer(target,buffer);gl.bufferData(target,data,gl.STATIC_DRAW);
                }
            }
            this.update(character);return this;
        } catch(error){this.dispose();throw error;}
    }
    /** Sample existing body height in ground space; no clock or inherited rig scale.
     * @param {object} character Current character. @returns {KirbyPresentation} this. */
    update(character) {
        if(this.disposed)throw new Error("Disposed presentation");
        // Strip only the host inspection transform by starting at the rig root.
        // The regular scene update below reinstates that transform before drawing.
        character.root.updateWorldMatrices();const m=character.parts.body.worldMatrix,s=this.config.shadow;
        this.bodyRise=Math.max(0,m[13]-this.groundHeight-this.restBodyHeight);
        const air=Math.min(1,this.bodyRise/s.heightRange),spread=1+s.airborneSpread*air;
        this.shadowPose.setPosition(m[12],this.groundHeight+s.offset,m[14]);
        this.shadowPose.setScale(s.radiusX*spread,1,s.radiusZ*spread);
        this.shadowPose.updateLocalMatrix();this.shadowColor[3]=s.opacity*(1-s.airborneFade*air);
        return this;
    }
    /** Draw the opaque platform, then the translucent shadow, before opaque Kirby.
     * Restores the host's documented opaque baseline even if drawing throws.
     * @param {object} shaderInfo Borrowed lit program. @param {Float32Array} orbit Host orbit matrix.
     * @param {Float32Array} viewProjection Current camera. @returns {void} */
    draw(shaderInfo,orbit,viewProjection) {
        if(!this.config.enabled||this.disposed)return;
        this.root.updateAndDraw(shaderInfo,orbit);
        if(!this.shader)return;
        const gl=this.gl,s=this.shader;
        multiplyMatrices(this.shadowMatrix,orbit,this.shadowPose.localMatrix.elements);
        try {
            gl.useProgram(s.program);gl.uniformMatrix4fv(s.uniforms.uViewProjectionMatrix,false,viewProjection);
            gl.uniformMatrix4fv(s.uniforms.uModelMatrix,false,this.shadowMatrix);gl.uniform4fv(s.uniforms.uShadowColor,this.shadowColor);
            gl.bindBuffer(gl.ARRAY_BUFFER,this.shadowBuffers[0]);gl.vertexAttribPointer(s.attribs.aPosition,3,gl.FLOAT,false,0,0);gl.enableVertexAttribArray(s.attribs.aPosition);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.shadowBuffers[1]);
            gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LESS);gl.depthMask(false);gl.disable(gl.CULL_FACE);
            // Also bias depth by one raster unit: the tiny physical offset alone
            // is insufficient on implementations offering only 16-bit depth.
            gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(-1,-1);
            gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
            gl.drawElements(gl.TRIANGLES,6,gl.UNSIGNED_SHORT,0);
        } finally {
            gl.depthMask(true);gl.disable(gl.BLEND);gl.disable(gl.POLYGON_OFFSET_FILL);
            gl.enable(gl.CULL_FACE);gl.frontFace(gl.CCW);gl.cullFace(gl.BACK);
            gl.useProgram(shaderInfo.program);
        }
    }
    /** Release only presentation handles, exactly once. @returns {KirbyPresentation} this. */
    dispose() {
        if(this.disposed)return this;const gl=this.gl;
        for(const bundle of this.registry.values())for(const key of ["positionBuffer","normalBuffer","indexBuffer"])gl.deleteBuffer(bundle[key]);
        this.registry.clear();for(const mesh of this.meshes)mesh.dispose();
        for(const buffer of this.shadowBuffers)gl.deleteBuffer(buffer);this.shadowBuffers.length=0;
        if(this.shader){gl.deleteProgram(this.shader.program);for(const shader of this.shader.shaders)gl.deleteShader(shader);this.shader=null;}
        this.disposed=true;return this;
    }
}

const VERTEX_SOURCE=`
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uModelMatrix;
uniform mat4 uViewProjectionMatrix;
uniform mat3 uNormalMatrix;
varying vec3 vNormal;
void main() {
    vec4 worldPosition=uModelMatrix*vec4(aPosition,1.0);
    vNormal=uNormalMatrix*aNormal;
    gl_Position=uViewProjectionMatrix*worldPosition;
}`;
const FRAGMENT_SOURCE=`
precision mediump float;
uniform vec4 uBaseColor;
uniform vec3 uLightDirection;
uniform vec3 uFillDirection;
uniform vec3 uLighting;
varying vec3 vNormal;
void main() {
    vec3 surfaceNormal=normalize(vNormal);
    vec3 lightDirection=normalize(uLightDirection);
    float diffuse=max(dot(surfaceNormal,lightDirection),0.0);
    float fill=max(dot(surfaceNormal,normalize(uFillDirection)),0.0);
    gl_FragColor=vec4(uBaseColor.rgb*(uLighting.x+uLighting.y*diffuse+uLighting.z*fill),uBaseColor.a);
}`;

/** Compile/link host programs in WebGL 1 syntax; host owns all handles. */
function createShaderInfo(gl,vertexSource=VERTEX_SOURCE,fragmentSource=FRAGMENT_SOURCE,
    uniformNames=["uModelMatrix","uViewProjectionMatrix","uNormalMatrix","uBaseColor","uLightDirection","uFillDirection","uLighting"],
    attributeNames=["aPosition","aNormal"]) {
    const shaders=[];
    let program=null;
    try {
        for(const [type,source] of [[gl.VERTEX_SHADER,vertexSource],[gl.FRAGMENT_SHADER,fragmentSource]]) {
            const shader=gl.createShader(type);
            if(!shader)throw new Error("Shader allocation failed");
            shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
            if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)||"Shader compilation failed");
        }
        program=gl.createProgram();if(!program)throw new Error("Program allocation failed");
        for(const shader of shaders)gl.attachShader(program,shader);
        gl.linkProgram(program);
        if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||"Program link failed");
        return {program,shaders,
            attribs:Object.fromEntries(attributeNames.map(name=>[name,gl.getAttribLocation(program,name)])),
            uniforms:Object.fromEntries(uniformNames
                .map(name=>[name,gl.getUniformLocation(program,name)]))};
    } catch(error) {
        if(program)gl.deleteProgram(program);for(const shader of shaders)gl.deleteShader(shader);throw error;
    }
}

const RUBRIC_EXPLANATIONS=Object.freeze({
    friendlyIdle:"Ready idle with independent blinking and smile expressions.",
    walk:"Five complete walk cycles: local foot translation/rotation and a gentle body weight shift.",
    settle:"Walking settles smoothly into the authored Star Rod holding pose.",
    turn:"The complete character turns right, then left (28° each side), then front about a ground-level local Y pivot.",
    gesture:"The raised arm carries the hand and rod; the grip adds local arbitrary-axis rotation.",
    hop:"Two short hops: forward, then backward to the starting point. Readable squash/stretch holds, corrected sole contact and a rigid attached rod.",
    rest:"Resting holding pose; blinking and smile expressions continue. Hierarchy remains active in every phase."
});

/** Compact panel wording, not a new animation owner or per-frame announcement.
 * @param {string} mode Current existing inspection mode. @param {string} phase Existing showcase phase.
 * @returns {string} Accurate rubric explanation for the current mode/phase. */
function getRubricExplanation(mode,phase) {
    if(mode==="neutral")return "Static neutral pose: matched resting arms, open eyes and open smile; rod hidden and all clocks suspended.";
    if(mode==="holding")return "Static authored holding pose: open eyes and open smile; all clocks suspended.";
    if(mode==="walk")return "Continuous local foot translation/rotation and body weight shift; blink and smile continue, with turn/gesture/hop suspended.";
    return RUBRIC_EXPLANATIONS[phase]||RUBRIC_EXPLANATIONS.friendlyIdle;
}

/** Initialize the standalone host; this is deliberately not part of createKirby(). */
function initialize() {
    const canvas=document.getElementById("webgl-canvas");
    const status=document.getElementById("project-status"),version=document.getElementById("webgl-version");
    const explanation=document.getElementById("phase-explanation");
    const panel=document.getElementById("status-overlay"),hide=document.getElementById("hide-info"),show=document.getElementById("show-info");
    const reset=document.getElementById("reset-view"),toggle=document.getElementById("toggle-animation"),restart=document.getElementById("restart-animation");
    const select=document.getElementById("inspection-mode"),alert=document.getElementById("runtime-alert");
    const panelControls=new InfoPanelControls(panel,hide,show).attach();
    let gl=null,shaderInfo=null,character=null,presentation=null,controls=null,view=null,camera=null,inspectionRoot=null;
    let frame=0,lastTime=null,lastWidth=0,lastHeight=0,disposed=false;
    const lightDirection=new Float32Array(PRESENTATION.lighting.key);
    const fillDirection=new Float32Array(PRESENTATION.lighting.fill),lighting=new Float32Array(PRESENTATION.lighting.weights);
    const report=(message,isError=false)=>{
        status.textContent=message;alert.textContent=isError ? message : "";
        show.textContent=isError ? "Show Info — Error" : "Show Info";show.classList.toggle("has-error",isError);
    };
    const updateExplanation=()=>{
        const text=getRubricExplanation(character.mode,character.showcasePhase);
        if(explanation.textContent!==text)explanation.textContent=text;
    };
    const sync=()=>{
        const inspecting=character.mode==="neutral"||character.mode==="holding";
        toggle.disabled=restart.disabled=inspecting;
        toggle.textContent=inspecting ? "Animation Off (Inspection)" : character.playing ? "Pause Animation" : "Play Animation";
        toggle.setAttribute("aria-pressed",String(character.playing));select.value=character.mode;
        updateExplanation();
    };
    const onMode=()=>{
        const wasWalking=character.mode==="walk";
        character.setMode(select.value);lastTime=null;sync();
        report(character.mode==="animated" ? (wasWalking
            ? "Running: settling for 0.24 seconds, then starting the showcase."
            : "Running: showcase — "+character.showcaseLabel+".")
            : character.mode==="walk" ? "Running: Walk in Place, blinking and smile expressions; hop, rod gesture and body turn suspended."
            : character.mode==="neutral" ? "Neutral Inspection: matched resting arms, open eyes, rod hidden; clocks stopped."
            : "Holding-Pose Inspection: authored holding pose, open eyes; clocks stopped.");
    };
    const onToggle=()=>{character.setPlaying(!character.playing);lastTime=null;sync();report(character.playing
        ? (character.mode==="walk" ? "Running: walking, blinking and smile expressions resumed; showcase suspended." : "Running: showcase — "+character.showcaseLabel+".")
        : "Paused: all motion and countdowns frozen.");};
    const onRestart=()=>{character.restart();lastTime=null;sync();report(character.mode==="walk"
        ? "Running: walking and blinking restarted from the first step; smile expressions reset open."
        : "Running: showcase restarted — Friendly idle.");};
    const onVisibility=()=>{lastTime=null;};
    const shutdown=()=>{
        if(disposed)return;disposed=true;
        if(frame)window.cancelAnimationFrame(frame);
        controls?.dispose();
        // Keep the panel usable after a rendering/context error, including
        // when it was hidden. Only final page shutdown removes its listeners.
        select.disabled=toggle.disabled=restart.disabled=reset.disabled=true;
        select.removeEventListener("change",onMode);toggle.removeEventListener("click",onToggle);restart.removeEventListener("click",onRestart);
        document.removeEventListener("visibilitychange",onVisibility);canvas.removeEventListener("webglcontextlost",onLost);
        presentation?.dispose();character?.dispose();
        if(shaderInfo){gl.deleteProgram(shaderInfo.program);for(const shader of shaderInfo.shaders)gl.deleteShader(shader);}
    };
    const onUnload=()=>{shutdown();panelControls.dispose();window.removeEventListener("beforeunload",onUnload);};
    const onLost=event=>{event.preventDefault();report("WebGL context lost. Reload to restore the preview.",true);shutdown();};
    const resize=()=>{
        const ratio=Math.min(window.devicePixelRatio||1,2);
        const width=Math.max(1,Math.floor(canvas.clientWidth*ratio)),height=Math.max(1,Math.floor(canvas.clientHeight*ratio));
        if(width===lastWidth&&height===lastHeight)return;
        canvas.width=lastWidth=width;canvas.height=lastHeight=height;
        gl.viewport(0,0,width,height);view.resize(width/height);
    };
    const render=timestamp=>{
        if(disposed)return;
        try {
            if(lastTime!==null){
                const elapsed=Math.max(0,Math.min((timestamp-lastTime)/1000,.1));
                const previousPhase=character.showcasePhase;
                character.update(elapsed);view.update(elapsed);
                if(character.mode==="animated"&&previousPhase!==character.showcasePhase) {
                    report("Running: showcase — "+character.showcaseLabel+".");
                    updateExplanation();
                }
            }
            lastTime=timestamp;resize();camera.updateCameraMatrices();
            gl.clearColor(.075,.07,.12,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
            gl.useProgram(shaderInfo.program);
            gl.uniformMatrix4fv(shaderInfo.uniforms.uViewProjectionMatrix,false,camera.viewProjectionMatrix.elements);
            gl.uniform3fv(shaderInfo.uniforms.uLightDirection,lightDirection);
            gl.uniform3fv(shaderInfo.uniforms.uFillDirection,fillDirection);
            gl.uniform3fv(shaderInfo.uniforms.uLighting,lighting);
            presentation.update(character);
            inspectionRoot.updateWorldMatrices();
            presentation.draw(shaderInfo,inspectionRoot.worldMatrix,camera.viewProjectionMatrix.elements);
            inspectionRoot.draw(shaderInfo);
            frame=window.requestAnimationFrame(render);
        } catch(error){console.error(error);report("Stopped: "+error.message,true);shutdown();}
    };
    try {
        const options={antialias:true,alpha:false,depth:true,stencil:false,premultipliedAlpha:false};
        gl=canvas.getContext("webgl",options)||canvas.getContext("experimental-webgl",options);
        if(!gl)throw new Error("WebGL 1 is unavailable");
        version.textContent="WebGL 1";
        shaderInfo=createShaderInfo(gl);character=createKirby(gl);
        presentation=new KirbyPresentation(gl);presentation.setup(character);
        inspectionRoot=new SceneNode("inspectionRoot");inspectionRoot.useLocalPose=true;inspectionRoot.addChild(character.root);
        camera=new ViewCamera();view=new KirbyInspectionCamera(camera);
        controls=new InspectionControls(canvas,inspectionRoot,window,reset,view).attach();
        select.addEventListener("change",onMode);toggle.addEventListener("click",onToggle);restart.addEventListener("click",onRestart);
        document.addEventListener("visibilitychange",onVisibility);canvas.addEventListener("webglcontextlost",onLost);
        window.addEventListener("beforeunload",onUnload);
        resize();sync();report("Running: showcase — Friendly idle.");
        frame=window.requestAnimationFrame(render);
    } catch(error){console.error(error);report("Initialization failed: "+error.message,true);shutdown();}
}

// Exports make the host controls testable without creating a page or context.
export {ViewCamera,KirbyInspectionCamera,InspectionControls,InfoPanelControls,
    KirbyPresentation,PRESENTATION,measureGround,createStageGeometry,createShaderInfo,getRubricExplanation};
if (typeof document!=="undefined"&&document.getElementById("webgl-canvas")) initialize();
