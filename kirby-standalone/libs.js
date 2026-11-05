/**
 * Minimal course mathematics. Right-handed, +Y up, radians throughout.
 * Matrices use column-major Float32 storage, column vectors, T * R * S local
 * composition and parentWorld * local hierarchy, matching the reference ZIP.
 * These are deliberately small value helpers, not a bundled reusable engine.
 */

/** Mutable three-component value used by authored poses. */
export class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    /** Set components; @returns {Vector3} this. */
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    /** Copy a value; @returns {Vector3} this. */
    copy(v) { return this.set(v.x, v.y, v.z); }
    /** Normalize without changing a zero vector; @returns {Vector3} this. */
    normalize() {
        const length = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
        return length ? this.set(this.x / length, this.y / length, this.z / length) : this;
    }
    /** @returns {number[]} Independent component array. */
    toArray() { return [this.x, this.y, this.z]; }
}

/** Mutable quaternion; only operations used by the course rig are included. */
export class Quaternion {
    constructor(x = 0, y = 0, z = 0, w = 1) { this.set(x, y, z, w); }
    /** Set components; @returns {Quaternion} this. */
    set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
    /** Copy components; @returns {Quaternion} this. */
    copy(q) { return this.set(q.x, q.y, q.z, q.w); }
    /** @returns {number[]} Independent component array. */
    toArray() { return [this.x, this.y, this.z, this.w]; }
    /** Normalize; a zero value becomes identity; @returns {Quaternion} this. */
    normalize() {
        const length = Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2 + this.w ** 2);
        return length ? this.set(this.x / length, this.y / length, this.z / length, this.w / length)
            : this.set(0, 0, 0, 1);
    }
    /** Postmultiply by q, preserving authored * delta order; @returns {Quaternion} this. */
    multiply(q) {
        const {x, y, z, w} = this;
        return this.set(w*q.x + x*q.w + y*q.z - z*q.y,
            w*q.y - x*q.z + y*q.w + z*q.x,
            w*q.z + x*q.y - y*q.x + z*q.w,
            w*q.w - x*q.x - y*q.y - z*q.z);
    }
    /** Axis-angle in radians; @returns {Quaternion} this. */
    setFromAxisAngle(axis, angle) {
        const length = Math.sqrt(axis.x ** 2 + axis.y ** 2 + axis.z ** 2);
        if (!length) return this.set(0, 0, 0, 1);
        const scale = Math.sin(angle / 2) / length;
        return this.set(axis.x * scale, axis.y * scale, axis.z * scale, Math.cos(angle / 2));
    }
    /** Intrinsic XYZ or YXZ Euler angles in radians; @returns {Quaternion} this. */
    setFromEuler(x, y, z, order = "XYZ") {
        const c1=Math.cos(x/2), c2=Math.cos(y/2), c3=Math.cos(z/2);
        const s1=Math.sin(x/2), s2=Math.sin(y/2), s3=Math.sin(z/2);
        if (order !== "XYZ" && order !== "YXZ") throw new RangeError("Unsupported course Euler order");
        return this.set(s1*c2*c3+c1*s2*s3, c1*s2*c3-s1*c2*s3,
            order === "XYZ" ? c1*c2*s3+s1*s2*c3 : c1*c2*s3-s1*s2*c3,
            order === "XYZ" ? c1*c2*c3-s1*s2*s3 : c1*c2*c3+s1*s2*s3).normalize();
    }
    /** Shortest-path spherical interpolation; @returns {Quaternion} this. */
    slerp(q, t) {
        if (t === 0) return this;
        const length = Math.sqrt(this.x**2+this.y**2+this.z**2+this.w**2);
        const targetLength = Math.sqrt(q.x**2+q.y**2+q.z**2+q.w**2);
        if (!length || !targetLength) return this;
        const x=this.x/length, y=this.y/length, z=this.z/length, w=this.w/length;
        let tx=q.x/targetLength, ty=q.y/targetLength, tz=q.z/targetLength, tw=q.w/targetLength;
        let cosine=x*tx+y*ty+z*tz+w*tw;
        if (cosine < 0) { tx=-tx; ty=-ty; tz=-tz; tw=-tw; cosine=-cosine; }
        if (cosine >= 1) return this.set(x,y,z,w);
        const sineSquared=1-cosine*cosine;
        if (sineSquared <= Number.EPSILON) return this.set(x+t*(tx-x),y+t*(ty-y),z+t*(tz-z),w+t*(tw-w)).normalize();
        const sine=Math.sqrt(sineSquared), angle=Math.atan2(sine,cosine);
        const a=Math.sin((1-t)*angle)/sine, b=Math.sin(t*angle)/sine;
        return this.set(x*a+tx*b,y*a+ty*b,z*a+tz*b,w*a+tw*b).normalize();
    }
}

/** @returns {Float32Array} Identity column-major matrix. */
export function identityMatrix() {
    const out = new Float32Array(16);
    out[0]=out[5]=out[10]=out[15]=1;
    return out;
}

