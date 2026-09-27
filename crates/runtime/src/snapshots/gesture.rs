//! Modifier-only gestures consume no keystrokes and retain no typed content.
#[derive(Clone, Copy)]
pub enum GestureEvent {
    ShiftDown,
    ShiftUp,
    Other,
}

#[derive(Default)]
pub struct DoubleShift {
    down: Option<u64>,
    first_up: Option<u64>,
    blocked_until: u64,
    last_other: Option<u64>,
}
impl DoubleShift {
    pub fn reset(&mut self) {
        *self = Self::default();
    }
    /// Two isolated 25–220 ms taps, 40–350 ms apart, after 400 ms of quiet.
    /// A 900 ms cooldown rejects triples/repeats. Any other key/button cancels.
    pub fn event(&mut self, event: GestureEvent, ms: u64) -> bool {
        match event {
            GestureEvent::Other => {
                self.down = None;
                self.first_up = None;
                self.last_other = Some(ms);
            }
            GestureEvent::ShiftDown => {
                if self.down.is_some()
                    || ms < self.blocked_until
                    || self.last_other.is_some_and(|t| ms.saturating_sub(t) < 400)
                {
                    self.down = None;
                    self.first_up = None;
                    return false;
                }
                if self
                    .first_up
                    .is_some_and(|t| !(40..=350).contains(&ms.saturating_sub(t)))
                {
                    self.first_up = None;
                }
                self.down = Some(ms);
            }
            GestureEvent::ShiftUp => {
                let Some(down) = self.down.take() else {
                    return false;
                };
                if !(25..=220).contains(&ms.saturating_sub(down)) {
                    self.first_up = None;
                    return false;
                }
                if self.first_up.take().is_some() {
                    self.blocked_until = ms.saturating_add(900);
                    return true;
                }
                self.first_up = Some(ms);
            }
        }
        false
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use GestureEvent::*;
    fn tap(g: &mut DoubleShift, t: u64) -> bool {
        assert!(!g.event(ShiftDown, t));
        g.event(ShiftUp, t + 60)
    }
    #[test]
    fn deliberate_taps_and_cooldown() {
        let mut g = DoubleShift::default();
        assert!(!tap(&mut g, 1000));
        assert!(tap(&mut g, 1160));
        assert!(!tap(&mut g, 1320));
        assert!(!tap(&mut g, 1480));
    }
    #[test]
    fn typing_modifiers_holds_and_late_taps_cancel() {
        let mut g = DoubleShift::default();
        tap(&mut g, 1000);
        g.event(Other, 1100);
        assert!(!tap(&mut g, 1160));
        assert!(!tap(&mut g, 2000));
        assert!(!tap(&mut g, 2600));
        g.event(ShiftDown, 3000);
        assert!(!g.event(ShiftUp, 3600));
        assert!(!tap(&mut g, 3700));
        g.reset();
        assert!(!tap(&mut g, 4000));
    }
    #[test]
    fn bounce_repeat_and_disabled_reset() {
        let mut g = DoubleShift::default();
        g.event(ShiftDown, 1000);
        assert!(!g.event(ShiftUp, 1001));
        assert!(!tap(&mut g, 1100));
        g.reset();
        assert!(!tap(&mut g, 1200));
        g.reset();
        assert!(!tap(&mut g, 1300));
        g.event(ShiftDown, 1400);
        g.event(ShiftDown, 1405);
        assert!(!g.event(ShiftUp, 1460));
    }
}
