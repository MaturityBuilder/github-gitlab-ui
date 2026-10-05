# GitLab Look for GitHub

![GitLab Look for GitHub: sidebar, pipelines, stage columns, and comment order](docs/promo.gif)

![Small promo tile, 440 by 280](docs/promo-tile.png)

## Screenshots

These are github.com/cli/cli with the skin on. Each image is 1280 by 800.

![Repository sidebar with issue and merge request counts](docs/screenshots/sidebar.png)

![Actions runs shown as pipeline rows](docs/screenshots/pipelines.png)

![A workflow run shown as stage columns](docs/screenshots/stages.png)

![Oldest and Newest on a pull request](docs/screenshots/comments.png)

## Product description

GitLab Look for GitHub is an unofficial Chrome extension. It shows [github.com](https://github.com) in a GitLab-style layout. GitHub links, forms, and data stay as they are.

Repository pages use a sidebar instead of the horizontal tabs. Issues and merge requests keep the counts GitHub already shows. Visible "Pull request" headings read as "Merge request," and "Actions" reads as "CI/CD."

GitHub Actions lists appear as pipeline rows, and a workflow run appears as stage columns. On a pull request, Oldest and Newest reorder the conversation. Open Dependabot alerts are highlighted in dependency files and job logs. Dismissed alerts are left alone. Those details stay in the browser.

The skin is on by default. The toolbar popup turns it off. This project is not affiliated with GitLab or GitHub.

## What it changes

- Light content surface, blue primary actions, and an orange accent, using colors from GitLab's Pajamas palette.
- A fixed super sidebar on repository pages: Repository, Issues, Merge requests, CI/CD, Wiki (when the repo has one), Insights, and Settings. Issues and Merge requests show the same counts GitHub already puts on those tabs. The horizontal repository tabs are hidden while the skin is on.
- Visible headings that say "Pull request" or "Pull requests" display as "Merge request" or "Merge requests".
- GitHub Actions lists render as pipeline rows (status, pipeline number, commit link, branch, actor, duration). A workflow run renders as stage columns. Job names that share a prefix such as `test / node 18` share a stage. The job log page gets a GitLab-style header and a link back to `Pipeline #<id>`. Log text is unchanged. Rerun and cancel stay GitHub's controls.
- On a pull request conversation, **Oldest** / **Newest** reorders comments. The description stays at the top and the comment box stays at the bottom. Replies inside a review thread follow the same direction, including on the Files changed tab, without moving threads off their lines. The choice is saved in `chrome.storage.local`.
- Open Dependabot alerts for the repository are highlighted in manifest files and in Actions job logs. A vulnerable package name is marked on the manifest Dependabot named, and on log lines that mention that package with a vulnerable version or an advisory id. Advisory ids such as `GHSA-…` or `CVE-…` are marked wherever they appear in code or logs. Dismissed alerts are skipped. The extension reads alerts from GitHub's Dependabot page for that repository and remembers them in `chrome.storage.local`. It does not call the GitHub API and does not add exploit detail.

## Install for local testing

`scripts/install-local.sh` starts Chrome or Chromium with this extension in a throwaway profile. It does not change your everyday browser profile.

```bash
./scripts/install-local.sh
./scripts/install-local.sh https://github.com/cli/cli
```

Optional environment variables:

- `CHROME_BIN` — browser executable
- `EXTENSION_DIR` — path to the extension directory (defaults to `extension/`)
- `CHROME_USER_DATA_DIR` — reuse a profile directory instead of a new temp folder

The script looks for `google-chrome`, `google-chrome-stable`, `chromium`, then `chromium-browser`. If none of those exist, it prints the manual steps and exits.

Chrome 137 and newer ignore `--load-extension`. On those builds the script still uses a throwaway profile and loads the extension through Chrome's debugging pipe (`Extensions.loadUnpacked`), which needs Node. It follows shell wrappers such as `google-chrome` to the real `chrome` executable, because those wrappers replace the debugging pipe. Chromium keeps using `--load-extension` directly.

### Load unpacked

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose Load unpacked.
4. Select the `extension/` directory.

## Check the fixtures

```bash
./test/verify.sh
```

That checks the install script flags, runs the pipeline, sidebar, and comment-order fixtures in headless Chrome, and loads the extension against public GitHub pages when Chrome is available.

## Publish to the Chrome Web Store

`.github/workflows/chrome.yml` tests the extension and publishes it to the Chrome Web Store. The publish job runs when a `v*` tag is pushed, and when the workflow is started by hand on `main`. A tag publishes to everyone. A manual run publishes to the target you pick, trusted testers by default. Pull requests only run the test and package jobs.

The package job uploads the files inside `extension/`. Download the `gitlab-look` artifact from the Actions run and you get a zip with `manifest.json` at the root, which is the package the Chrome Web Store accepts. A zip of the `extension` folder itself, or a zip that only contains another zip, is rejected with "No manifest found in package."

The Chrome Web Store item has to exist already, because the API updates an item by its id. Upload the zip once in the [developer dashboard](https://chrome.google.com/webstore/devconsole) and copy the item id. Each upload also has to use a higher `version` in `extension/manifest.json` than the version already on the store.

Add these repository secrets:

- `CHROME_EXTENSION_ID` — the store item id
- `CHROME_CLIENT_ID` — OAuth client id from a Google Cloud project with the Chrome Web Store API enabled
- `CHROME_CLIENT_SECRET` — that client's secret
- `CHROME_REFRESH_TOKEN` — a refresh token for `https://www.googleapis.com/auth/chromewebstore`

The token comes from the [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api) OAuth flow. After the secrets are set, publish with a tag:

```bash
git tag v1.1.0
git push origin v1.1.0
```
