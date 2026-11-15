import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const requiredPlatforms = [
  'darwin-aarch64', 'darwin-aarch64-app',
  'darwin-x86_64', 'darwin-x86_64-app',
  'linux-x86_64', 'linux-x86_64-appimage',
  'windows-x86_64',
];

export function validateRelease(tag, repository, metadata, release, readSignature) {
  if (!release.isDraft || release.tagName !== tag) {
    throw new Error('Expected the matching draft release');
  }
  if (!tag.startsWith('v') || metadata.version !== tag.slice(1)) {
    throw new Error('Updater version does not match the release tag');
  }
  if (!metadata.platforms || typeof metadata.platforms !== 'object' || Array.isArray(metadata.platforms)) {
    throw new Error('Updater platforms are missing');
  }
  for (const platform of requiredPlatforms) {
    if (!metadata.platforms[platform]) throw new Error(`Missing platform: ${platform}`);
  }
  if (!metadata.platforms['windows-x86_64-msi'] && !metadata.platforms['windows-x86_64-nsis']) {
    throw new Error('Missing Windows installer platform');
  }
  const assets = new Map(release.assets.map((asset) => [asset.name, asset]));
  const prefix = `/${repository}/releases/download/${encodeURIComponent(tag)}/`;
  for (const [platform, entry] of Object.entries(metadata.platforms)) {
    if (!entry || typeof entry.signature !== 'string' || !entry.signature.trim() || typeof entry.url !== 'string') {
      throw new Error(`Missing signature or URL for ${platform}`);
    }
    const url = new URL(entry.url);
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith(prefix) || url.search || url.hash) {
      throw new Error(`Invalid release URL for ${platform}`);
    }
    const name = decodeURIComponent(url.pathname.slice(prefix.length));
    if (!name || name.includes('/') || name.includes('\\')) {
      throw new Error(`Invalid asset name for ${platform}`);
    }
    const asset = assets.get(name);
    const signatureAsset = assets.get(`${name}.sig`);
    if (!asset || asset.state !== 'uploaded' || !asset.size ||
        !signatureAsset || signatureAsset.state !== 'uploaded' || !signatureAsset.size) {
      throw new Error(`Missing uploaded asset or signature for ${platform}`);
    }
    if (readSignature(`${name}.sig`) !== entry.signature) {
      throw new Error(`Signature does not match the uploaded signature for ${platform}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [tag, repository, assetDir, releaseFile] = process.argv.slice(2);
  const metadata = JSON.parse(readFileSync(join(assetDir, 'latest.json'), 'utf8'));
  const release = JSON.parse(readFileSync(releaseFile, 'utf8'));
  validateRelease(tag, repository, metadata, release, (name) => readFileSync(join(assetDir, name), 'utf8'));
  console.log(`Validated updater metadata for ${tag}`);
}
