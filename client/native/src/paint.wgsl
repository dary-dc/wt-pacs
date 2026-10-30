// The browser painter's contract (client/paint/README.md) in one pass: each of the four nearest samples
// through the window table, then bilinear in the shader, since integer textures are not filterable.

struct Place {
    // xy: a display corner in clip space; zw: the image's (u, v) there. Strip order TL, TR, BL, BR.
    corners: array<vec4<f32>, 4>,
    offset: u32,
    components: u32,
}

@group(0) @binding(0) var<uniform> place: Place;
// Samples in a row side by side: an RGB pixel is three texels.
@group(0) @binding(1) var samples: texture_2d<u32>;
@group(0) @binding(2) var table: texture_2d<u32>;

struct Varying {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn quad(@builtin(vertex_index) i: u32) -> Varying {
    let c = place.corners[i];
    return Varying(vec4<f32>(c.xy, 0.0, 1.0), c.zw);
}

fn sample(p: vec2<i32>, n: vec2<i32>, k: i32) -> u32 {
    let q = clamp(p, vec2<i32>(0), n - 1);
    return textureLoad(samples, vec2<i32>(q.x * i32(place.components) + k, q.y), 0).r;
}

// A signed sample arrives as its 16-bit two's complement, so the offset wraps it to its entry.
fn lookup(s: u32) -> f32 {
    let i = (s + place.offset) & 0xffffu;
    return f32(textureLoad(table, vec2<u32>(i & 255u, i >> 8u), 0).r);
}

@fragment
fn paint(v: Varying) -> @location(0) vec4<f32> {
    let n = vec2<i32>(textureDimensions(samples)) / vec2<i32>(i32(place.components), 1);
    let t = v.uv * vec2<f32>(n) - 0.5;
    let i = vec2<i32>(floor(t));
    let f = t - floor(t);
    var rgb: vec3<f32>;
    for (var k = 0; k < 3; k++) {
        let c = min(k, i32(place.components) - 1);
        let a = lookup(sample(i, n, c));
        let b = lookup(sample(i + vec2<i32>(1, 0), n, c));
        let d = lookup(sample(i + vec2<i32>(0, 1), n, c));
        let e = lookup(sample(i + vec2<i32>(1, 1), n, c));
        rgb[k] = floor(mix(mix(a, b, f.x), mix(d, e, f.x), f.y) + 0.5) / 255.0;
    }
    return vec4<f32>(rgb, 1.0);
}
