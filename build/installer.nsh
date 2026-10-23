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

; Say so when Star Companion is already installed: the installer updates it in place (same folder,
; settings kept), which otherwise looks like a fresh install. Skipped for silent runs, which is how the
; in-app updater installs a new version.
!macro customInit
  IfSilent sc_init_done
  ReadRegStr $0 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  StrCmp $0 "" 0 sc_found
  ReadRegStr $0 HKLM "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  StrCmp $0 "" sc_init_done sc_found
  sc_found:
  StrCmp $0 "${VERSION}" 0 sc_update
  MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Star Companion by Vorxen ${VERSION} is already installed.$\r$\n$\r$\nSetup will reinstall it in the same folder. Your settings are kept." IDOK sc_init_done
  Quit
  sc_update:
  MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Star Companion by Vorxen $0 is already installed.$\r$\n$\r$\nSetup will update it to ${VERSION} in the same folder. Your settings are kept." IDOK sc_init_done
  Quit
  sc_init_done:
!macroend
