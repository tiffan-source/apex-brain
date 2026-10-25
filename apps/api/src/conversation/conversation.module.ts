import { Module } from '@nestjs/common';
import { ConversationController } from './conversation.controller';

/** La conversation : sa query et sa commande sont des ports, fournis par les adaptateurs. */
@Module({
  controllers: [ConversationController],
})
export class ConversationModule {}
