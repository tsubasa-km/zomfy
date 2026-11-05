//! On Windows the main window draws its own title bar (TitleBar.tsx), so its ＿ □ ✕ live in the page.

pub fn install<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> tauri::Result<()> {
    window.set_decorations(false)
}
