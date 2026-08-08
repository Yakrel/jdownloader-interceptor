# JDownloader Download Interceptor

A small Manifest V3 extension for Chromium-based browsers that intercepts normal downloads and lets you choose whether each file should go to a JDownloader instance or continue through the browser's native downloader.

## Supported browsers

The extension uses standard Chromium extension APIs (`chrome.downloads`, `chrome.storage`, `chrome.permissions`) and is intended for Chromium-based browsers such as:

- Google Chrome
- Brave
- Microsoft Edge
- Vivaldi
- Chromium

Current real-world testing has been done in Brave. Other Chromium-based browsers should be compatible as long as they support the same Manifest V3 APIs.

## What it does

The toolbar button toggles interception:

- **ON** — hold supported HTTP/HTTPS downloads and ask where each download should go.
- **OFF** — do not interfere; the browser downloads normally.

When interception is ON, the choice window offers:

- **Send to JDownloader** — send the URL to the configured JDownloader server and cancel the local browser download.
- **Download with browser** — release the original download back to the browser without reconstructing or restarting the URL.
- **Cancel** — cancel the download.

Closing the choice window is treated as **Download with browser**, so an intended download is not silently lost.

## Why the native browser download is preserved

The extension uses `chrome.downloads.onDeterminingFilename` and waits for the user's choice before completing filename determination.

If **Download with browser** is selected, the original browser download continues. The extension does not create a second download request. This preserves browser-managed state such as cookies, redirects, POST state, authentication, and other request details as reliably as Chromium normally can.

Chrome Downloads API documentation:
https://developer.chrome.com/docs/extensions/reference/api/downloads

## Configure JDownloader

The default JDownloader server is:

```text
http://192.168.1.102:9666
```

You can change it from the extension's **Options** page.

Typical ways to open the settings page:

- Right-click the extension toolbar icon and choose **Options**.
- Open your browser's extensions page, open the extension details, then choose **Extension options**.

Enter the JDownloader base URL only, for example:

```text
http://192.168.1.50:9666
https://jdownloader.example.net
```

The extension appends `/flashgot` automatically.

Your custom server is stored locally in extension storage. When you save a custom HTTP/HTTPS host, the browser asks for permission to access that JDownloader host. The extension uses optional host permissions so it does not need permanent access to every website.

The bundled default `192.168.1.102` host is pre-authorized so the default configuration works immediately.

## JDownloader requirements

JDownloader's external interface must be reachable from the browser machine.

For the default Docker/LAN setup used during development:

```yaml
ports:
  - "192.168.1.102:9666:9666"
```

JDownloader also needs:

```text
externinterfacelocalhostonly=false
```

The extension sends downloads to JDownloader's `/flashgot` endpoint with `autostart=1` and forwards the referrer when Chromium exposes one.

Do **not** expose port `9666` directly to the public internet. Use a trusted LAN or a secure private network/VPN if remote access is required.

## Install as an unpacked extension

Clone the repository:

```bash
git clone https://github.com/Yakrel/jdownloader-interceptor.git
```

Then open your browser's extension management page, enable **Developer mode**, choose **Load unpacked**, and select the repository directory.

Examples:

- Chrome: `chrome://extensions`
- Brave: `brave://extensions`
- Edge: `edge://extensions`

Pin **JDownloader Download Interceptor** to the toolbar so the ON/OFF state is easy to control.

After updating the repository with `git pull`, reload the extension from the browser's extensions page.

## Permissions

Required permissions:

- `downloads` — observe, continue, and cancel browser downloads.
- `storage` — remember the ON/OFF state and configured JDownloader server.
- `http://192.168.1.102/*` — access the bundled default JDownloader host.

Optional host permissions:

- `http://*/*`
- `https://*/*`

These wildcard patterns are declared as **optional** permissions only. They allow the settings page to request access to the specific custom JDownloader host chosen by the user at runtime; they do not grant blanket website access at installation time.

## Limitations

- Browser-internal URLs such as `blob:`, `data:`, and `filesystem:` are left to the browser.
- The JDownloader route can only forward the URL and referrer exposed by Chromium's `DownloadItem`.
- Downloads that depend on unusual POST-only flows, special request headers, DRM, or browser-only state may work only through **Download with browser**.
- Very small downloads may occasionally complete before an extension can intervene.
- Other download-interception extensions can conflict with `onDeterminingFilename`; disable competing interceptors while testing.

## Design

Plain Manifest V3 JavaScript, HTML, and CSS.

No npm dependencies, build step, native helper, analytics, remote code, or local download daemon.

## License

MIT
