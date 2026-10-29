//! On Windows the main window draws its own title bar (TitleBar.tsx), so its ＿ □ ✕ live in the page.
//! When the page stops answering, the OS title bar comes back until the page does.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

static START: OnceLock<Instant> = OnceLock::new();
static LAST_BEAT_MS: AtomicU64 = AtomicU64::new(0);
static FALLBACK: AtomicBool = AtomicBool::new(false);
/// The page beats every 2s; a few missed beats is a hang, not a slow frame.
const STALE_AFTER: Duration = Duration::from_secs(8);

fn now_ms() -> u64 {
    START.get_or_init(Instant::now).elapsed().as_millis() as u64
}

fn fresh() {
    LAST_BEAT_MS.store(now_ms(), Ordering::SeqCst);
}

pub fn install<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> tauri::Result<()> {
    window.set_decorations(false)?;
    fresh();
    let window = window.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        // Only while focused: a hidden or covered page has its timers throttled, which is not a hang.
        if !window.is_focused().unwrap_or(false) {
            continue;
        }
        let stale = now_ms().saturating_sub(LAST_BEAT_MS.load(Ordering::SeqCst)) > STALE_AFTER.as_millis() as u64;
        if stale && !FALLBACK.swap(true, Ordering::SeqCst) {
            let _ = window.set_decorations(true);
        }
    });
    Ok(())
}

/// Coming back into focus restarts the clock, so a throttled page gets time to beat again.
pub fn focused() {
    fresh();
}

/// The page's heartbeat; after a fallback it also takes the OS title bar away again.
pub fn alive<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    fresh();
    if FALLBACK.swap(false, Ordering::SeqCst) {
        let _ = window.set_decorations(false);
    }
}
