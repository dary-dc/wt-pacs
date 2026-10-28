//! The browser painter's contract (`client/paint/README.md`) on wgpu, offscreen: a frame in, RGBA rows out.
use anyhow::{bail, ensure, Context, Result};

/// Samples as the decoder hands them on: bytes up to 8 bits, else little-endian 16-bit words; RGB interleaved.
pub struct Frame<'a> {
    pub pixels: &'a [u8],
    pub width: u32,
    pub height: u32,
    pub bits: u32,
    pub components: u32,
    pub signed: bool,
}

#[derive(Clone, Copy, PartialEq)]
pub enum Photometric {
    Monochrome1,
    Monochrome2,
    Rgb,
}

#[derive(Clone, Copy)]
pub enum Function {
    Linear,
    LinearExact,
    Sigmoid,
}

/// Centre and width in modality units.
pub struct Voi {
    pub center: f64,
    pub width: f64,
    pub function: Function,
}

/// `voi` is required for grey and ignored for RGB.
pub struct Display {
    pub photometric: Photometric,
    pub invert: bool,
    pub slope: f64,
    pub intercept: f64,
    pub voi: Option<Voi>,
    pub view: View,
}

/// Zoom and pan in CSS px, turned clockwise by `rotate` degrees, then flipped.
pub struct View {
    pub fit: bool,
    pub zoom: f64,
    pub pan_x: f64,
    pub pan_y: f64,
    pub rotate: i32,
    pub flip_h: bool,
    pub flip_v: bool,
}

/// 256 entries up to 8 bits, else 65 536; a signed code s sits at s + entries / 2.
fn table_shape(frame: &Frame) -> (usize, i64) {
    let entries = if frame.bits > 8 { 65536 } else { 256 };
    (entries, if frame.signed { entries as i64 / 2 } else { 0 })
}

/// The DICOM grayscale pipeline by stored code, PS3.3 2026d C.11, in float64; half up to a byte.
pub fn window_table(frame: &Frame, display: &Display) -> Result<Vec<u8>> {
    ensure!(
        (display.photometric == Photometric::Rgb) == (frame.components == 3),
        "this photometric interpretation with {} component(s) is not painted",
        frame.components
    );
    let (entries, offset) = table_shape(frame);
    let flip = (display.photometric == Photometric::Monochrome1) != display.invert;
    if display.photometric == Photometric::Rgb {
        return Ok((0..entries).map(|i| if flip { 255 - i as u8 } else { i as u8 }).collect());
    }
    let voi = display.voi.as_ref().context("a grey frame needs a VOI window")?;
    let slope = if display.slope.is_finite() && display.slope != 0.0 { display.slope } else { 1.0 };
    let intercept = if display.intercept.is_finite() { display.intercept } else { 0.0 };
    let (c, w) = (voi.center, voi.width);
    let y: Box<dyn Fn(f64) -> f64> = match voi.function {
        Function::Linear => {
            ensure!(w >= 1.0, "LINEAR needs a window width ≥ 1, got {w}");
            let (lo, hi) = (c - 0.5 - (w - 1.0) / 2.0, c - 0.5 + (w - 1.0) / 2.0);
            Box::new(move |x| if x <= lo { 0.0 } else if x > hi { 255.0 } else { ((x - (c - 0.5)) / (w - 1.0) + 0.5) * 255.0 })
        }
        Function::LinearExact => {
            ensure!(w > 0.0, "LINEAR_EXACT needs a window width > 0, got {w}");
            Box::new(move |x| if x <= c - w / 2.0 { 0.0 } else if x > c + w / 2.0 { 255.0 } else { ((x - c) / w + 0.5) * 255.0 })
        }
        Function::Sigmoid => {
            ensure!(w > 0.0, "SIGMOID needs a window width > 0, got {w}");
            Box::new(move |x| 255.0 / (1.0 + (-4.0 * (x - c) / w).exp()))
        }
    };
    let table = (0..entries).map(|i| {
        let code = (y((i as i64 - offset) as f64 * slope + intercept) + 0.5).floor().clamp(0.0, 255.0) as u8;
        if flip { 255 - code } else { code }
    });
    Ok(table.collect())
}

