//! What the user has set — the frame, its window and its pose — and the status the window's title carries: the
//! browser core's controls (`client/viewer/viewer.js`) on the painter's `View`. `docs/native/README.md` §Parity.

use crate::paint::{Display, Function, Photometric, View, Voi};
use crate::verify::Exact;

/// The user's input as the thread that paints applies it.
#[derive(Debug)]
pub enum Intent {
    Step(i64),
    To(usize),
    /// A drag starts: what it moves is taken as it stands.
    Grab,
    /// From the grab, in CSS px: the window and level, or with `pan` the image.
    Drag { dx: f64, dy: f64, pan: bool },
    Zoom(f64),
    Rotate,
    FlipH,
    FlipV,
    Invert,
    Fit,
    Reset,
    Cine,
    Resize(u32, u32),
    Redraw,
}

#[derive(Clone, Copy)]
struct Grabbed {
    center: f64,
    width: f64,
    pan_x: f64,
    pan_y: f64,
}

#[derive(Clone, Copy)]
pub struct Look {
    pub current: usize,
    pub center: f64,
    pub width: f64,
    pub invert: bool,
    pub view: View,
    opened: (f64, f64),
    grabbed: Option<Grabbed>,
}

impl Look {
    /// 1:1 on the series' own window, as the window opens.
    pub fn new(center: f64, width: f64) -> Self {
        let view = View { fit: false, zoom: 1.0, pan_x: 0.0, pan_y: 0.0, rotate: 0, flip_h: false, flip_v: false };
        Self { current: 0, center, width, invert: false, view, opened: (center, width), grabbed: None }
    }

    /// True when the change needs a paint. A step stops at either end.
    pub fn apply(&mut self, intent: &Intent, count: usize) -> bool {
        let v = &mut self.view;
        match *intent {
            Intent::Step(by) => return self.go((self.current as i64 + by).clamp(0, count as i64 - 1) as usize),
            Intent::To(index) => return self.go(index.min(count - 1)),
            Intent::Grab => {
                self.grabbed = Some(Grabbed { center: self.center, width: self.width, pan_x: v.pan_x, pan_y: v.pan_y });
                return false;
            }
            Intent::Drag { dx, dy, pan } => {
                let Some(g) = self.grabbed else { return false };
                if pan {
                    (v.pan_x, v.pan_y) = (g.pan_x + dx, g.pan_y + dy);
                } else {
                    // The browser's sensitivity: a window's width per 256 px.
                    let k = g.width.max(1.0) / 256.0;
                    (self.width, self.center) = ((g.width + dx * k).max(1.0), g.center + dy * k);
                    println!("window center={} width={}", self.center, self.width);
                }
            }
            Intent::Zoom(by) => v.zoom *= by,
            Intent::Rotate => v.rotate = (v.rotate + 90) % 360,
            Intent::FlipH => v.flip_h = !v.flip_h,
            Intent::FlipV => v.flip_v = !v.flip_v,
            Intent::Invert => self.invert = !self.invert,
            Intent::Fit => v.fit = !v.fit,
            Intent::Reset => *self = Self { current: self.current, ..Self::new(self.opened.0, self.opened.1) },
            Intent::Cine => return false,
            Intent::Resize(..) | Intent::Redraw => {}
        }
        true
    }

    fn go(&mut self, index: usize) -> bool {
        std::mem::replace(&mut self.current, index) != index
    }

    pub fn display(&self, photometric: Photometric, slope: f64, intercept: f64, function: Function) -> Display {
        let voi = Some(Voi { center: self.center, width: self.width, function });
        Display { photometric, invert: self.invert, slope, intercept, voi, view: self.view }
    }
}

/// What the window's title says of each frame, and the last failure of any.
pub struct Status {
    marks: Vec<Mark>,
    error: Option<String>,
}

#[derive(Clone, PartialEq, Debug)]
enum Mark {
    Waiting,
    Exact,
    Unchecked,
    Failed(String),
}

impl Status {
    pub fn new(count: usize) -> Self {
        Self { marks: vec![Mark::Waiting; count], error: None }
    }

    /// A frame held, as its check found it.
    pub fn held(&mut self, index: u32, exact: Exact) {
        if let Some(m) = self.marks.get_mut(index as usize) {
            *m = if exact == Exact::True { Mark::Exact } else { Mark::Unchecked };
        }
    }

    /// `reason` names the failure: `NOT EXACT…`, `refused: …`, a lost session's, or a cache's (the frame still held).
    pub fn failed(&mut self, index: u32, reason: &str) {
        if let Some(m) = self.marks.get_mut(index as usize) {
            *m = Mark::Failed(reason.into());
        }
        self.error = Some(format!("frame {}: {reason}", index + 1));
    }

