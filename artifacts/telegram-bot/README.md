# Telegram Claude Bot

A Telegram bot powered by Claude claude-opus-4-6 via Puter.js running in a headless Puppeteer browser.

## Architecture

```
Telegram → node-telegram-bot-api → Express server → Puppeteer (headless Chrome) → Puter.js → Claude claude-opus-4-6
```

## Features

- Chat with Claude claude-opus-4-6 with extended thinking (16k token budget)
- Per-user conversation history (up to 20 messages)
- `/think` command to toggle showing Claude's thinking process as a Telegram spoiler
- `/clear` to reset conversation
- Long message splitting (>4096 chars)
- Typing indicator while waiting
- Automatic retry on failure

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/help` | List all commands |
| `/clear` | Reset conversation history |
| `/think` | Toggle thinking display on/off |

## Deploying to Railway

### Step 1 — Create Railway project

1. Go to [railway.app](https://railway.app) and create a new project
2. Connect your GitHub repo
3. In the Railway project settings, set **Root Directory** to: `artifacts/telegram-bot`
   - This is important — Railway needs to build from the bot's subfolder, not the monorepo root

### Step 2 — Set environment variables

In Railway → your service → **Variables**, add:

| Variable | Value |
|----------|-------|
| `TELEGRAM_TOKEN` | Your bot token from @BotFather |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | `false` |
| `PUPPETEER_CACHE_DIR` | `/app/.cache/puppeteer` |

### Step 3 — Deploy

Railway will automatically:
- Detect Node.js
- Install system libraries for Chrome (via `nixpacks.toml`)
- Run `npm install` (which downloads Puppeteer's bundled Chrome)
- Start the bot with `node index.js`

### Memory recommendation

Chromium needs RAM to run. Railway plans:
- **Starter (512MB)**: May work but tight
- **Hobby (1GB)**: Recommended minimum

## Running Locally

```bash
cd artifacts/telegram-bot
npm install
TELEGRAM_TOKEN=your_token_here node index.js
```

## How it works

1. Express serves a local `puter-bridge.html` page on startup
2. Puppeteer launches headless Chrome and loads that page
3. The page loads `https://js.puter.com/v2/` and exposes `window.askAI(prompt, history)`
4. When a Telegram message arrives, the server calls `page.evaluate(() => window.askAI(...))` and returns Claude's response
5. The browser stays alive between requests — no relaunch overhead per message
