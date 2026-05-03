#!/usr/bin/env node

/**
 * NEXOR ERP - Electron Setup Script
 * 
 * Run this ONCE after cloning:
 *   node setup-electron.js
 * 
 * This will configure package.json for Electron desktop app.
 */

const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, 'package.json');

console.log('🚀 Setting up NEXOR ERP Desktop App...\n');

// Read current package.json
let packageJson;
try {
  packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  console.log('✅ Found package.json');
} catch (error) {
  console.error('❌ Error reading package.json:', error.message);
  process.exit(1);
}

// Add main entry point for Electron
packageJson.main = 'electron/main.cjs';
console.log('✅ Added Electron main entry point');

// Add Electron scripts
const electronScripts = {
  'electron:dev': 'concurrently "npm run dev" "wait-on http://localhost:8080 && cross-env ELECTRON_DEV=true electron ."',
  'electron:build': 'npm run build && electron-builder --win',
  'electron:build:portable': 'npm run build && electron-builder --win portable',
  'electron:build:mac': 'npm run build && electron-builder --mac',
  'electron:build:linux': 'npm run build && electron-builder --linux',
  'electron:build:all': 'npm run build && electron-builder --win --mac --linux'
};

packageJson.scripts = {
  ...packageJson.scripts,
  ...electronScripts
};
console.log('✅ Added Electron build scripts');

// Add build configuration reference
packageJson.build = {
  extends: 'electron-builder.json'
};
console.log('✅ Added build configuration');

// Write updated package.json
try {
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  console.log('✅ Updated package.json');
} catch (error) {
  console.error('❌ Error writing package.json:', error.message);
  process.exit(1);
}

console.log('\n========================================');
console.log('🎉 Setup complete!');
console.log('========================================\n');
console.log('Next steps:\n');
console.log('1. Install dependencies (if not done):');
console.log('   npm install\n');
console.log('2. Install cross-env for Windows compatibility:');
console.log('   npm install --save-dev cross-env\n');
console.log('3. Run the desktop app in dev mode:');
console.log('   npm run electron:dev\n');
console.log('4. Build the .exe installer:');
console.log('   npm run electron:build\n');
console.log('Your .exe will be in the /release folder!\n');
