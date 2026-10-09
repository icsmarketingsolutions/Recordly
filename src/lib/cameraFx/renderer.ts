import { EYE_POLYGON_SIZE, type EyeWarp } from "./gaze";
import type { CameraFxSettings } from "./settings";

/**
 * WebGL2 compositor for the camera effects. Everything runs in "GL space"
 * (origin bottom-left): frames are uploaded with FLIP_Y and image-space points
 * (y down) are converted once when they become uniforms.
 *
 * Passes: frame → masked quarter-res background (premultiplied by "not person")
 * → separable gaussian ×2 → final composite (eye warp, eye whites, background
 * blur/veil/darkening, vignette) straight to the canvas.
 */
export interface CameraFxRenderInput {
	fx: CameraFxSettings;
	/** Person coverage, 0..255, row-major with the top row first. */
	mask: { data: Uint8Array; width: number; height: number } | null;
	/** Eye warps in image pixels (y down). */
	eyes: EyeWarp[];
}

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
	vUv = aPosition * 0.5 + 0.5;
	gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const PREP_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uFrame;
uniform sampler2D uMask;
uniform vec2 uTexel;
out vec4 outColor;
void main() {
	vec3 color = 0.25 * (
		texture(uFrame, vUv + uTexel * vec2(-0.5, -0.5)).rgb +
		texture(uFrame, vUv + uTexel * vec2(0.5, -0.5)).rgb +
		texture(uFrame, vUv + uTexel * vec2(-0.5, 0.5)).rgb +
		texture(uFrame, vUv + uTexel * vec2(0.5, 0.5)).rgb);
	// Anything that might be the person is excluded so it cannot bleed into the blur.
	float background = 1.0 - smoothstep(0.08, 0.4, texture(uMask, vUv).r);
	outColor = vec4(color * background, background);
}`;

const BLUR_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uStep;
out vec4 outColor;
const float WEIGHTS[5] = float[5](0.2270270, 0.1945946, 0.1216216, 0.0540540, 0.0162162);
void main() {
	vec4 sum = texture(uSource, vUv) * WEIGHTS[0];
	for (int i = 1; i < 5; i++) {
		vec2 offset = uStep * float(i);
		sum += texture(uSource, vUv + offset) * WEIGHTS[i];
		sum += texture(uSource, vUv - offset) * WEIGHTS[i];
	}
	outColor = sum;
}`;

const COMPOSITE_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uFrame;
uniform sampler2D uMask;
uniform sampler2D uBlur;
uniform vec2 uResolution;
uniform bool uHasMask;
uniform float uBlurAmount;
uniform float uVeil;
uniform vec3 uVeilColor;
uniform float uAmbient;
uniform float uRedness;
uniform int uEyeCount;
uniform vec2 uPolygon[${EYE_POLYGON_SIZE * 2}];
uniform vec2 uIris[2];
uniform float uIrisRadius[2];
uniform float uReach[2];
uniform vec2 uShift[2];
out vec4 outColor;

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

// Signed distance to a closed polygon (Inigo Quilez); negative inside.
float sdPolygon(vec2 p, int base) {
	vec2 first = uPolygon[base];
	float d = dot(p - first, p - first);
	float s = 1.0;
	for (int i = 0, j = ${EYE_POLYGON_SIZE - 1}; i < ${EYE_POLYGON_SIZE}; j = i, i++) {
		vec2 vi = uPolygon[base + i];
		vec2 vj = uPolygon[base + j];
		vec2 e = vj - vi;
		vec2 w = p - vi;
		vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
		d = min(d, dot(b, b));
		bvec3 c = bvec3(p.y >= vi.y, p.y < vj.y, e.x * w.y > e.y * w.x);
		if (all(c) || all(not(c))) s *= -1.0;
	}
	return s * sqrt(d);
}

