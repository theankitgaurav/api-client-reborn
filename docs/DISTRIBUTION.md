# API Client Reborn — Distribution & Installation Guide

This guide provides complete instructions for building, distributing, and installing **API Client Reborn** across macOS, Windows, and Linux.

---

## 1. End-User Installation & System Prerequisites

Because API Client Reborn is built on **Tauri v2**, it uses the native operating system webview engine rather than bundling Chromium. This keeps the binary lightweight (~10–15 MB) and fast.

### macOS

* **System Requirements**: macOS 10.15 (Catalina) or newer. Works natively on both Apple Silicon (M1/M2/M3/M4) and Intel Macs via Universal binaries.
* **Prerequisites**: **None**. WebKit is built into macOS.
* **Installation**:
  1. Download the `.dmg` file from the [Releases](https://github.com/theankitgaurav/api-client-reborn/releases) page.
  2. Double-click the `.dmg` and drag `API Client Reborn.app` into your `Applications` folder.
* **Handling Gatekeeper (for unsigned builds)**:
  * If macOS displays: *"API Client Reborn is damaged and can't be opened"* or *"unidentified developer"*:
    * **Option A**: Right-click (or Control-click) `API Client Reborn.app` in `/Applications` and select **Open**, then click **Open** in the dialog.
    * **Option B**: Run the following command in Terminal:
      ```bash
      xattr -cr "/Applications/API Client Reborn.app"
      ```

---

### Windows

* **System Requirements**: Windows 10 (64-bit, version 1809+) or Windows 11.
* **Prerequisites**: **Microsoft Edge WebView2 Evergreen Runtime**.
  * Pre-installed on Windows 11 and all updated Windows 10 machines.
  * If missing, the installer will automatically download and install it in the background.
* **Installation**:
  1. Download the setup executable (`.exe` NSIS installer) or `.msi` from Releases.
  2. Double-click the installer and follow the prompt. The installer installs per-user by default without requiring administrator privileges.
* **Handling Windows SmartScreen (for unsigned builds)**:
  * Windows SmartScreen may show a blue prompt: *"Windows protected your PC"*.
  * Click **"More info"**, then click **"Run anyway"**.

---

### Linux

* **System Requirements**: Any modern Linux distribution (Ubuntu 20.04+, Debian 11+, Fedora 38+, Arch Linux, etc.).
* **Prerequisites**: GTK 3 and `webkit2gtk-4.1` (or `webkit2gtk-4.0`).

#### Option A: Debian / Ubuntu Package (`.deb`)
Recommended for Ubuntu, Debian, Pop!_OS, and Linux Mint.
```bash
sudo apt update
sudo apt install ./api-client-reborn_*_amd64.deb
```
`apt` will automatically download and install `libwebkit2gtk-4.1-0` and all other required dependencies.

#### Option B: AppImage (`.AppImage`)
Portable single-file executable for any distribution.
```bash
chmod +x api-client-reborn_*_amd64.AppImage
./api-client-reborn_*_amd64.AppImage
```
> **Note for Ubuntu 22.04+ / 24.04+**: If AppImage doesn't launch due to FUSE 3, install FUSE 2:
> ```bash
> sudo apt install libfuse2
> ```
> Alternatively, run with:
> ```bash
> ./api-client-reborn_*_amd64.AppImage --appimage-extract-and-run
> ```

---

## 2. Automated Release Workflow (GitHub Actions)

An automated multi-platform build pipeline is configured at [`.github/workflows/release.yml`](../.github/workflows/release.yml).

### Triggering a Release
To create and publish a new release:
1. Update `"version"` in both:
   * `package.json`
   * `src-tauri/tauri.conf.json`
   * `src-tauri/Cargo.toml`
2. Commit and push the changes:
   ```bash
   git commit -am "chore: bump version to 0.1.0"
   git push origin main
   ```
3. Tag the commit and push the tag:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
4. GitHub Actions will automatically:
   * Build **Universal macOS** `.dmg` and `.app.tar.gz` (Apple Silicon + Intel).
   * Build **Windows** `.exe` (NSIS) and `.msi`.
   * Build **Linux** `.deb` and `.AppImage`.
   * Create a **Draft Release** in GitHub Releases with all artifacts attached.
5. Review the release notes in GitHub and click **Publish release**.

---

## 3. Production Code Signing (Optional / When Ready)

### macOS (Apple Notarization)
To remove Gatekeeper warnings:
1. Enroll in the [Apple Developer Program](https://developer.apple.com/) ($99/yr).
2. Generate a **Developer ID Application** certificate and export it as `.p12`.
3. Add the following repository secrets in GitHub:
   * `APPLE_CERTIFICATE`: Base64-encoded `.p12` file.
   * `APPLE_CERTIFICATE_PASSWORD`: Password for the `.p12`.
   * `APPLE_SIGNING_IDENTITY`: Common Name on the certificate.
   * `APPLE_ID`: Your Apple ID email.
   * `APPLE_PASSWORD`: App-specific password generated from appleid.apple.com.
   * `APPLE_TEAM_ID`: Your 10-character Apple Developer Team ID.

### Windows (Authenticode Signing)
To remove Windows SmartScreen warnings:
1. Obtain an Authenticode Code Signing Certificate (or use Microsoft Azure Trusted Signing).
2. Pass the certificate or signing command via Tauri CLI configuration or GitHub Actions step.

---

## 4. Package Managers (Future Distribution Channels)

Once direct releases are published, the app can be submitted to community package managers:

* **macOS (Homebrew Cask)**:
  Create a formula pointing to the GitHub Release `.dmg` with the SHA-256 checksum:
  ```ruby
  cask "api-client-reborn" do
    version "0.1.0"
    sha256 "<SHA256_OF_DMG>"
    url "https://github.com/theankitgaurav/api-client-reborn/releases/download/v#{version}/api-client-reborn_#{version}_universal.dmg"
    name "API Client Reborn"
    desc "Lightweight native API client and cURL playground"
    homepage "https://github.com/theankitgaurav/api-client-reborn"
    app "API Client Reborn.app"
  end
  ```
* **Windows (Winget)**:
  Submit a manifest to the `microsoft/winget-pkgs` repository targeting the NSIS `.exe` installer.
* **Linux (Flathub)**:
  Publish a Flatpak manifest bundling the application with GNOME runtime for distro-agnostic distribution.