/** out = a * b, safe when out aliases either input; @returns {Float32Array} out. */
export function multiplyMatrices(out, a, b) {
    const a00=a[0],a01=a[1],a02=a[2],a03=a[3],a10=a[4],a11=a[5],a12=a[6],a13=a[7];
    const a20=a[8],a21=a[9],a22=a[10],a23=a[11],a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    for (let column=0; column<4; column++) {
        const i=column*4, x=b[i],y=b[i+1],z=b[i+2],w=b[i+3];
        out[i]=x*a00+y*a10+z*a20+w*a30;
        out[i+1]=x*a01+y*a11+z*a21+w*a31;
        out[i+2]=x*a02+y*a12+z*a22+w*a32;
        out[i+3]=x*a03+y*a13+z*a23+w*a33;
    }
    return out;
}

/** Compose a normalized T * R * S matrix; @returns {Float32Array} out. */
export function composeTRS(out, position, rotation, scale) {
    const length=Math.hypot(rotation.x,rotation.y,rotation.z,rotation.w);
    if (!Number.isFinite(length) || length===0) throw new RangeError("Invalid pose rotation");
    const x=rotation.x/length,y=rotation.y/length,z=rotation.z/length,w=rotation.w/length;
    const x2=x+x,y2=y+y,z2=z+z,xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2;
    const wx=w*x2,wy=w*y2,wz=w*z2;
    out[0]=(1-(yy+zz))*scale.x; out[1]=(xy+wz)*scale.x; out[2]=(xz-wy)*scale.x; out[3]=0;
    out[4]=(xy-wz)*scale.y; out[5]=(1-(xx+zz))*scale.y; out[6]=(yz+wx)*scale.y; out[7]=0;
    out[8]=(xz+wy)*scale.z; out[9]=(yz-wx)*scale.z; out[10]=(1-(xx+yy))*scale.z; out[11]=0;
    out[12]=position.x; out[13]=position.y; out[14]=position.z; out[15]=1;
    return out;
}

/** Correct inverse-transpose of the model's upper 3x3, NOT the ZIP's inverse-only helper. */
export function normalMatrix(out, m) {
    const a=m[0],b=m[4],c=m[8],d=m[1],e=m[5],f=m[9],g=m[2],h=m[6],i=m[10];
    const determinant=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
    if (!Number.isFinite(determinant) || determinant===0) throw new RangeError("Singular model matrix");
    const inverse=1/determinant;
    out[0]=(e*i-f*h)*inverse; out[1]=(c*h-b*i)*inverse; out[2]=(b*f-c*e)*inverse;
    out[3]=(f*g-d*i)*inverse; out[4]=(a*i-c*g)*inverse; out[5]=(c*d-a*f)*inverse;
    out[6]=(d*h-e*g)*inverse; out[7]=(b*g-a*h)*inverse; out[8]=(a*e-b*d)*inverse;
    return out;
}

/** Perspective projection in radians; @returns {Float32Array} out. */
export function perspective(out, fov, aspect, near=0.1, far=100) {
    out.fill(0);
    const f=1/Math.tan(fov/2);
    out[0]=f/aspect; out[5]=f; out[10]=(far+near)/(near-far); out[11]=-1;
    out[14]=2*far*near/(near-far);
    return out;
}

/** Rigid camera inverse, using its orthonormal rotation; @returns {Float32Array} out. */
export function cameraInverse(out, world) {
    out[0]=world[0]; out[1]=world[4]; out[2]=world[8]; out[3]=0;
    out[4]=world[1]; out[5]=world[5]; out[6]=world[9]; out[7]=0;
    out[8]=world[2]; out[9]=world[6]; out[10]=world[10]; out[11]=0;
    out[12]=-(world[0]*world[12]+world[1]*world[13]+world[2]*world[14]);
    out[13]=-(world[4]*world[12]+world[5]*world[13]+world[6]*world[14]);
    out[14]=-(world[8]*world[12]+world[9]*world[13]+world[10]*world[14]); out[15]=1;
    return out;
}

/** Cubic Bézier coordinate B(t); @returns {number} evaluated coordinate. */
export function evaluateCubicBezierComponent(p0,p1,p2,p3,t) {
    const inverse=1-t;
    return inverse**3*p0+3*inverse**2*t*p1+3*inverse*t**2*p2+t**3*p3;
}

/** Minimal TRS-to-matrix adapter: animation offsets stay in parent coordinates. */
export class LocalPose {
    constructor() {
        this.position=new Vector3(); this.rotation=new Quaternion(); this.scale=new Vector3(1,1,1);
        this.localMatrix={elements:identityMatrix()}; this.worldMatrix={elements:identityMatrix()};
    }
    /** Set local position; @returns {LocalPose} this. */
    setPosition(x,y,z) { this.position.set(x,y,z); return this; }
    /** Set local scale; @returns {LocalPose} this. */
    setScale(x,y,z) { this.scale.set(x,y,z); return this; }
    /** Set local quaternion; @returns {LocalPose} this. */
    setRotation(x,y,z,w) { this.rotation.set(x,y,z,w); return this; }
    /** Copy local quaternion; @returns {LocalPose} this. */
    setRotationFromQuaternion(q) { return this.setRotation(q.x,q.y,q.z,q.w); }
    /** Set Euler rotation; @returns {LocalPose} this. */
    setRotationFromEuler(x,y,z,order="XYZ") { this.rotation.setFromEuler(x,y,z,order); return this; }
    /** Rebuild into the preallocated matrix; @returns {LocalPose} this. */
    updateLocalMatrix() { composeTRS(this.localMatrix.elements,this.position,this.rotation,this.scale); return this; }
}
