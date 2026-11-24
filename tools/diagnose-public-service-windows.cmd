@echo off
setlocal
set "WRITER_DIAG_DIR=%~dp0"
set "WRITER_DIAG_EXE=%~1"
echo Writer public service diagnostics - read only
echo This tool does not change application data, settings, certificates or proxy configuration.
echo.
powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop'; $exe=$env:WRITER_DIAG_EXE; if (!$exe) { $exe=Get-Process Writer -ErrorAction SilentlyContinue | Where-Object {$_.Path} | Select-Object -First 1 -ExpandProperty Path }; if (!$exe) { foreach ($candidate in @((Join-Path $env:LOCALAPPDATA 'Programs\Writer\Writer.exe'),(Join-Path $env:ProgramFiles 'Writer\Writer.exe'))) { if (Test-Path -LiteralPath $candidate) { $exe=$candidate; break } } }; if (!$exe -or !(Test-Path -LiteralPath $exe) -or [IO.Path]::GetFileName($exe) -ine 'Writer.exe') { Write-Host 'Writer.exe was not found. Drag your installed Writer.exe onto this CMD file.'; exit 1 }; $stream=[IO.File]::OpenRead($exe); $enabled=$false; try { $buffer=New-Object byte[] 4194304; $tail=''; while (($read=$stream.Read($buffer,0,$buffer.Length)) -gt 0) { $text=$tail+[Text.Encoding]::ASCII.GetString($buffer,0,$read); $index=$text.IndexOf('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX',[StringComparison.Ordinal); if ($index -ge 0 -and $text.Length -gt ($index+34)) { $enabled=$text[$index+34] -eq '1'; break }; $tail=$text.Substring([Math]::Max(0,$text.Length-40)) } } finally { $stream.Dispose() }; if (!$enabled) { Write-Host 'The installed runtime does not enable diagnostics. No application was started.'; exit 1 }; foreach ($name in @('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy','NODE_USE_ENV_PROXY','NODE_OPTIONS','NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS')) { [Environment]::SetEnvironmentVariable($name,$null,'Process') }; $env:ELECTRON_RUN_AS_NODE='1'; & $exe (Join-Path $env:WRITER_DIAG_DIR 'diagnose-public-service.mjs') $exe (Join-Path $env:WRITER_DIAG_DIR '.') | Out-Host; exit $LASTEXITCODE"
set "DIAG_EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %DIAG_EXIT_CODE%
