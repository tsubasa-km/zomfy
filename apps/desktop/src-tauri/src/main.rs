// No console window on Windows, in debug builds too: a debug exe started outside a terminal
// would otherwise open one beside the app.
#![windows_subsystem = "windows"]

fn main() {
    acp_harness_desktop_lib::run()
}
