import { Controller, Post, Body, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatService } from './chat.service';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  chat(
    @Body() body: {
      messages: Array<{ role: string; content: string }>;
      model: string;
      webSearch?: boolean;
    },
    @Res() res: Response,
  ) {
    return this.chatService.chat(
      body.messages ?? [],
      body.model ?? 'openai/gpt-4o',
      body.webSearch ?? false,
      res,
    );
  }
}
