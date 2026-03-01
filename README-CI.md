# CI + Auto Deploy (GitHub Actions) for Google Apps Script

This repo is configured to:
- **Lint** JavaScript (`.js`) and Apps Script (`.gs`) on every push/PR
- **Auto deploy** to Google Apps Script on pushes to the default branch (main/master)

## What you need (one-time)

### 1) Create a Google Apps Script project and get the Script ID
- Open Apps Script -> Project Settings -> **Script ID**
- Copy it

### 2) Create the clasp credentials JSON (locally)
On your machine:

```bash
npm ci
npx clasp login
```

This will create a file at:

- Windows: `%USERPROFILE%\.clasprc.json`
- macOS/Linux: `~/.clasprc.json`

Open that file and copy its full JSON content.

### 3) Add GitHub Secrets (Repo -> Settings -> Secrets and variables -> Actions)

Create:
- `SCRIPT_ID` : your Apps Script **Script ID**
- `CLASPRC_JSON` : the full content of your `~/.clasprc.json`

> Do not commit `.clasp.json` or `.clasprc.json` to the repo.

## How deploy works
On `push` to `main` or `master`, the workflow will:
1. install dependencies
2. run ESLint
3. run `clasp push --force`
4. run `clasp deploy` with a description containing the GitHub run info

Artifacts are not produced for Apps Script (deploy logs are shown in Actions output).
