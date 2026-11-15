@echo off
setlocal
node "%~dp0setup.mjs" %*
exit /b %errorlevel%
