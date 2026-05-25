@echo off
title StockMind - Stop
echo Stopping StockMind backend...
taskkill /FI "WINDOWTITLE eq StockMind Backend*" /T /F >nul 2>&1
echo Done.
pause
