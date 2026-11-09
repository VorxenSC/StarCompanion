; Extra NSIS settings for the Star Companion installer (electron-builder "nsis.include").
; The install folder stays "Star Companion" (the productName); only the window titles carry the brand.
; Plain ASCII on purpose: NSIS may read this file in the system code page.

!macro customHeader
  Caption "Star Companion by Vorxen Setup"
  UninstallCaption "Star Companion by Vorxen Uninstall"
  BrandingText "Star Companion by Vorxen"
!macroend

; The uninstall entry electron-builder writes for this appId (its GUID is derived from the appId).
!ifndef UNINSTALL_REGISTRY_KEY
  !define UNINSTALL_REGISTRY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\a37124d4-87cb-5e4a-8593-651c584aef7c"
!endif

; When Star Companion is already installed, say so and offer the choice: Yes updates or reinstalls it in
; place (same folder, settings kept), No runs its uninstaller instead, Cancel leaves everything as it is.
; Skipped for silent runs, which is how the in-app updater installs a new version.
!macro customInit
  IfSilent sc_init_done
  ReadRegStr $0 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ReadRegStr $1 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  StrCmp $0 "" 0 sc_found
  ReadRegStr $0 HKLM "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ReadRegStr $1 HKLM "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  StrCmp $0 "" sc_init_done sc_found
  sc_found:
  StrCmp $0 "${VERSION}" 0 sc_update
  MessageBox MB_YESNOCANCEL|MB_ICONQUESTION "Star Companion by Vorxen ${VERSION} is already installed.$\r$\n$\r$\nYes: reinstall it in the same folder (your settings are kept).$\r$\nNo: uninstall Star Companion.$\r$\nCancel: leave it as it is." IDYES sc_init_done IDNO sc_uninstall
  Quit
  sc_update:
  MessageBox MB_YESNOCANCEL|MB_ICONQUESTION "Star Companion by Vorxen $0 is already installed.$\r$\n$\r$\nYes: update it to ${VERSION} in the same folder (your settings are kept).$\r$\nNo: uninstall Star Companion.$\r$\nCancel: leave it as it is." IDYES sc_init_done IDNO sc_uninstall
  Quit
  sc_uninstall:
  StrCmp $1 "" 0 +3
  MessageBox MB_OK|MB_ICONEXCLAMATION "The uninstaller was not found. Use Windows Settings > Apps to remove Star Companion."
  Quit
  ExecWait '$1'
  Quit
  sc_init_done:
!macroend

; The theme to start with: a page after the install folder, two choices. The app reads the answer at its next
; start (install-theme.txt in its settings folder) and deletes the file; Settings > Look > Theme changes it later.
; Silent runs (the in-app updater) skip the page and write nothing, so an update keeps the player's theme.
!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  !include LogicLib.nsh
  Var scThemeDefault
  Var scThemeEclipse
  Var scTheme

  !macro customPageAfterChangeDir
    Page custom scThemePageCreate scThemePageLeave

    Function scThemePageCreate
      IfSilent 0 +2
      Abort
      !insertmacro MUI_HEADER_TEXT "Choose a theme" "How Star Companion looks. Settings > Look > Theme changes it at any time."
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}
      ${NSD_CreateLabel} 0 0 100% 20u "Both themes have the same features; only the colours and the fonts change."
      Pop $0
      ${NSD_CreateRadioButton} 10u 30u 100% 14u "Star Companion: cyan on dark blue, the original look"
      Pop $scThemeDefault
      ${NSD_CreateRadioButton} 10u 50u 100% 14u "Eclipse: orange on slate, Barlow fonts (by eclipsegaming.net)"
      Pop $scThemeEclipse
      ${If} $scTheme == "default"
        ${NSD_Check} $scThemeDefault
      ${Else}
        ${NSD_Check} $scThemeEclipse
      ${EndIf}
      nsDialogs::Show
    FunctionEnd

    Function scThemePageLeave
      ${NSD_GetState} $scThemeEclipse $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $scTheme "eclipse"
      ${Else}
        StrCpy $scTheme "default"
      ${EndIf}
    FunctionEnd
  !macroend

  !macro customInstall
    StrCmp $scTheme "" sc_theme_done
    CreateDirectory "$APPDATA\Star Companion"
    FileOpen $0 "$APPDATA\Star Companion\install-theme.txt" w
    FileWrite $0 $scTheme
    FileClose $0
    sc_theme_done:
  !macroend
!endif
