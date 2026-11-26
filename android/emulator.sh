#!/usr/bin/env bash
# Запустить видимый эмулятор (не headless), чтобы менять интерфейс и сразу смотреть.
set -euo pipefail
cd "$(dirname "$0")"

ADB="${ADB:-D:/tools/android-sdk/platform-tools/adb.exe}"
EMULATOR="${EMULATOR:-D:/tools/android-sdk/emulator/emulator.exe}"
AVD="${AVD:-undertow}"

if "$ADB" devices | awk 'NR>1 && $2=="device"' | grep -q .; then
  echo "Устройство уже подключено — эмулятор не нужен."
  exit 0
fi

"$EMULATOR" -avd "$AVD" -gpu auto >/tmp/undertow-emulator.log 2>&1 &
echo "Эмулятор запускается..."
"$ADB" wait-for-device
for _ in $(seq 1 80); do
  [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
  sleep 3
done
echo "Эмулятор готов."
