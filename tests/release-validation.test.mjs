import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRelease } from '../.github/scripts/validate-release.mjs';

const tag = 'v1.2.3';
const repository = 'owner/repo';
const platforms = [
  'darwin-aarch64', 'darwin-aarch64-app', 'darwin-x86_64', 'darwin-x86_64-app',
  'linux-x86_64', 'linux-x86_64-appimage', 'windows-x86_64', 'windows-x86_64-msi',
];

function fixture() {
  return {
    metadata: {
      version: '1.2.3',
      platforms: Object.fromEntries(platforms.map((platform) => [platform, {
        signature: 'signed\n',
        url: `https://github.com/${repository}/releases/download/${tag}/app.tar.gz`,
      }])),
    },
    release: {
      tagName: tag,
      isDraft: true,
      assets: ['app.tar.gz', 'app.tar.gz.sig'].map((name) => ({ name, state: 'uploaded', size: 1 })),
    },
  };
}

test('accepts a complete draft with matching signed assets', () => {
  const { metadata, release } = fixture();
  assert.doesNotThrow(() => validateRelease(tag, repository, metadata, release, () => 'signed\n'));
});

test('rejects incomplete or inconsistent updater releases', () => {
  const cases = [
    ({ metadata }) => { delete metadata.platforms['darwin-aarch64-app']; },
    ({ metadata }) => { metadata.version = '1.2.2'; },
    ({ metadata }) => { metadata.platforms['linux-x86_64'].url = 'https://github.com/owner/repo/releases/latest/download/app.tar.gz'; },
    ({ metadata }) => { metadata.platforms['windows-x86_64'].signature = ''; },
    ({ release }) => { release.assets.pop(); },
    ({ release }) => { release.isDraft = false; },
  ];
  for (const mutate of cases) {
    const data = fixture();
    mutate(data);
    assert.throws(() => validateRelease(tag, repository, data.metadata, data.release, () => 'signed\n'));
  }
  const { metadata, release } = fixture();
  assert.throws(() => validateRelease(tag, repository, metadata, release, () => 'different'));
});
