; Juno's Windows installer text.
;
; electron-builder generates the rest of the NSIS script. This file only
; replaces the wording on the pages a person actually reads, so the installer
; says what Juno is and where it keeps things rather than the default
; boilerplate about an application being set up.
;
; Kept short on purpose. Nobody reads an installer, so the two lines that do get
; read should be the two that matter: it runs locally, and your data survives an
; uninstall.

!macro preInit
  ; Per-user by default, so installing needs no administrator and the database
  ; lands under the account that will actually use it.
  SetRegView 64
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Install Juno"
  !define MUI_WELCOMEPAGE_TEXT "Juno keeps your clients, contracts, mail, calendar and reminders on this machine.$\r$\n$\r$\nIt works offline. Nothing is sent anywhere unless you set up a mail account yourself.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "Juno is installed"
  !define MUI_FINISHPAGE_TEXT "Your data lives in your user folder, separate from the program itself. Uninstalling Juno leaves it untouched."
  !define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  !define MUI_FINISHPAGE_RUN_TEXT "Open Juno"
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnWelcomePage
  !define MUI_UNWELCOMEPAGE_TITLE "Remove Juno"
  !define MUI_UNWELCOMEPAGE_TEXT "This removes the Juno program.$\r$\n$\r$\nYour database, documents and mail stay in your user folder. Delete that folder by hand if you want them gone as well.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