/// Each display corner, TL TR BL BR: its clip-space position and the image's (u, v) there.
fn placement(frame: &Frame, v: &View, width: u32, height: u32, dpr: f64) -> Result<[[f32; 4]; 4]> {
    ensure!(v.rotate % 90 == 0, "rotation {} is not a quarter turn", v.rotate);
    let q = v.rotate.rem_euclid(360) / 90;
    let (w, h) = (frame.width as f64, frame.height as f64);
    let (dw, dh) = if q % 2 == 1 { (h, w) } else { (w, h) };
    let (width, height) = (width as f64, height as f64);
    let s = if v.fit { (width / dw).min(height / dh) } else { 1.0 } * v.zoom;
    let x0 = ((width - s * dw) / 2.0).floor() + v.pan_x * dpr;
    let y0 = ((height - s * dh) / 2.0).floor() + v.pan_y * dpr;
    Ok([(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)].map(|(cx, cy)| {
        let a = if v.flip_h { 1.0 - cx } else { cx };
        let b = if v.flip_v { 1.0 - cy } else { cy };
        let (u, t) = [(a, b), (b, 1.0 - a), (1.0 - a, 1.0 - b), (1.0 - b, a)][q as usize];
        let x = (x0 + cx * s * dw) / width * 2.0 - 1.0;
        let y = 1.0 - (y0 + cy * s * dh) / height * 2.0;
        [x as f32, y as f32, u as f32, t as f32]
    }))
}

pub struct Painter {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::RenderPipeline,
    /// The adapter's name and driver, printed beside every result.
    pub renderer: String,
}

