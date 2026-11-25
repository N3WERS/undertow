!macro customInit
  ; останавливаем службу до распаковки: иначе она держит UndertowDpiService.exe
  ExecWait '"$SYSDIR\sc.exe" stop UndertowDpi' $0
  Sleep 1200
!macroend

!macro customInstall
  DetailPrint "Устанавливаю службу обхода DPI..."
  ExecWait '"$INSTDIR\resources\zapret\UndertowDpiService.exe" --install "$INSTDIR\resources\zapret"' $0
  ; подчищаем движок из 0.5.5–0.5.8, чтобы не оставалось двух наборов файлов
  RMDir /r "$INSTDIR\resources\undertowdpi"
  DetailPrint "Служба UndertowDpi: код $0"
!macroend

!macro customUnInstall
  DetailPrint "Удаляю службу обхода DPI..."
  ExecWait '"$INSTDIR\resources\zapret\UndertowDpiService.exe" --uninstall' $0
!macroend
