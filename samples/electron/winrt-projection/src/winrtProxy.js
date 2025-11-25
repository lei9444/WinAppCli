const fs = require('node:fs');
const path = require('node:path');

const metadataPath = path.join(__dirname, '..', 'generated', 'windows.storage.fileio.json');

const defaultAddonPath = path.join(__dirname, '..', 'addon', 'build', 'Release', 'winrt_bridge.node');

function getResourcesPath() {
  if (process?.resourcesPath) {
    return process.resourcesPath;
  }

  const exeDir = path.dirname(process.execPath);
  const candidate = path.join(exeDir, 'resources');
  return fs.existsSync(candidate) ? candidate : exeDir;
}

function resolveAddonPath() {
  if (!defaultAddonPath.includes('app.asar')) {
    return defaultAddonPath;
  }

  const unpackedFromDefault = defaultAddonPath.replace('app.asar', 'app.asar.unpacked');
  if (fs.existsSync(unpackedFromDefault)) {
    return unpackedFromDefault;
  }

  const resourcesPath = getResourcesPath();
  const unpackedFromResources = path.join(
    resourcesPath,
    'app.asar.unpacked',
    'winrt-projection',
    'addon',
    'build',
    'Release',
    'winrt_bridge.node'
  );

  if (fs.existsSync(unpackedFromResources)) {
    return unpackedFromResources;
  }

  return defaultAddonPath;
}

const addonPath = resolveAddonPath();

const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
let native;

function ensureNative() {
  if (!native) {
    native = require(addonPath);
  }
  return native;
}

function createFileIOProxy() {
  const methods = {};
  for (const method of metadata.methods) {
    if (method.name === 'ReadTextAsync') {
      methods.ReadTextAsync = (filePath) => ensureNative().readText(filePath);
      methods.readTextAsync = methods.ReadTextAsync;
    }
  }
  return methods;
}

const Windows = {
  Storage: {
    FileIO: createFileIOProxy()
  },
  Media: {
    Ocr: {
      recognizeText: (imagePath) => ensureNative().recognizeText(imagePath),
      checkAIAvailability: () => ensureNative().checkAIAvailability()
    }
  }
};

module.exports = { Windows };
