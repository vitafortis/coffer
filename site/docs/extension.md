# Browser extension

The extension finds, copies and fills secrets from the browser toolbar, and fills password fields with new passwords. It works in Chrome, Edge, Brave and Arc, and is installed unpacked from your own server.

## Install

1. In Coffer, open **Settings → Browser extension → Download extension**, and unzip it somewhere it can stay.
2. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and pick the unzipped folder.
3. Click the Coffer icon (or press **⌘⇧K** / **Ctrl+Shift+K**), and enter Coffer's address and an API token. **Make an extension token** in Settings creates one.

The extension asks for access to that one site only. Click the server's name at the bottom of the popup to connect to a different one.

## What it does

- **This site first.** On a website, the secrets whose URL is on that site, or on a domain above it, are listed first. A secret for `github.com` also shows up on `gist.github.com`. Give a secret a URL in the web app, in the extension's save form (**use this page**), or with `coffer set NAME --url github.com`.
- **Fill in page.** Those secrets also have a fill button. A password fills the focused field, or the page's first password field if nothing has focus. Other types fill only the focused field.
- **Search and copy.** Type to search every project. **Enter** or a click copies a value, and the clipboard is cleared after 30 seconds if it still holds that value.
- **Projects.** Browse a project's secrets by environment, and add one with **+**.
- **Generate into fields.** Right-click any field and choose **Fill with a new password**. It also fills a matching "confirm password" box. The popup then offers to save the password, named after the site and with the site's URL.

Every value the extension reads, to copy, show or fill, is recorded in **Activity** with the extension's token.

## Site icons

Secrets with a URL show that site's icon, taken from the browser's own favicon cache, so nothing is fetched and no third party learns which sites you have passwords for. A site you've never visited in this browser shows a plain globe.

## What it doesn't do

It never reads pages or fills logins by itself. It touches a page only when you click **Fill in page** or use the right-click menu. The extension signs in to Coffer with its token alone, never with your browser's Coffer session, so revoking the token in **Settings → API tokens** disconnects it.

If Coffer is behind a proxy with its own sign-in and the popup says *"Something in front of Coffer answered instead"*, the proxy is asking for that sign-in. Let `/api/v1/` through it: see [Sign-in at the proxy](reverse-proxy.html#sign-in-at-the-proxy).