void main() {
	vec2 p = vUv * uResolution;
	vec2 samplePx = p;
	float sclera = 0.0;
	float pupil = 0.0;

	for (int eye = 0; eye < 2; eye++) {
		if (eye >= uEyeCount) break;
		vec2 iris = uIris[eye];
		if (distance(p, iris) > uReach[eye]) continue;
		float r = uIrisRadius[eye];
		vec2 shift = uShift[eye];
		float feather = max(0.75, r * 0.12);
		float inside = 1.0 - smoothstep(-feather, feather * 0.5, sdPolygon(p, eye * ${EYE_POLYGON_SIZE}));
		if (inside <= 0.0) continue;

		// Move the iris content by "shift" with a smooth falloff across the white
		// of the eye; lids and lashes outside the opening never move.
		float falloff = 1.0 - smoothstep(r, r * 2.4, distance(p, iris + shift * 0.5));
		vec2 moved = p - shift * (inside * falloff);
		float stillInside = 1.0 - smoothstep(-feather, feather * 0.5, sdPolygon(moved, eye * ${EYE_POLYGON_SIZE}));
		samplePx = mix(p, moved, stillInside);

		float toIris = distance(p, iris + shift);
		sclera = max(sclera, inside * smoothstep(r * 1.02, r * 1.3, toIris));
		pupil = max(pupil, inside * (1.0 - smoothstep(r * 0.35, r * 0.55, toIris)));
	}

	vec3 color = texture(uFrame, samplePx / uResolution).rgb;

	if (uRedness > 0.0) {
		float red = max(0.0, color.r - max(color.g, color.b));
		float whites = sclera * uRedness;
		color.r -= red * whites * 0.9;
		float luma = dot(color, LUMA);
		color = mix(color, vec3(luma), whites * 0.25);
		color += whites * 0.025 * smoothstep(0.35, 0.75, luma);
		color.r = mix(color.r, max(color.g, color.b), pupil * uRedness * smoothstep(0.08, 0.2, red));
	}

	vec3 result = color;
	if (uHasMask) {
		float person = smoothstep(0.3, 0.7, texture(uMask, vUv).r);
		vec3 background = color;
		if (uBlurAmount > 0.0) {
			vec4 blurred = texture(uBlur, vUv);
			vec3 blurredColor = blurred.a > 0.02 ? blurred.rgb / blurred.a : color;
			background = mix(color, blurredColor, smoothstep(0.0, 0.2, uBlurAmount));
		}
		background = mix(background, uVeilColor, uVeil * 0.75);
		float backgroundLuma = dot(background, LUMA);
		background = mix(background, vec3(backgroundLuma), uAmbient * 0.25) * (1.0 - uAmbient * 0.55);
		result = mix(background, color, person);
	}

	vec2 q = vUv - 0.5;
	q.x *= uResolution.x / uResolution.y;
	result *= 1.0 - uAmbient * 0.3 * smoothstep(0.35, 0.95, length(q));

	outColor = vec4(clamp(result, 0.0, 1.0), 1.0);
}`;

interface Target {
	texture: WebGLTexture;
	framebuffer: WebGLFramebuffer;
	width: number;
	height: number;
}

const VEIL_DARK: [number, number, number] = [0.05, 0.06, 0.08];
const VEIL_LIGHT: [number, number, number] = [0.92, 0.93, 0.95];

export class CameraFxRenderer {
	readonly canvas: HTMLCanvasElement;
	private readonly gl: WebGL2RenderingContext;
	private readonly prepProgram: WebGLProgram;
	private readonly blurProgram: WebGLProgram;
	private readonly compositeProgram: WebGLProgram;
	private readonly frameTexture: WebGLTexture;
	private readonly maskTexture: WebGLTexture;
	private blurTargets: [Target, Target] | null = null;
	private readonly uniformCache = new Map<
		WebGLProgram,
		Map<string, WebGLUniformLocation | null>
	>();

	constructor(width: number, height: number) {
		this.canvas = document.createElement("canvas");
		this.canvas.width = width;
		this.canvas.height = height;
		const gl = this.canvas.getContext("webgl2", {
			alpha: false,
			antialias: false,
			premultipliedAlpha: false,
			preserveDrawingBuffer: true,
		});
		if (!gl) throw new Error("WebGL2 is not available for camera effects");
		this.gl = gl;

		this.prepProgram = this.createProgram(PREP_SHADER);
		this.blurProgram = this.createProgram(BLUR_SHADER);
		this.compositeProgram = this.createProgram(COMPOSITE_SHADER);

		const buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

		this.frameTexture = this.createTexture();
		this.maskTexture = this.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.R8,
			1,
			1,
			0,
			gl.RED,
			gl.UNSIGNED_BYTE,
			new Uint8Array([255]),
		);
	}

	get width() {
		return this.canvas.width;
	}

	get height() {
		return this.canvas.height;
	}

	render(frame: TexImageSource, input: CameraFxRenderInput) {
		const { gl } = this;
		const { fx } = input;

		gl.bindTexture(gl.TEXTURE_2D, this.frameTexture);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

		const hasMask = input.mask !== null;
		if (input.mask) {
			const { data, width, height } = input.mask;
			// Rows arrive top-first; GL wants bottom-first.
			const flipped = new Uint8Array(data.length);
			for (let row = 0; row < height; row += 1) {
				flipped.set(
					data.subarray(row * width, (row + 1) * width),
					(height - 1 - row) * width,
				);
			}
			gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
			gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.R8,
				width,
				height,
				0,
				gl.RED,
				gl.UNSIGNED_BYTE,
				flipped,
			);
			gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
		}

		const blurAmount = hasMask ? fx.backgroundBlur : 0;
		const blurTexture = blurAmount > 0 ? this.renderBackgroundBlur(blurAmount) : null;

		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, this.width, this.height);
		gl.useProgram(this.compositeProgram);
		this.bindTexture(this.compositeProgram, "uFrame", this.frameTexture, 0);
		this.bindTexture(this.compositeProgram, "uMask", this.maskTexture, 1);
		this.bindTexture(this.compositeProgram, "uBlur", blurTexture ?? this.frameTexture, 2);
		const u = (name: string) => this.uniform(this.compositeProgram, name);
		gl.uniform2f(u("uResolution"), this.width, this.height);
		gl.uniform1i(u("uHasMask"), hasMask ? 1 : 0);
		gl.uniform1f(u("uBlurAmount"), blurAmount);
		gl.uniform1f(u("uVeil"), hasMask ? fx.backgroundVeil : 0);
		gl.uniform3fv(u("uVeilColor"), fx.backgroundVeilTone === "light" ? VEIL_LIGHT : VEIL_DARK);
		gl.uniform1f(u("uAmbient"), fx.ambientDarken);
		gl.uniform1f(u("uRedness"), input.eyes.length > 0 ? fx.eyeRedness : 0);
		this.setEyeUniforms(input.eyes);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}

	dispose() {
		const { gl } = this;
		for (const target of this.blurTargets ?? []) {
			gl.deleteTexture(target.texture);
			gl.deleteFramebuffer(target.framebuffer);
		}
		gl.deleteTexture(this.frameTexture);
		gl.deleteTexture(this.maskTexture);
		gl.deleteProgram(this.prepProgram);
		gl.deleteProgram(this.blurProgram);
		gl.deleteProgram(this.compositeProgram);
		gl.getExtension("WEBGL_lose_context")?.loseContext();
	}

	private setEyeUniforms(eyes: EyeWarp[]) {
		const { gl } = this;
		const u = (name: string) => this.uniform(this.compositeProgram, name);
		const count = Math.min(2, eyes.length);
		const polygon = new Float32Array(EYE_POLYGON_SIZE * 2 * 2);
		const iris = new Float32Array(4);
		const shift = new Float32Array(4);
		const radius = new Float32Array(2);
		const reach = new Float32Array(2);
		const toGlY = (y: number) => this.height - y;

		for (let eye = 0; eye < count; eye += 1) {
			const warp = eyes[eye];
			let farthest = 0;
			warp.polygon.slice(0, EYE_POLYGON_SIZE).forEach((point, index) => {
				const offset = (eye * EYE_POLYGON_SIZE + index) * 2;
				polygon[offset] = point.x;
				polygon[offset + 1] = toGlY(point.y);
				farthest = Math.max(
					farthest,
					Math.hypot(point.x - warp.iris.x, point.y - warp.iris.y),
				);
			});
			iris[eye * 2] = warp.iris.x;
			iris[eye * 2 + 1] = toGlY(warp.iris.y);
			shift[eye * 2] = warp.shift.x;
			shift[eye * 2 + 1] = -warp.shift.y;
			radius[eye] = warp.irisRadius;
			reach[eye] = farthest + 4;
		}

		gl.uniform1i(u("uEyeCount"), count);
		gl.uniform2fv(u("uPolygon"), polygon);
		gl.uniform2fv(u("uIris"), iris);
		gl.uniform2fv(u("uShift"), shift);
		gl.uniform1fv(u("uIrisRadius"), radius);
		gl.uniform1fv(u("uReach"), reach);
	}

	private renderBackgroundBlur(amount: number): WebGLTexture {
		const { gl } = this;
		const [a, b] = this.ensureBlurTargets();

		gl.bindFramebuffer(gl.FRAMEBUFFER, a.framebuffer);
		gl.viewport(0, 0, a.width, a.height);
		gl.useProgram(this.prepProgram);
		this.bindTexture(this.prepProgram, "uFrame", this.frameTexture, 0);
		this.bindTexture(this.prepProgram, "uMask", this.maskTexture, 1);
		gl.uniform2f(this.uniform(this.prepProgram, "uTexel"), 1 / this.width, 1 / this.height);
		gl.drawArrays(gl.TRIANGLES, 0, 3);

		gl.useProgram(this.blurProgram);
		// Several narrow passes instead of one wide one: wide tap spacing on the
		// quarter-res buffer shows up as a grid once it is upscaled.
		const spread = 0.7 + amount * 1.5;
		for (let iteration = 0; iteration < 3; iteration += 1) {
			for (const [source, destination, horizontal] of [
				[a, b, true],
				[b, a, false],
			] as const) {
				gl.bindFramebuffer(gl.FRAMEBUFFER, destination.framebuffer);
				this.bindTexture(this.blurProgram, "uSource", source.texture, 0);
				gl.uniform2f(
					this.uniform(this.blurProgram, "uStep"),
					horizontal ? spread / a.width : 0,
					horizontal ? 0 : spread / a.height,
				);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
			}
		}
		return a.texture;
	}

	private ensureBlurTargets(): [Target, Target] {
		const width = Math.max(1, Math.ceil(this.width / 4));
		const height = Math.max(1, Math.ceil(this.height / 4));
		if (
			this.blurTargets &&
			this.blurTargets[0].width === width &&
			this.blurTargets[0].height === height
		) {
			return this.blurTargets;
		}
		const create = (): Target => {
			const { gl } = this;
			const texture = this.createTexture();
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.RGBA,
				width,
				height,
				0,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				null,
			);
			const framebuffer = gl.createFramebuffer();
			if (!framebuffer) throw new Error("Unable to create camera effects framebuffer");
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
			gl.framebufferTexture2D(
				gl.FRAMEBUFFER,
				gl.COLOR_ATTACHMENT0,
				gl.TEXTURE_2D,
				texture,
				0,
			);
			return { texture, framebuffer, width, height };
		};
		this.blurTargets = [create(), create()];
		return this.blurTargets;
	}

	private bindTexture(program: WebGLProgram, name: string, texture: WebGLTexture, unit: number) {
		const { gl } = this;
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.uniform1i(this.uniform(program, name), unit);
	}

	private uniform(program: WebGLProgram, name: string) {
		let cache = this.uniformCache.get(program);
		if (!cache) {
			cache = new Map();
			this.uniformCache.set(program, cache);
		}
		if (!cache.has(name)) cache.set(name, this.gl.getUniformLocation(program, name));
		return cache.get(name) ?? null;
	}

	private createTexture(): WebGLTexture {
		const { gl } = this;
		const texture = gl.createTexture();
		if (!texture) throw new Error("Unable to create camera effects texture");
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		return texture;
	}

	private createProgram(fragmentSource: string): WebGLProgram {
		const { gl } = this;
		const compile = (type: number, source: string) => {
			const shader = gl.createShader(type);
			if (!shader) throw new Error("Unable to create shader");
			gl.shaderSource(shader, source);
			gl.compileShader(shader);
			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
				throw new Error(`Camera effects shader failed: ${gl.getShaderInfoLog(shader)}`);
			}
			return shader;
		};
		const program = gl.createProgram();
		if (!program) throw new Error("Unable to create shader program");
		gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
		gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
		gl.bindAttribLocation(program, 0, "aPosition");
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(`Camera effects program failed: ${gl.getProgramInfoLog(program)}`);
		}
		return program;
	}
}
