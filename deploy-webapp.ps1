# Kwanza ERP - Build & Deploy to Backend
# Run from the project root (your Git repo folder)

Write-Host "`n=== Kwanza ERP - Build & Deploy ===" -ForegroundColor Cyan

# 1. Build
Write-Host "`n[1/2] Building frontend for /app..." -ForegroundColor Yellow
npm run build:webapp
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed!" -ForegroundColor Red; exit 1 }

# 2. Copy
Write-Host "[2/2] Copying dist/ to backend/webapp/..." -ForegroundColor Yellow
Remove-Item -Path .\backend\webapp\assets -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Path .\dist\* -Destination .\backend\webapp\ -Recurse -Force

Write-Host "`nDone! Backend is now serving the latest build." -ForegroundColor Green
