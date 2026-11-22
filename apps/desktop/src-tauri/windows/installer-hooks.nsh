; Installer hooks (docs/specs/retire-legacy-home.md). Before v0.2.52 the executable was named
; acp-harness-desktop.exe (legacy). Tauri's installer deletes it after copying zomfy.exe and points the
; Start menu and desktop shortcuts at the new name; these hooks close the legacy executable first, so
; its file is not locked, and move a taskbar pin along.

!define LEGACY_MAIN_BINARY "acp-harness-desktop.exe" ; legacy executable name

!macro NSIS_HOOK_PREINSTALL
  ; Closed the way the installer closes the app under its current name: silently during an update,
  ; after asking otherwise.
  ${If} ${FileExists} "$INSTDIR\${LEGACY_MAIN_BINARY}"
    !insertmacro CheckIfAppIsRunning "$INSTDIR\${LEGACY_MAIN_BINARY}" "${PRODUCTNAME}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} ${FileExists} "$INSTDIR\${LEGACY_MAIN_BINARY}"
    Delete /REBOOTOK "$INSTDIR\${LEGACY_MAIN_BINARY}"
  ${EndIf}
  StrCpy $R9 "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${PRODUCTNAME}.lnk"
  ${If} ${FileExists} "$R9"
    !insertmacro IsShortcutTarget "$R9" "$INSTDIR\${LEGACY_MAIN_BINARY}"
    Pop $0
    ${If} $0 = 1
      !insertmacro SetShortcutTarget "$R9" "$INSTDIR\${MAINBINARYNAME}.exe"
    ${EndIf}
  ${EndIf}
!macroend