impl Painter {
    /// The first adapter wgpu offers (`WGPU_BACKEND`, `VK_ICD_FILENAMES` choose it).
    pub fn new() -> Result<Self> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        let adapter = pollster::block_on(instance.request_adapter(&Default::default())).context("no wgpu adapter")?;
        let info = adapter.get_info();
        let limits = wgpu::DeviceDescriptor { required_limits: adapter.limits(), ..Default::default() };
        let (device, queue) = pollster::block_on(adapter.request_device(&limits))?;
        let module = device.create_shader_module(wgpu::include_wgsl!("paint.wgsl"));
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: None,
            layout: None,
            vertex: wgpu::VertexState { module: &module, entry_point: None, compilation_options: Default::default(), buffers: &[] },
            primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleStrip, ..Default::default() },
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: None,
                compilation_options: Default::default(),
                targets: &[Some(wgpu::TextureFormat::Rgba8Unorm.into())],
            }),
            multiview_mask: None,
            cache: None,
        });
        let renderer = format!("{} ({:?}, {} {})", info.name, info.backend, info.driver, info.driver_info);
        Ok(Self { device, queue, pipeline, renderer })
    }

    /// `width` × `height` device pixels, rows top-down; outside the image opaque black.
    pub fn paint(&self, frame: &Frame, display: &Display, width: u32, height: u32, dpr: f64) -> Result<Vec<u8>> {
        let wide = match (frame.bits, frame.signed, frame.components) {
            (1..=8, false, 1 | 3) => false,
            (9..=16, _, 1) => true,
            _ => bail!("{}-bit {} samples with {} component(s) are not painted", frame.bits, if frame.signed { "signed" } else { "unsigned" }, frame.components),
        };
        let table = window_table(frame, display)?;
        let (entries, offset) = table_shape(frame);
        let corners = placement(frame, &display.view, width, height, dpr)?;

        let row = frame.width * frame.components;
        let limit = self.device.limits().max_texture_dimension_2d;
        ensure!(row.max(frame.height).max(width).max(height) <= limit, "a {row}×{} texture or a {width}×{height} target is over this adapter's {limit}", frame.height);
        let format = if wide { wgpu::TextureFormat::R16Uint } else { wgpu::TextureFormat::R8Uint };
        let samples = self.texture(format, row, frame.height, frame.pixels, row * if wide { 2 } else { 1 })?;
        let table = self.texture(wgpu::TextureFormat::R8Uint, 256, entries as u32 / 256, &table, 256)?;
        let mut place: Vec<u8> = corners.iter().flatten().flat_map(|f| f.to_le_bytes()).collect();
        place.extend((offset as u32).to_le_bytes());
        place.extend(frame.components.to_le_bytes());
        place.resize(80, 0);
        let uniform = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: place.len() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.queue.write_buffer(&uniform, 0, &place);
        let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.pipeline.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: uniform.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&samples.create_view(&Default::default())) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&table.create_view(&Default::default())) },
            ],
        });

        let target = self.device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let stride = (width * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        let read = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: (stride * height) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        {
            let view = target.create_view(&Default::default());
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                })],
                ..Default::default()
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &bind, &[]);
            pass.draw(0..4, 0..1);
        }
        encoder.copy_texture_to_buffer(
            target.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &read,
                layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(stride), rows_per_image: None },
            },
            target.size(),
        );
        self.queue.submit([encoder.finish()]);
        read.slice(..).map_async(wgpu::MapMode::Read, |r| r.expect("map the read-back"));
        self.device.poll(wgpu::PollType::wait_indefinitely())?;
        let mapped = read.slice(..).get_mapped_range()?;
        Ok(mapped.chunks(stride as usize).flat_map(|r| &r[..width as usize * 4]).copied().collect())
    }

    fn texture(&self, format: wgpu::TextureFormat, width: u32, height: u32, data: &[u8], bytes_per_row: u32) -> Result<wgpu::Texture> {
        ensure!(data.len() >= (bytes_per_row * height) as usize, "{} bytes for a {width}×{height} {format:?} texture", data.len());
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let layout = wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(bytes_per_row), rows_per_image: None };
        self.queue.write_texture(texture.as_image_copy(), data, layout, texture.size());
        Ok(texture)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two edges `voi.test.mjs` works by hand that no cell reaches, so the port is checked there too: LINEAR at
    /// width 1 is a step between c − 1 and c, and under 1 is refused; a signed 16-bit code s sits at s + 32 768.
    #[test]
    fn linear_width_one_is_a_step_and_signed_16_bit_sits_at_half() {
        let frame = Frame { pixels: &[], width: 1, height: 1, bits: 16, components: 1, signed: true };
        let view = View { fit: false, zoom: 1.0, pan_x: 0.0, pan_y: 0.0, rotate: 0, flip_h: false, flip_v: false };
        let mut display = Display { photometric: Photometric::Monochrome2, invert: false, slope: 1.0, intercept: 0.0, voi: None, view };
        let mut table = |center, width| {
            display.voi = Some(Voi { center, width, function: Function::Linear });
            window_table(&frame, &display)
        };
        let t = table(0.0, 1.0).unwrap();
        assert_eq!((t[32768 - 1], t[32768]), (0, 255));
        assert!(table(0.0, 0.99).is_err());
    }

    /// An RGB frame wider than wgpu's default 8192 texels a row (three a pixel) paints as stored; one over the
    /// adapter's limit is refused by name rather than panicking in wgpu.
    #[test]
    fn a_row_past_the_default_limit_paints_and_one_past_the_adapter_is_refused() {
        let painter = Painter::new().unwrap();
        let view = View { fit: false, zoom: 1.0, pan_x: 0.0, pan_y: 0.0, rotate: 0, flip_h: false, flip_v: false };
        let display = Display { photometric: Photometric::Rgb, invert: false, slope: 1.0, intercept: 0.0, voi: None, view };
        let pixels: Vec<u8> = (0..3000 * 3).map(|i| (i % 251) as u8).collect();
        let rgb = Frame { pixels: &pixels, width: 3000, height: 1, bits: 8, components: 3, signed: false };
        let rgba = painter.paint(&rgb, &display, 3000, 1, 1.0).unwrap();
        assert!(rgba.chunks(4).zip(pixels.chunks(3)).all(|(p, s)| p[..3] == *s && p[3] == 255));

        let over = painter.device.limits().max_texture_dimension_2d / 3 + 1;
        let pixels = vec![0; over as usize * 3];
        let rgb = Frame { width: over, pixels: &pixels, ..rgb };
        assert!(painter.paint(&rgb, &display, 8, 1, 1.0).is_err());
    }
}
