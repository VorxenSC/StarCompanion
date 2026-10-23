; Extra NSIS settings for the Star Companion installer (electron-builder "nsis.include").
; The install folder stays "Star Companion" (the productName); only the window titles carry the brand.
; Plain ASCII on purpose: NSIS may read this file in the system code page.

!macro customHeader
  Caption "Star Companion by Vorxen Setup"
  UninstallCaption "Star Companion by Vorxen Uninstall"
  BrandingText "Star Companion by Vorxen"
!macroend
