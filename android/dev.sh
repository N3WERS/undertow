#!/usr/bin/env bash
# Собрать, поставить и сразу открыть Undertow на подключённом телефоне/эмуляторе.
set -euo pipefail
cd "$(dirname "$0")"

export JAVA_HOME="${JAVA_HOME:-/d/tools/jdk-17.0.21.1+2}"
ADB="${ADB:-D:/tools/android-sdk/platform-tools/adb.exe}"
PKG="co.undertow.mobile"

if ! "$ADB" devices | awk 'NR>1 && $2=="device"' | grep -q .; then
  echo "Нет устройства."
  echo "Эмулятор: ./emulator.sh"
  echo "Телефон: включи USB-отладку и подключи кабелем, затем повтори."
  exit 1
fi

echo "== build + install =="
./gradlew installDebug
echo "== restart =="
"$ADB" shell am force-stop "$PKG"
"$ADB" shell am start -n "$PKG/.MainActivity" >/dev/null
echo "Готово: смотри экран."
