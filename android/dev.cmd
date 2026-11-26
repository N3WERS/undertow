@echo off
cd /d "%~dp0"
set JAVA_HOME=D:\tools\jdk-17.0.21.1+2
call gradlew.bat installDebug || exit /b 1
D:\tools\android-sdk\platform-tools\adb.exe shell am force-stop co.undertow.mobile
D:\tools\android-sdk\platform-tools\adb.exe shell am start -n co.undertow.mobile/.MainActivity >nul
echo Ready.
