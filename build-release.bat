@echo off
setlocal
set "REPO=%~dp0"
set "DEPLOY=C:\Utilities\stewrd\plugins\notepad"

cd /d "%REPO%"
if not exist node_modules call npm install || exit /b 1
call npm run build || exit /b 1

rem Release zip: forward-slash paths, no wrapping folder (marketplace extraction requires it).
py package-zip.py notepad.zip || exit /b 1
rem storage.json and data\ hold the plugin's runtime state in the deploy folder, so /MIR must not delete them.
robocopy "%REPO%." "%DEPLOY%" /MIR /NFL /NDL /NJH /NP ^
  /XD .git .remember .serena node_modules data ^
  /XF storage.json settings.json package.json package-lock.json build-release.bat package-zip.py CLAUDE.md ARCHITECTURE.md *.zip
if %ERRORLEVEL% GEQ 8 exit /b 1
rem settings.json is excluded above so a deploy never resets the user's Harvest prompt; seed it on first deploy only.
if not exist "%DEPLOY%\settings.json" copy "%REPO%settings.json" "%DEPLOY%\settings.json" >nul
echo Deployed to %DEPLOY%
exit /b 0
