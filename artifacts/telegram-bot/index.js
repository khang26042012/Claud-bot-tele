'use strict';

// Build LD_LIBRARY_PATH from Nix store entries in PATH so Chromium can find its libraries
(function setLibraryPath() {
  const fs = require('fs');
  const pathEntries = (process.env.PATH || '').split(':');
  const libDirs = new Set();
  for (const entry of pathEntries) {
    if (!entry.includes('/nix/store/')) continue;
    const base = entry.replace(/\/bin$/, '');
    const candidates = [
      base + '/lib',
      base.replace(/-dev$/, '') + '/lib',
      base.replace(/-bin$/, '') + '/lib',
      base.replace(/-lib$/, '') + '/lib',
    ];
    for (const d of candidates) {
      try { if (fs.statSync(d).isDirectory()) libDirs.add(d); } catch (_) {}
    }
  }
  const existing = process.env.LD_LIBRARY_PATH || '';
  const combined = [...libDirs, ...existing.split(':').filter(Boolean)].join(':');
  process.env.LD_LIBRARY_PATH = combined;
  console.log('LD_LIBRARY_PATH set with', libDirs.size, 'nix store lib dirs');
})();

const express = require('express');
const path = require('path');
const puppeteer = require('puppeteer');
const TelegramBot = require('node-telegram-bot-api');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const PORT = process.env.PORT || 3000;
const MAX_HISTORY = 20;
const MAX_MSG_LENGTH = 4096;

if (!TELEGRAM_TOKEN) {
  console.error('TELEGRAM_TOKEN environment variable is required');
  process.exit(1);
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

let browser = null;
let page = null;
let browserReady = false;
let browserError = null;

async function launchBrowser() {
  console.log('Launching Puppeteer browser...');
  try {
    browser = await puppeteer.launch({
      headless: true,
      env: {
        ...process.env,
        LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || '',
      },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });

    page = await browser.newPage();

    page.on('console', msg => {
      const text = msg.text();
      if (!text.includes('favicon') && !text.includes('ERR_')) {
        console.log('[Browser]', text);
      }
    });

    page.on('pageerror', err => {
      console.error('[Browser Error]', err.message);
    });

    const serverUrl = `http://localhost:${PORT}/puter-bridge.html`;
    console.log(`Loading Puter bridge from ${serverUrl}...`);
    await page.goto(serverUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    console.log('Waiting for Puter to initialize...');
    await page.waitForFunction(() => window.__puterReady === true || window.__puterError !== null, {
      timeout: 60000,
      polling: 500
    });

    const err = await page.evaluate(() => window.__puterError);
    if (err) {
      throw new Error(err);
    }

    browserReady = true;
    console.log('Puter bridge ready!');
  } catch (e) {
    browserError = e.message;
    console.error('Browser launch failed:', e.message);
  }
}

async function askAI(prompt, history) {
  if (!browserReady) {
    throw new Error('Browser not ready: ' + (browserError || 'still initializing'));
  }

  const result = await page.evaluate(async (p, h) => {
    try {
      return await window.askAI(p, h);
    } catch (e) {
      return { error: e.message || String(e) };
    }
  }, prompt, history);

  if (result && result.error) {
    throw new Error(result.error);
  }

  return result;
}

async function askAIWithRetry(prompt, history) {
  try {
    return await askAI(prompt, history);
  } catch (e) {
    console.error('First attempt failed:', e.message, '- retrying...');
    await new Promise(r => setTimeout(r, 2000));
    return await askAI(prompt, history);
  }
}

function splitMessage(text) {
  if (text.length <= MAX_MSG_LENGTH) return [text];
  const parts = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_MSG_LENGTH) {
      parts.push(remaining);
      break;
    }
    let cutAt = remaining.lastIndexOf('\n', MAX_MSG_LENGTH);
    if (cutAt < MAX_MSG_LENGTH * 0.5) cutAt = MAX_MSG_LENGTH;
    parts.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt).trimStart();
  }
  return parts;
}

async function sendLongMessage(bot, chatId, text, options) {
  const parts = splitMessage(text);
  for (let i = 0; i < parts.length; i++) {
    await bot.sendMessage(chatId, parts[i], i === parts.length - 1 ? options : {});
  }
}

