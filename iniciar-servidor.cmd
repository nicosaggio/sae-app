@echo off
setlocal
set NODE_EXE="C:\Program Files\nodejs\node.exe"
set SCRIPT=%~dp0server\src\index.js

if not exist %NODE_EXE% (
  echo No se encontro Node.js en C:\Program Files\nodejs\node.exe
  echo Instalalo desde https://nodejs.org/ y volve a intentar.
  pause
  exit /b 1
)

echo Iniciando SAE-APP...
%NODE_EXE% "%SCRIPT%"
pause