    pub fn title(&self, current: usize) -> String {
        let mark = match self.marks.get(current) {
            Some(Mark::Exact) => "exact",
            Some(Mark::Unchecked) => "unchecked",
            Some(Mark::Failed(reason)) => reason,
            _ => "waiting",
        };
        let error = self.error.as_ref().map_or(String::new(), |e| format!(" · error: {e}"));
        format!("wt-pacs · frame {} of {} · {mark}{error}", current + 1, self.marks.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **Each of the browser core's controls moves what the browser's moves.** Steps stop at the ends, Home and End
    /// go to them; zoom multiplies; rotation turns a quarter at a time and comes round; each flip and the invert
    /// toggle; F toggles fitted.
    #[test]
    fn each_control_moves_what_the_browsers_moves() {
        let mut look = Look::new(1024.0, 2048.0);
        assert!(!look.apply(&Intent::Step(-1), 4) && look.current == 0);
        assert!(look.apply(&Intent::To(9), 4) && look.current == 3, "End did not stop at the last frame");
        assert!(!look.apply(&Intent::Step(1), 4) && look.current == 3);
        assert!(look.apply(&Intent::To(0), 4) && look.current == 0);
        look.apply(&Intent::Zoom(1.25), 4);
        look.apply(&Intent::Zoom(0.8), 4);
        look.apply(&Intent::Zoom(1.25), 4);
        assert_eq!(look.view.zoom, 1.25);
        for want in [90, 180, 270, 0] {
            look.apply(&Intent::Rotate, 4);
            assert_eq!(look.view.rotate, want);
        }
        for intent in [Intent::FlipH, Intent::FlipV, Intent::Invert, Intent::Fit] {
            look.apply(&intent, 4);
        }
        let d = look.display(Photometric::Monochrome2, 1.0, 0.0, Function::Linear);
        assert!(d.view.flip_h && d.view.flip_v && d.invert && d.view.fit && d.view.zoom == 1.25, "the display did not carry the controls");
    }

    /// **A drag moves from where it was grabbed.** A primary drag of (40, 24) px moves width and centre by a window's
    /// width per 256 px, measured from the grab, so a second move replaces the first rather than adding to it; a
    /// secondary drag pans by the px moved; with no grab nothing moves.
    #[test]
    fn a_drag_moves_from_where_it_was_grabbed() {
        let mut look = Look::new(1024.0, 2048.0);
        assert!(!look.apply(&Intent::Drag { dx: 40.0, dy: 24.0, pan: false }, 4) && look.width == 2048.0);
        look.apply(&Intent::Grab, 4);
        look.apply(&Intent::Drag { dx: 10.0, dy: 0.0, pan: false }, 4);
        look.apply(&Intent::Drag { dx: 40.0, dy: 24.0, pan: false }, 4);
        assert_eq!((look.center, look.width), (1024.0 + 24.0 * 8.0, 2048.0 + 40.0 * 8.0));
        look.apply(&Intent::Grab, 4);
        look.apply(&Intent::Drag { dx: -5.0, dy: 7.0, pan: true }, 4);
        look.apply(&Intent::Drag { dx: -6.0, dy: 7.0, pan: true }, 4);
        assert_eq!((look.view.pan_x, look.view.pan_y), (-6.0, 7.0));
        assert_eq!(look.width, 2368.0, "a pan moved the window");
    }

    /// **Reset returns to the opening display and keeps the frame.** After every control, reset gives the series'
    /// own window, 1:1, no zoom, pan, turn, flip or invert, on the same frame.
    #[test]
    fn reset_returns_to_the_opening_display_and_keeps_the_frame() {
        let mut look = Look::new(100.0, 50.0);
        look.apply(&Intent::Step(2), 4);
        look.apply(&Intent::Grab, 4);
        for intent in [Intent::Drag { dx: 9.0, dy: 9.0, pan: false }, Intent::Zoom(2.0), Intent::Rotate, Intent::FlipH, Intent::FlipV, Intent::Invert, Intent::Fit] {
            look.apply(&intent, 4);
        }
        look.apply(&Intent::Grab, 4);
        look.apply(&Intent::Drag { dx: 3.0, dy: 3.0, pan: true }, 4);
        assert!(look.apply(&Intent::Reset, 4));
        let opened = Look::new(100.0, 50.0);
        let d = look.display(Photometric::Monochrome2, 1.0, 0.0, Function::Linear);
        let o = opened.display(Photometric::Monochrome2, 1.0, 0.0, Function::Linear);
        assert_eq!((look.current, look.center, look.width, d.invert), (2, 100.0, 50.0, false));
        assert_eq!(d.view, o.view);
    }

    /// **The title says the frame, its check and the last failure.** A frame not yet held is waiting; held, it is
    /// exact or unchecked; a frame that failed its check or was refused says so on its own line and as the error,
    /// which stays when another frame is shown; a cache failure on a frame later held leaves it exact.
    #[test]
    fn the_title_says_the_frame_its_check_and_the_last_failure() {
        let mut status = Status::new(4);
        assert_eq!(status.title(0), "wt-pacs · frame 1 of 4 · waiting");
        status.held(0, Exact::True);
        status.held(1, Exact::Unchecked);
        assert_eq!(status.title(1), "wt-pacs · frame 2 of 4 · unchecked");
        status.failed(2, "NOT EXACT");
        assert_eq!(status.title(2), "wt-pacs · frame 3 of 4 · NOT EXACT · error: frame 3: NOT EXACT");
        status.failed(3, "refused: out of range");
        assert_eq!(status.title(0), "wt-pacs · frame 1 of 4 · exact · error: frame 4: refused: out of range");
        status.failed(0, "cache: disk full");
        status.held(0, Exact::True);
        assert_eq!(status.title(0), "wt-pacs · frame 1 of 4 · exact · error: frame 1: cache: disk full");
    }
}
