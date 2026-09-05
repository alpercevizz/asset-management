@echo off
REM ============================================================
REM  AssetMan Collector - tek tikla kurulum
REM  Bu dosyaya CIFT TIKLAYIN. Yonetici izni istenecek (Evet deyin).
REM  Kurulum bittikten sonra hicbir sey yapmaniza gerek yok;
REM  cihaz saatte bir envantere otomatik rapor verir.
REM ============================================================
title AssetMan Collector Kurulumu
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0KUR.ps1"