async function main() {
  const server = app.listen(PORT, () => {
    console.log(`Express server listening on port ${PORT}`);
    launchBrowser().catch(e => {
      browserError = e.message;
      console.error('Fatal browser error:', e);
    });
  });

  const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

  const userHistories = new Map();
  const userThinkMode = new Map();

  function getHistory(chatId) {
    if (!userHistories.has(chatId)) userHistories.set(chatId, []);
    return userHistories.get(chatId);
  }

  function addToHistory(chatId, role, content) {
    const history = getHistory(chatId);
    history.push({ role, content });
    while (history.length > MAX_HISTORY) history.shift();
  }

  function isThinkEnabled(chatId) {
    return userThinkMode.get(chatId) === true;
  }

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId,
      `👋 *Welcome to Claude Bot!*\n\n` +
      `I'm powered by Claude claude-opus-4-6 via Puter.js. Send me any message and I'll respond.\n\n` +
      `*Commands:*\n` +
      `/start - Show this message\n` +
      `/help - List commands\n` +
      `/clear - Reset conversation history\n` +
      `/think - Toggle thinking display (currently OFF)\n\n` +
      `Start chatting!`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const thinkStatus = isThinkEnabled(chatId) ? 'ON' : 'OFF';
    await bot.sendMessage(chatId,
      `*Available Commands:*\n\n` +
      `/start - Welcome message\n` +
      `/help - Show this help\n` +
      `/clear - Reset conversation history\n` +
      `/think - Toggle thinking display (currently ${thinkStatus})\n\n` +
      `*About:*\n` +
      `Model: claude-opus-4-6\n` +
      `History: up to ${MAX_HISTORY} messages per user\n` +
      `Thinking: Extended thinking with 16k token budget`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.onText(/\/clear/, async (msg) => {
    const chatId = msg.chat.id;
    userHistories.set(chatId, []);
    await bot.sendMessage(chatId, '✅ Conversation history cleared. Starting fresh!');
  });

  bot.onText(/\/think/, async (msg) => {
    const chatId = msg.chat.id;
    const current = isThinkEnabled(chatId);
    userThinkMode.set(chatId, !current);
    const newStatus = !current ? 'ON' : 'OFF';
    await bot.sendMessage(chatId,
      `🧠 Thinking display is now *${newStatus}*.\n\n` +
      (newStatus === 'ON'
        ? 'When enabled, Claude\'s thinking process will appear above the answer as a spoiler (tap to reveal).'
        : 'Thinking is hidden. Only the final answer will be shown.'),
      { parse_mode: 'Markdown' }
    );
  });

  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const userText = msg.text.trim();

    try {
      await bot.sendChatAction(chatId, 'typing');

      const history = getHistory(chatId);
      const historySnapshot = [...history];

      const typingInterval = setInterval(() => {
        bot.sendChatAction(chatId, 'typing').catch(() => {});
      }, 4000);

      let result;
      try {
        result = await askAIWithRetry(userText, historySnapshot);
      } finally {
        clearInterval(typingInterval);
      }

      const { answer, thinking } = result;

      addToHistory(chatId, 'user', userText);
      addToHistory(chatId, 'assistant', answer);

      const showThinking = isThinkEnabled(chatId) && thinking && thinking.trim().length > 0;

      if (showThinking) {
        const thinkingMsg = `||${thinking.trim().replace(/\|/g, '\\|')}||\n\n${answer}`;
        await sendLongMessage(bot, chatId, thinkingMsg, { parse_mode: 'MarkdownV2' });
      } else {
        await sendLongMessage(bot, chatId, answer, {});
      }
    } catch (e) {
      console.error('Error processing message:', e.message);
      await bot.sendMessage(chatId,
        `⚠️ Sorry, I encountered an error: ${e.message}\n\nPlease try again in a moment.`
      );
    }
  });

  bot.on('polling_error', (error) => {
    console.error('Polling error:', error.message);
  });

  console.log('Telegram bot started with polling...');

  process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    bot.stopPolling();
    if (browser) await browser.close();
    server.close();
    process.exit(0);
  });
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
