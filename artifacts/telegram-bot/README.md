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

1. Create a new Railway project and connect this repo
2. Set the environment variable `TELEGRAM_TOKEN` to your bot token from @BotFather
3. Railway will auto-detect the `Procfile` and run `node artifacts/telegram-bot/index.js`
4. The bot needs enough RAM for Chromium — Railway's Starter plan (512MB) should work, Hobby (1GB+) is recommended

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `TELEGRAM_TOKEN` | Your Telegram bot token from @BotFather |
| `PORT` | Port to listen on (Railway sets this automatically) |

### Procfile

```
web: node artifacts/telegram-bot/index.js
```

## Running Locally

```bash
cd artifacts/telegram-bot
npm install
TELEGRAM_TOKEN=your_token_here node index.js
```

## Notes

- Puter.js is loaded inside the headless browser — no Puter API key required
- The browser is kept alive and reused across all requests for performance
- Railway has Chromium dependencies pre-installed, but if you see errors add these to your Railway env: `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false`
