#Requires -RunAsAdministrator
# Patches installed NEXOR under Program Files (Start Menu app uses that bundle).

& (Join-Path $PSScriptRoot 'sync-nexor-backend.ps1')
