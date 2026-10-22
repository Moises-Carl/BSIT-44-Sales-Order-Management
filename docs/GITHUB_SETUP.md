# Share the project with your group

Suggested GitHub repository name: `CampusERP-Sales-Order`.

## Upload this prepared Git repository

1. On GitHub, create a new repository named `CampusERP-Sales-Order`. Choose **Private** if access should be limited to your group. Leave the README, .gitignore, and license options unchecked because this local project already has its first commit.
2. Copy the new repository’s HTTPS URL. In a terminal opened in this MiniERP folder, replace `YOUR_USERNAME` below with the GitHub account that owns it:

```powershell
git remote add origin https://github.com/YOUR_USERNAME/CampusERP-Sales-Order.git
git push -u origin main
```

If prompted, sign in using your Git credential manager or browser. Do not paste a password or access token into source files.

3. On the repository page, open **Settings → Collaborators** (or the repository access settings), add your groupmate’s GitHub username, and have them accept the invitation.

## Alternative: upload through GitHub’s website

The prepared `data/CampusERP-Sales-Order-GitHub.zip` contains the committed project files only. Extract it into a new folder first, then upload the extracted files using GitHub’s **Add file → Upload files**. Upload the contents as source files rather than uploading only the ZIP. The Git push method above preserves the prepared commit and includes hidden configuration files reliably.

## Groupmate setup

Install Git and Node.js 22.14 or newer, then:

```powershell
git clone https://github.com/YOUR_USERNAME/CampusERP-Sales-Order.git
cd CampusERP-Sales-Order
npm.cmd ci --ignore-scripts
npm.cmd run demo
```

On macOS/Linux, use `npm` instead of `npm.cmd`.

Open `http://127.0.0.1:3100`, expand **Try a demo account**, and choose an account. The demo uses local SQLite and fictional service results; MySQL is not required for the demo. Each groupmate has their own local demo database. GitHub shares code, not a running site or a shared database.

Run the tests with:

```powershell
npm.cmd test
```

See `README.md` for the workflow, real MySQL setup, and integration limits. The browser QA script currently uses the Windows Edge installation path; the normal test suite does not require a browser.

## Working together

Before starting changes, run `git pull`. Prefer a separate branch for each task:

```powershell
git switch -c feature/your-task
# Make and test your changes.
git add .
git commit -m "Describe your change"
git push -u origin feature/your-task
```

Open a pull request for your group to review. Keep `.env`, credentials, `data/`, local databases, logs, editor state, and `node_modules/` out of commits. The supplied `.gitignore` already excludes them. Demo test credentials in the source are fictional and deliberately restricted to explicit demo mode.
