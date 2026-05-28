import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import axios from 'axios';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private readonly config: ConfigService) {}

  async chat(
    messages: Array<{ role: string; content: string }>,
    model: string,
    webSearch: boolean,
    res: Response,
  ) {
    const apiKey = (
      this.config.get<string>('OPENROUTER_KEY') ??
      this.config.get<string>('OPENROUTER_API_KEY') ?? ''
    ).trim();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    if (!apiKey || apiKey.startsWith('your-')) {
      res.write(`data: ${JSON.stringify({ error: 'OPENROUTER_KEY ยังไม่ได้ตั้งค่าใน .env' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // DuckDuckGo web search injection for non-search models
    let webContext = '';
    const isSearchModel = model.includes('perplexity') || model.includes('sonar');
    if (webSearch && !isSearchModel) {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      if (lastUserMsg) {
        webContext = await this.ddgSearch(lastUserMsg);
      }
    }

    const systemContent = [
      'You are a helpful AI assistant for a Thai job application platform called SmartMatch AI.',
      'You help users: find HR contact info, write cover letters, analyze job descriptions, and navigate the Thai job market.',
      'Answer in Thai or English matching the user\'s language. Be concise and practical.',
      webContext ? `\n\nWeb search results:\n${webContext}\n\nUse these results to give an accurate, up-to-date answer.` : '',
    ].join('');

    const allMessages = [
      { role: 'system', content: systemContent },
      ...messages,
    ];

    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model,
          messages: allMessages,
          stream: true,
          max_tokens: 2048,
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': this.config.get('BASEURL') ?? 'https://jobai.com',
            'X-Title': 'JobAI-Chat',
            'Content-Type': 'application/json',
          },
          responseType: 'stream',
          timeout: 60000,
        },
      );

      let buffer = '';

      response.data.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const raw = trimmed.slice(6);
          if (raw === '[DONE]') continue;
          try {
            const parsed = JSON.parse(raw);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
          } catch {}
        }
      });

      response.data.on('end', () => {
        res.write('data: [DONE]\n\n');
        res.end();
      });

      response.data.on('error', (err: Error) => {
        this.logger.error(`Stream error: ${err.message}`);
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
    } catch (err: any) {
      this.logger.error(`Chat error: ${err.message}`);
      res.write(`data: ${JSON.stringify({ error: err.response?.data?.error?.message ?? err.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }

  private async ddgSearch(query: string): Promise<string> {
    try {
      const { data: html } = await axios.get('https://html.duckduckgo.com/html/', {
        params: { q: query },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,*/*',
          'Accept-Language': 'th,en;q=0.9',
        },
        timeout: 8000,
      });

      const text = html as string;
      const snippets = [...text.matchAll(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)]
        .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim())
        .filter(Boolean)
        .slice(0, 6);

      const titles = [...text.matchAll(/<a class="result__a"[^>]*>([\s\S]*?)<\/a>/g)]
        .map((m) => m[1].replace(/<[^>]+>/g, '').trim())
        .filter(Boolean)
        .slice(0, 6);

      const results = titles.map((t, i) => `${i + 1}. ${t}${snippets[i] ? ': ' + snippets[i] : ''}`);
      return results.join('\n');
    } catch {
      return '';
    }
  }
}
